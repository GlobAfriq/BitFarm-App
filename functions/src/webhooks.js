const { onRequest } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');
const { sendFCMToUser } = require('./services/fcm');
const { checkAndAwardBadge } = require('./services/badges');

exports.mpesaCallback = onRequest(async (req, res) => {
  const db = getFirestore();
  try {
    const callbackData = req.body?.Body?.stkCallback;
    if (!callbackData) return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

    if (callbackData.ResultCode === 0) {
      const items = callbackData.CallbackMetadata.Item;
      const amount = items.find(i => i.Name === 'Amount')?.Value;
      const receipt = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
      const checkoutRequestId = callbackData.CheckoutRequestID;

      const deposits = await db.collection('deposits').where('checkoutRequestId', '==', checkoutRequestId).get();
      if (!deposits.empty) {
        const depositDoc = deposits.docs[0];
        const deposit = depositDoc.data();
        
        await db.runTransaction(async (t) => {
          t.update(depositDoc.ref, { status: 'confirmed', externalRef: receipt, confirmedAt: FieldValue.serverTimestamp() });
          
          const walletRef = db.collection('wallets').doc(deposit.userId);
          t.update(walletRef, {
            balanceKes: FieldValue.increment(amount),
            totalDeposited: FieldValue.increment(amount),
            updatedAt: FieldValue.serverTimestamp()
          });

          const txRef = db.collection('transactions').doc();
          t.set(txRef, {
            userId: deposit.userId, type: 'deposit', amountKes: amount,
            direction: 'credit', description: 'M-Pesa Deposit', reference: receipt,
            status: 'completed', createdAt: FieldValue.serverTimestamp()
          });
        });

        await sendFCMToUser(deposit.userId, '✅ Deposit Confirmed!', `KES ${amount} added to your wallet`, 'deposit');
        
        const walletSnap = await db.collection('wallets').doc(deposit.userId).get();
        if (walletSnap.data()?.totalDeposited > 50000) {
          await checkAndAwardBadge(deposit.userId, 'whale');
        }
      }
    }
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('M-Pesa callback error', error);
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

exports.nowpaymentsCallback = onRequest(async (req, res) => {
  const db = getFirestore();
  try {
    const expectedSig = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET)
      .update(JSON.stringify(req.body, Object.keys(req.body).sort())).digest('hex');
    
    if (req.headers['x-nowpayments-sig'] !== expectedSig) return res.status(401).send('Invalid');

    if (req.body.payment_status === 'finished') {
      const amountKes = req.body.pay_amount * 130; // Approx rate
      const paymentId = req.body.payment_id;

      const deposits = await db.collection('deposits').where('paymentId', '==', paymentId).get();
      if (!deposits.empty) {
        const depositDoc = deposits.docs[0];
        const deposit = depositDoc.data();

        await db.runTransaction(async (t) => {
          t.update(depositDoc.ref, { status: 'confirmed', confirmedAt: FieldValue.serverTimestamp() });
          
          const walletRef = db.collection('wallets').doc(deposit.userId);
          t.update(walletRef, {
            balanceKes: FieldValue.increment(amountKes),
            totalDeposited: FieldValue.increment(amountKes),
            updatedAt: FieldValue.serverTimestamp()
          });

          const txRef = db.collection('transactions').doc();
          t.set(txRef, {
            userId: deposit.userId, type: 'deposit', amountKes,
            direction: 'credit', description: 'USDT Deposit', reference: paymentId,
            status: 'completed', createdAt: FieldValue.serverTimestamp()
          });
        });

        await sendFCMToUser(deposit.userId, '✅ USDT Deposit Confirmed!', `KES added to your wallet`, 'deposit');
      }
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('NOWPayments callback error', error);
    res.status(200).send('OK');
  }
});