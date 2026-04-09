const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');

exports.initiateDeposit = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in');
  const uid = request.auth.uid;
  const { method, amountKes, phoneNumber } = request.data;
  const db = getFirestore();

  if (amountKes < 50) throw new HttpsError('invalid-argument', 'Minimum deposit is KES 50');

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
        price_amount: amountKes / 130,
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
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in');
  const uid = request.auth.uid;
  const { mpesaCode, expectedAmount } = request.data;
  const db = getFirestore();

  if (!mpesaCode || !expectedAmount) {
    throw new HttpsError('invalid-argument', 'Missing mpesaCode or expectedAmount');
  }

  const code = mpesaCode.toUpperCase().trim();

  // Rate limiting: Check recent verification attempts
  const attemptsRef = db.collection('verification_attempts').doc(uid);
  const attemptsDoc = await attemptsRef.get();
  
  if (attemptsDoc.exists) {
    const data = attemptsDoc.data();
    const now = Date.now();
    const windowStart = now - 15 * 60 * 1000; // 15 minutes
    
    const recentAttempts = (data.timestamps || []).filter(t => t.toMillis() > windowStart);
    if (recentAttempts.length >= 5) {
      throw new HttpsError('resource-exhausted', 'Too many verification attempts. Please try again later.');
    }
    
    await attemptsRef.update({
      timestamps: FieldValue.arrayUnion(FieldValue.serverTimestamp())
    });
  } else {
    await attemptsRef.set({
      timestamps: [FieldValue.serverTimestamp()]
    });
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

      if (mpesaTx.amount !== expectedAmount) {
        return { error: 'invalid-argument', message: `Amount mismatch. Expected KES ${expectedAmount}, but transaction was for KES ${mpesaTx.amount}` };
      }

      // Time window validation (15 minutes)
      const txTime = mpesaTx.createdAt ? mpesaTx.createdAt.toMillis() : Date.now();
      const now = Date.now();
      if (now - txTime > 15 * 60 * 1000) {
        return { error: 'failed-precondition', message: 'Transaction expired. Only recent transactions can be verified.' };
      }

      // Mark as used
      t.update(mpesaTxRef, { used: true, usedBy: uid, usedAt: FieldValue.serverTimestamp() });

      // Update wallet
      const walletRef = db.collection('wallets').doc(uid);
      t.update(walletRef, {
        balanceKes: FieldValue.increment(mpesaTx.amount),
        totalDeposited: FieldValue.increment(mpesaTx.amount),
        updatedAt: FieldValue.serverTimestamp()
      });

      // Create deposit record
      const depositRef = db.collection('deposits').doc();
      t.set(depositRef, {
        userId: uid,
        mpesaCode: code,
        amountKes: mpesaTx.amount,
        status: 'confirmed',
        createdAt: FieldValue.serverTimestamp(),
        verifiedAt: FieldValue.serverTimestamp()
      });

      // Create transaction record
      const txRef = db.collection('transactions').doc();
      t.set(txRef, {
        userId: uid,
        type: 'deposit',
        amountKes: mpesaTx.amount,
        direction: 'credit',
        description: 'M-Pesa SMS Deposit',
        reference: code,
        status: 'completed',
        createdAt: FieldValue.serverTimestamp()
      });

      return { success: true, amount: mpesaTx.amount };
    });

    if (result.error) {
      throw new HttpsError(result.error, result.message);
    }

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
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in');
  const uid = request.auth.uid;
  const { method, amountKes, destination } = request.data;
  const db = getFirestore();

  if (amountKes < 100) throw new HttpsError('invalid-argument', 'Minimum withdrawal is KES 100');

  try {
    const withdrawalId = await db.runTransaction(async (t) => {
      const userRef = db.collection('users').doc(uid);
      const walletRef = db.collection('wallets').doc(uid);
      
      const [userSnap, walletSnap] = await Promise.all([t.get(userRef), t.get(walletRef)]);
      const user = userSnap.data();
      const wallet = walletSnap.data();

      if (wallet.balanceKes < amountKes) throw new HttpsError('failed-precondition', 'Insufficient balance');
      if (!user.kycVerified && amountKes > 5000) throw new HttpsError('failed-precondition', 'KYC required for large withdrawals');

      const feeKes = Math.max(amountKes * 0.02, 10);
      const netAmount = amountKes - feeKes;

      t.update(walletRef, {
        balanceKes: wallet.balanceKes - amountKes,
        lockedBalance: wallet.lockedBalance + amountKes,
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

    if (method === 'mpesa') {
      if (!process.env.MPESA_CONSUMER_KEY || !process.env.MPESA_SHORTCODE) {
        // SIMULATION MODE
        console.log('M-Pesa credentials missing. Simulating B2C withdrawal.');
        setTimeout(async () => {
          try {
            await db.runTransaction(async (t) => {
              const wdRef = db.collection('withdrawals').doc(withdrawalId.id);
              t.update(wdRef, { status: 'completed', completedAt: FieldValue.serverTimestamp(), transactionId: 'SIM_B2C_' + Date.now() });
              
              const walletRef = db.collection('wallets').doc(uid);
              t.update(walletRef, {
                lockedBalance: FieldValue.increment(-amountKes),
                totalWithdrawn: FieldValue.increment(amountKes),
                updatedAt: FieldValue.serverTimestamp()
              });

              const txRef = db.collection('transactions').doc();
              t.set(txRef, {
                userId: uid, type: 'withdrawal', amountKes: amountKes,
                direction: 'debit', description: 'M-Pesa Withdrawal', reference: 'SIM_B2C_' + Date.now(),
                status: 'completed', createdAt: FieldValue.serverTimestamp()
              });
            });
            console.log('Simulated M-Pesa B2C processed successfully.');
          } catch (e) {
            console.error('Simulated B2C error', e);
          }
        }, 5000);
      } else {
        // REAL B2C INTEGRATION
        try {
          const authHeader = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
          const tokenRes = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: `Basic ${authHeader}` }
          });
          const token = tokenRes.data.access_token;

          await axios.post('https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest', {
            InitiatorName: process.env.MPESA_INITIATOR_NAME,
            SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
            CommandID: 'BusinessPayment',
            Amount: withdrawalId.netAmount,
            PartyA: process.env.MPESA_SHORTCODE,
            PartyB: destination.replace('+', ''),
            Remarks: 'BitFarm Withdrawal',
            QueueTimeOutURL: process.env.MPESA_B2C_TIMEOUT_URL,
            ResultURL: process.env.MPESA_B2C_RESULT_URL,
            Occasion: 'Withdrawal'
          }, { headers: { Authorization: `Bearer ${token}` } });
          
        } catch (error) {
          console.error('M-Pesa B2C error', error.response?.data || error.message);
          // We don't throw here because the withdrawal is already recorded as pending.
          // An admin would need to retry or fail it manually if the API call fails.
        }
      }
    }

    return { success: true, withdrawalId: withdrawalId.id };
  } catch (error) {
    throw new HttpsError('internal', error.message);
  }
});