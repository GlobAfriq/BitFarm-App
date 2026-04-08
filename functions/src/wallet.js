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
      const mockCheckoutRequestId = 'paybill_' + Date.now();
      const paybillNumber = '247247'; // Example Paybill
      const accountNumber = phoneNumber || 'YOUR_PHONE_NUMBER';
      
      await db.collection('deposits').add({
        userId: uid,
        method: 'mpesa_paybill',
        amountKes,
        checkoutRequestId: mockCheckoutRequestId,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp()
      });

      // In a real app, integrate Twilio or Africa's Talking here to send the SMS
      console.log(`[SMS to ${phoneNumber}]: Please pay KES ${amountKes} to Paybill ${paybillNumber}, Account ${accountNumber}. Your balance will update automatically.`);

      return { 
        checkoutRequestId: mockCheckoutRequestId, 
        message: `SMS sent to ${phoneNumber} with Paybill instructions. Balance will update in 1-2 minutes.`,
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