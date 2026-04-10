const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { checkAndAwardBadge } = require('./services/badges');
const { sendFCMToUser } = require('./services/fcm');
const { requireAuth, rateLimit } = require('./utils/security');

exports.doSpin = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = getFirestore();

  await rateLimit(db, uid, 'doSpin', 2000); // 2 seconds cooldown

  try {
    const result = await db.runTransaction(async (t) => {
      const ticketsQuery = db.collection('spinTickets').where('userId', '==', uid).where('used', '==', false).limit(1);
      const ticketsSnap = await t.get(ticketsQuery);
      
      if (ticketsSnap.empty) throw new HttpsError('failed-precondition', 'No tickets available');
      const ticketDoc = ticketsSnap.docs[0];

      const prizesSnap = await t.get(db.collection('spinPrizes').where('isActive', '==', true));
      const prizes = prizesSnap.docs.map(d => d.data());
      
      const total = prizes.reduce((s, p) => s + p.probabilityWeight, 0);
      let rand = Math.random() * total;
      let selected = prizes[0];
      for (const prize of prizes) {
        if (rand < prize.probabilityWeight) { selected = prize; break; }
        rand -= prize.probabilityWeight;
      }

      t.update(ticketDoc.ref, { used: true, usedAt: FieldValue.serverTimestamp() });

      const resultRef = db.collection('spinResults').doc();
      t.set(resultRef, {
        userId: uid,
        ticketId: ticketDoc.id,
        prizeLabel: selected.label,
        prizeType: selected.prizeType,
        cashAmount: selected.cashAmount || 0,
        claimed: true,
        createdAt: FieldValue.serverTimestamp()
      });

      if (selected.prizeType === 'cash') {
        const cashAmount = Math.round(selected.cashAmount);
        const walletRef = db.collection('wallets').doc(uid);
        t.update(walletRef, {
          balanceKes: FieldValue.increment(cashAmount),
          totalEarned: FieldValue.increment(cashAmount),
          updatedAt: FieldValue.serverTimestamp()
        });
        const txRef = db.collection('transactions').doc();
        t.set(txRef, {
          userId: uid, type: 'spin_win', amountKes: cashAmount,
          direction: 'credit', description: `Spin Wheel Win: ${selected.label}`,
          idempotencyKey: `spin_${resultRef.id}`,
          status: 'completed', createdAt: FieldValue.serverTimestamp()
        });
      } else if (selected.prizeType === 'tickets') {
        for (let i = 0; i < 2; i++) {
          t.set(db.collection('spinTickets').doc(), {
            userId: uid, source: 'spin_win', used: false, createdAt: FieldValue.serverTimestamp()
          });
        }
      }

      return selected;
    });

    if (result.prizeType === 'cash') {
      await checkAndAwardBadge(uid, 'lucky_spinner');
      await sendFCMToUser(uid, '🎉 You won!', `You won ${result.label} on the spin wheel!`, 'spin');
    }

    return { 
      prizeLabel: result.label, 
      prizeType: result.prizeType, 
      cashAmount: result.cashAmount, 
      confetti: result.prizeType !== 'empty' 
    };
  } catch (error) {
    console.error('Spin error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message || 'Failed to spin');
  }
});
