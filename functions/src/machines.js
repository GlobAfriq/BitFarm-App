const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { checkAndAwardBadge } = require('./services/badges');
const { sendFCMToUser } = require('./services/fcm');

exports.buyMachine = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in');
  const uid = request.auth.uid;
  const { tierId } = request.data;
  const db = getFirestore();

  try {
    const result = await db.runTransaction(async (t) => {
      const userRef = db.collection('users').doc(uid);
      const walletRef = db.collection('wallets').doc(uid);
      const tierRef = db.collection('machineTiers').doc(tierId);

      const [userSnap, walletSnap, tierSnap] = await Promise.all([
        t.get(userRef), t.get(walletRef), t.get(tierRef)
      ]);

      if (!userSnap.exists || !walletSnap.exists || !tierSnap.exists) {
        throw new HttpsError('not-found', 'Data not found');
      }

      const user = userSnap.data();
      const wallet = walletSnap.data();
      const tier = tierSnap.data();

      if (!user.isActive) throw new HttpsError('failed-precondition', 'Account suspended');
      if (wallet.balanceKes < tier.priceKes) throw new HttpsError('failed-precondition', 'Insufficient balance');

      // Deduct price
      t.update(walletRef, {
        balanceKes: wallet.balanceKes - tier.priceKes,
        updatedAt: FieldValue.serverTimestamp()
      });

      // Create machine
      const machineRef = db.collection('userMachines').doc();
      const now = new Date();
      const nextPayout = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      t.set(machineRef, {
        userId: uid,
        tierId,
        tierName: tier.name,
        tierIcon: tier.icon,
        weeklyAmountKes: tier.weeklyAmountKes,
        purchasedAt: FieldValue.serverTimestamp(),
        lastPayoutAt: null,
        nextPayoutAt: nextPayout,
        totalPaidOut: 0,
        ownershipPct: 100,
        isActive: true
      });

      // Create transaction
      const txRef = db.collection('transactions').doc();
      t.set(txRef, {
        userId: uid,
        type: 'machine_purchase',
        amountKes: tier.priceKes,
        direction: 'debit',
        balanceBefore: wallet.balanceKes,
        balanceAfter: wallet.balanceKes - tier.priceKes,
        description: `Purchased ${tier.name}`,
        idempotencyKey: 'buy_' + machineRef.id,
        status: 'completed',
        createdAt: FieldValue.serverTimestamp()
      });

      // Create spin tickets based on rig value
      let numTickets = 1;
      if (tier.name === 'Silver Rig') numTickets = 2;
      else if (tier.name === 'Gold Rig') numTickets = 3;
      else if (tier.name === 'Diamond Rig') numTickets = 4;

      for (let i = 0; i < numTickets; i++) {
        const ticketRef = db.collection('spinTickets').doc();
        t.set(ticketRef, {
          userId: uid,
          source: 'machine_purchase',
          used: false,
          createdAt: FieldValue.serverTimestamp()
        });
      }

      return { machineId: machineRef.id, nextPayoutAt: nextPayout, tierPrice: tier.priceKes, tierName: tier.name };
    });

    // Post-transaction actions
    const pendingRefs = await db.collection('referrals')
      .where('referredId', '==', uid)
      .where('status', '==', 'pending')
      .get();

    if (!pendingRefs.empty) {
      const refDoc = pendingRefs.docs[0];
      const commission = result.tierPrice * 0.08;
      const referrerId = refDoc.data().referrerId;

      await db.runTransaction(async (t) => {
        const refWallet = db.collection('wallets').doc(referrerId);
        t.update(refWallet, {
          balanceKes: FieldValue.increment(commission),
          totalEarned: FieldValue.increment(commission),
          updatedAt: FieldValue.serverTimestamp()
        });
        t.update(refDoc.ref, {
          machineId: result.machineId,
          purchaseAmount: result.tierPrice,
          commissionAmt: commission,
          status: 'paid',
          paidAt: FieldValue.serverTimestamp()
        });
        const txRef = db.collection('transactions').doc();
        t.set(txRef, {
          userId: referrerId,
          type: 'referral_commission',
          amountKes: commission,
          direction: 'credit',
          description: 'Referral commission',
          status: 'completed',
          createdAt: FieldValue.serverTimestamp()
        });
      });
      await sendFCMToUser(referrerId, '💰 Commission Earned!', `Your referral bought a machine! You earned KES ${commission}`, 'referral');
      await checkAndAwardBadge(referrerId, 'social_starter');
    }

    await checkAndAwardBadge(uid, 'first_machine');
    if (result.tierName === 'Diamond Rig') {
      await checkAndAwardBadge(uid, 'diamond_miner');
    }
    await sendFCMToUser(uid, '⛏️ Machine Active!', `${result.tierName} is mining for you! First payout in 7 days.`, 'general');

    return { success: true, machineId: result.machineId, nextPayoutAt: result.nextPayoutAt };
  } catch (error) {
    throw new HttpsError('internal', error.message);
  }
});

