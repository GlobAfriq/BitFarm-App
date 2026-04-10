const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');
const { requireAuth, validateInt, rateLimit } = require('./utils/security');

exports.initiateDeposit = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = getFirestore();
  
  const method = request.data.method;
  const amountKes = validateInt(request.data.amountKes, 50, 'amountKes');
  const phoneNumber = request.data.phoneNumber;

  await rateLimit(db, uid, 'initiateDeposit', 3000); // 3 seconds cooldown

  if (method === 'mpesa') {
    try {
      const paybillNumber = '880100';
      const accountNumber = '9412260019';
      
      const depositRef = await db.collection('deposits').add({
        userId: uid,
        method: 'mpesa_sms',
        amountKes,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp()
      });

      return { 
        depositId: depositRef.id,
        message: `Please pay KES ${amountKes} to Paybill ${paybillNumber}, Account ${accountNumber}.`,
        paybillNumber,
        accountNumber
      };
    } catch (error) {
      console.error('Deposit error:', error);
      throw new HttpsError('internal', 'Failed to initiate deposit');
    }
  } else if (method === 'usdt') {
    try {
      const res = await axios.post('https://api.nowpayments.io/v1/payment', {
        price_amount: amountKes / 130, // Hardcoded rate, but NOWPayments handles the actual crypto conversion
        price_currency: 'usd',
        pay_currency: 'usdttrc20',
        ipn_callback_url: `${process.env.MPESA_CALLBACK_URL}/usdt`
      }, { headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY } });

      await db.collection('deposits').add({
        userId: uid,
        method: 'usdt',
        amountKes,
        paymentId: res.data.payment_id,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp()
      });

      return { paymentAddress: res.data.pay_address, amountUsdt: res.data.pay_amount, paymentId: res.data.payment_id };
    } catch (error) {
      console.error('NOWPayments error', error.response?.data || error.message);
      throw new HttpsError('internal', 'Failed to initiate USDT deposit');
    }
  } else {
    throw new HttpsError('invalid-argument', 'Invalid method');
  }
});

exports.verifyDeposit = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = getFirestore();

  const mpesaCode = request.data.mpesaCode;
  if (!mpesaCode || typeof mpesaCode !== 'string') {
    throw new HttpsError('invalid-argument', 'Missing or invalid mpesaCode');
  }
  const expectedAmount = validateInt(request.data.expectedAmount, 50, 'expectedAmount');
  const code = mpesaCode.toUpperCase().trim();

  // Rate limiting: Check recent verification attempts (5 per 15 mins)
  const attemptsRef = db.collection('verification_attempts').doc(uid);
  const attemptsDoc = await attemptsRef.get();
  
  if (attemptsDoc.exists) {
    const data = attemptsDoc.data();
    const now = Date.now();
    const windowStart = now - 15 * 60 * 1000;
    const recentAttempts = (data.timestamps || []).filter(t => t.toMillis() > windowStart);
    if (recentAttempts.length >= 5) {
      throw new HttpsError('resource-exhausted', 'Too many verification attempts. Please try again later.');
    }
    await attemptsRef.update({ timestamps: FieldValue.arrayUnion(FieldValue.serverTimestamp()) });
  } else {
    await attemptsRef.set({ timestamps: [FieldValue.serverTimestamp()] });
  }

  try {
    const result = await db.runTransaction(async (t) => {
      const mpesaTxRef = db.collection('mpesa_transactions').doc(code);
      const mpesaTxDoc = await t.get(mpesaTxRef);

      if (!mpesaTxDoc.exists) {
        return { error: 'not-found', message: 'Transaction not found. Please ensure you entered the correct code and wait a moment for the SMS to be processed.' };
      }

      const mpesaTx = mpesaTxDoc.data();

      if (mpesaTx.used) {
        return { error: 'already-exists', message: 'Code already used' };
      }

      const txAmount = Math.round(mpesaTx.amount);
      if (txAmount !== expectedAmount) {
        return { error: 'invalid-argument', message: `Amount mismatch. Expected KES ${expectedAmount}, but transaction was for KES ${txAmount}` };
      }

      // Time window validation (15 minutes)
      const txTime = mpesaTx.createdAt ? mpesaTx.createdAt.toMillis() : Date.now();
      const now = Date.now();
      if (now - txTime > 15 * 60 * 1000) {
        return { error: 'failed-precondition', message: 'Transaction expired. Only recent transactions can be verified.' };
      }

      // Mark as used
      t.update(mpesaTxRef, { used: true, usedBy: uid, usedAt: FieldValue.serverTimestamp() });

      // Update wallet atomically
      const walletRef = db.collection('wallets').doc(uid);
      t.update(walletRef, {
        balanceKes: FieldValue.increment(txAmount),
        totalDeposited: FieldValue.increment(txAmount),
        updatedAt: FieldValue.serverTimestamp()
      });

      // Create deposit record
      const depositRef = db.collection('deposits').doc();
      t.set(depositRef, {
        userId: uid,
        mpesaCode: code,
        amountKes: txAmount,
        status: 'confirmed',
        createdAt: FieldValue.serverTimestamp(),
        verifiedAt: FieldValue.serverTimestamp()
      });

      // Create transaction ledger record
      const txRef = db.collection('transactions').doc();
      t.set(txRef, {
        userId: uid,
        type: 'deposit',
        amountKes: txAmount,
        direction: 'credit',
        description: 'M-Pesa SMS Deposit',
        reference: code,
        idempotencyKey: `dep_mpesa_${code}`,
        status: 'completed',
        createdAt: FieldValue.serverTimestamp()
      });

      return { success: true, amount: txAmount };
    });

    if (result.error) {
      throw new HttpsError(result.error, result.message);
    }

    await db.collection('auditLog').add({
      actorId: uid, actorType: 'user',
      action: 'deposit_verified',
      targetCollection: 'deposits',
      newValue: { mpesaCode: code, amount: result.amount },
      createdAt: FieldValue.serverTimestamp()
    });

    return result;
  } catch (error) {
    console.error('Verification error:', error);
    if (error instanceof HttpsError || error.code) {
      throw new HttpsError(error.code || 'internal', error.message);
    }
    throw new HttpsError('internal', error.message || 'Verification failed');
  }
});

