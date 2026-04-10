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

  const notificationsToSend = [];
  let processedCount = 0;

  // Process in chunks to avoid transaction limits, but here we process each machine in its own transaction
  for (const machineDoc of dueMachines.docs) {
    const machine = machineDoc.data();
    const idempotencyKey = 'payout_' + machineDoc.id + '_' + getISOWeek(now);

    try {
      await db.runTransaction(async (t) => {
        const existing = await t.get(db.collection('transactions').where('idempotencyKey', '==', idempotencyKey).limit(1));
        if (!existing.empty) return; // Already processed

        const walletRef = db.collection('wallets').doc(machine.userId);
        const walletSnap = await t.get(walletRef);
        if (!walletSnap.exists) return;

        const amountKes = Math.round(machine.weeklyAmountKes);

        t.update(walletRef, {
          balanceKes: FieldValue.increment(amountKes),
          totalEarned: FieldValue.increment(amountKes),
          updatedAt: FieldValue.serverTimestamp()
        });

        const payoutRef = db.collection('payouts').doc();
        t.set(payoutRef, {
          userId: machine.userId, machineId: machineDoc.id,
          amountKes: amountKes, payoutWeek: getISOWeek(now),
          status: 'processed', processedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp()
        });

        const txRef = db.collection('transactions').doc();
        t.set(txRef, {
          userId: machine.userId, type: 'payout', amountKes: amountKes,
          direction: 'credit',
          description: machine.tierName + ' weekly payout',
          idempotencyKey, status: 'completed',
          createdAt: FieldValue.serverTimestamp()
        });

        t.update(machineDoc.ref, {
          lastPayoutAt: FieldValue.serverTimestamp(),
          nextPayoutAt: addDays(now, 7),
          totalPaidOut: FieldValue.increment(amountKes)
        });
      });

      notificationsToSend.push({
        userId: machine.userId,
        title: '⛏️ Payday!',
        body: machine.tierName + ' just earned you KES ' + Math.round(machine.weeklyAmountKes) + '. Check your wallet!'
      });
      processedCount++;
    } catch (error) {
      console.error(`Failed to process payout for machine ${machineDoc.id}:`, error);
    }
  }

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
    newValue: { machinesProcessed: processedCount, timestamp: now.toISOString() },
    createdAt: FieldValue.serverTimestamp()
  });

  return { processed: processedCount };
}

exports.processWeeklyPayouts = onSchedule('0 * * * *', async () => {
  const db = getFirestore();
  await processPayouts(db);
});

exports.processPayouts = processPayouts;
