const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { sendFCMToUser } = require('../services/fcm');
const { checkAndAwardBadge } = require('../services/badges');

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1)/7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

async function processPayouts(db) {
  const now = new Date();
  const dueMachines = await db.collection('userMachines')
    .where('isActive', '==', true)
    .where('nextPayoutAt', '<=', now)
    .get();

  if (dueMachines.empty) return { processed: 0 };

  const batch = db.batch();
  const notificationsToSend = [];

  for (const machineDoc of dueMachines.docs) {
    const machine = machineDoc.data();
    const walletRef = db.collection('wallets').doc(machine.userId);
    const walletSnap = await walletRef.get();
    const wallet = walletSnap.data();

    const idempotencyKey = 'payout_' + machineDoc.id + '_' + getISOWeek(now);
    const existing = await db.collection('transactions')
      .where('idempotencyKey', '==', idempotencyKey).limit(1).get();
    if (!existing.empty) continue;

    batch.update(walletRef, {
      balanceKes: FieldValue.increment(machine.weeklyAmountKes),
      totalEarned: FieldValue.increment(machine.weeklyAmountKes),
      updatedAt: FieldValue.serverTimestamp()
    });

    const payoutRef = db.collection('payouts').doc();
    batch.set(payoutRef, {
      userId: machine.userId, machineId: machineDoc.id,
      amountKes: machine.weeklyAmountKes, payoutWeek: getISOWeek(now),
      status: 'processed', processedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp()
    });

    const txRef = db.collection('transactions').doc();
    batch.set(txRef, {
      userId: machine.userId, type: 'payout', amountKes: machine.weeklyAmountKes,
      direction: 'credit', balanceBefore: wallet.balanceKes,
      balanceAfter: wallet.balanceKes + machine.weeklyAmountKes,
      description: machine.tierName + ' weekly payout',
      idempotencyKey, status: 'completed',
      createdAt: FieldValue.serverTimestamp()
    });

    batch.update(machineDoc.ref, {
      lastPayoutAt: FieldValue.serverTimestamp(),
      nextPayoutAt: addDays(now, 7),
      totalPaidOut: FieldValue.increment(machine.weeklyAmountKes)
    });

    notificationsToSend.push({
      userId: machine.userId,
      title: '⛏️ Payday!',
      body: machine.tierName + ' just earned you KES ' + machine.weeklyAmountKes + '. Check your wallet!'
    });
  }

  await batch.commit();

  for (const n of notificationsToSend) {
    await sendFCMToUser(n.userId, n.title, n.body, 'payout');
    const walletSnap = await db.collection('wallets').doc(n.userId).get();
    const totalEarned = walletSnap.data()?.totalEarned || 0;
    if (totalEarned >= 10000) await checkAndAwardBadge(n.userId, 'ten_k_earner');
    
    const payoutsCount = await db.collection('payouts').where('userId','==',n.userId).count().get();
    if (payoutsCount.data().count === 1) await checkAndAwardBadge(n.userId, 'first_payout');
  }

  await db.collection('auditLog').add({
    actorId: 'system', actorType: 'system',
    action: 'weekly_payouts_processed',
    newValue: { machinesProcessed: notificationsToSend.length, timestamp: now.toISOString() },
    createdAt: FieldValue.serverTimestamp()
  });

  return { processed: notificationsToSend.length };
}

exports.processWeeklyPayouts = onSchedule('0 * * * *', async () => {
  const db = getFirestore();
  await processPayouts(db);
});

exports.processPayouts = processPayouts;