exports.sellFraction = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in');
  const uid = request.auth.uid;
  const { machineId, pctForSale } = request.data;
  const db = getFirestore();

  if (pctForSale < 10 || pctForSale > 90) throw new HttpsError('invalid-argument', 'Percentage must be between 10 and 90');

  const machineRef = db.collection('userMachines').doc(machineId);
  const machineSnap = await machineRef.get();
  if (!machineSnap.exists || machineSnap.data().userId !== uid) {
    throw new HttpsError('permission-denied', 'Machine not found or not owned');
  }

  const tierRef = db.collection('machineTiers').doc(machineSnap.data().tierId);
  const tierSnap = await tierRef.get();
  const askingPrice = (pctForSale / 100) * tierSnap.data().priceKes;

  const fracRef = db.collection('machineFractions').doc();
  await fracRef.set({
    machineId,
    sellerId: uid,
    buyerId: null,
    pctForSale,
    askingPrice,
    status: 'listed',
    listedAt: FieldValue.serverTimestamp(),
    soldAt: null
  });

  return { success: true, fractionId: fracRef.id };
});

exports.buyFraction = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in');
  const uid = request.auth.uid;
  const { fractionId } = request.data;
  const db = getFirestore();

  await db.runTransaction(async (t) => {
    const fracRef = db.collection('machineFractions').doc(fractionId);
    const fracSnap = await t.get(fracRef);
    if (!fracSnap.exists || fracSnap.data().status !== 'listed' || fracSnap.data().sellerId === uid) {
      throw new HttpsError('failed-precondition', 'Fraction not available');
    }

    const frac = fracSnap.data();
    const buyerWalletRef = db.collection('wallets').doc(uid);
    const sellerWalletRef = db.collection('wallets').doc(frac.sellerId);

    const buyerSnap = await t.get(buyerWalletRef);
    if (buyerSnap.data().balanceKes < frac.askingPrice) {
      throw new HttpsError('failed-precondition', 'Insufficient balance');
    }

    t.update(buyerWalletRef, { balanceKes: FieldValue.increment(-frac.askingPrice) });
    t.update(sellerWalletRef, { balanceKes: FieldValue.increment(frac.askingPrice) });
    
    t.update(fracRef, {
      status: 'sold',
      buyerId: uid,
      soldAt: FieldValue.serverTimestamp()
    });

    const buyerTx = db.collection('transactions').doc();
    t.set(buyerTx, {
      userId: uid, type: 'fraction_purchase', amountKes: frac.askingPrice,
      direction: 'debit', description: `Bought ${frac.pctForSale}% machine stake`,
      status: 'completed', createdAt: FieldValue.serverTimestamp()
    });

    const sellerTx = db.collection('transactions').doc();
    t.set(sellerTx, {
      userId: frac.sellerId, type: 'fraction_sale', amountKes: frac.askingPrice,
      direction: 'credit', description: `Sold ${frac.pctForSale}% machine stake`,
      status: 'completed', createdAt: FieldValue.serverTimestamp()
    });
  });

  return { success: true };
});