exports.requestWithdrawal = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = getFirestore();

  const method = request.data.method;
  const amountKes = validateInt(request.data.amountKes, 100, 'amountKes');
  const destination = request.data.destination;

  if (!destination || typeof destination !== 'string') {
    throw new HttpsError('invalid-argument', 'Invalid destination');
  }

  await rateLimit(db, uid, 'requestWithdrawal', 10000); // 10 seconds cooldown

  try {
    const withdrawalId = await db.runTransaction(async (t) => {
      const userRef = db.collection('users').doc(uid);
      const walletRef = db.collection('wallets').doc(uid);
      
      const [userSnap, walletSnap] = await Promise.all([t.get(userRef), t.get(walletRef)]);
      if (!userSnap.exists || !walletSnap.exists) throw new HttpsError('not-found', 'User or wallet not found');
      
      const user = userSnap.data();
      const wallet = walletSnap.data();

      if (wallet.balanceKes < amountKes) throw new HttpsError('failed-precondition', 'Insufficient balance');
      if (!user.kycVerified && amountKes > 5000) throw new HttpsError('failed-precondition', 'KYC required for large withdrawals');

      const feeKes = Math.max(Math.round(amountKes * 0.02), 10);
      const netAmount = amountKes - feeKes;

      // Deduct from balance, add to locked balance
      t.update(walletRef, {
        balanceKes: FieldValue.increment(-amountKes),
        lockedBalance: FieldValue.increment(amountKes),
        updatedAt: FieldValue.serverTimestamp()
      });

      const wdRef = db.collection('withdrawals').doc();
      t.set(wdRef, {
        userId: uid,
        method,
        amountKes,
        feeKes,
        netAmount,
        destination,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp()
      });

      return { id: wdRef.id, netAmount };
    });

    await db.collection('auditLog').add({
      actorId: uid, actorType: 'user',
      action: 'withdrawal_requested',
      targetCollection: 'withdrawals', targetId: withdrawalId.id,
      createdAt: FieldValue.serverTimestamp()
    });

    // B2C logic would go here (omitted for brevity, handled by admin or separate worker)
    return { success: true, message: 'Withdrawal requested successfully' };
  } catch (error) {
    console.error('Withdrawal error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Withdrawal failed');
  }
});
