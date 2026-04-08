const { onRequest } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');
const { sendFCMToUser } = require('./services/fcm');
const { checkAndAwardBadge } = require('./services/badges');

exports.mpesaC2BValidation = onRequest(async (req, res) => {
  // M-Pesa C2B Validation Endpoint
  // Always accept the payment in this example
  res.status(200).json({
    ResultCode: 0,
    ResultDesc: 'Accepted'
  });
});

exports.mpesaC2BConfirmation = onRequest(async (req, res) => {
  const db = getFirestore();
  try {
    const { TransID, TransAmount, BillRefNumber, MSISDN } = req.body;
    
    if (!TransID) return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

    // BillRefNumber is expected to be the user's phone number or account ID
    // Find the pending deposit matching this account number and amount
    // Or just find the user by phone number and credit their wallet directly
    
    // For this implementation, we'll find the user by phone number (BillRefNumber or MSISDN)
    let userQuery = await db.collection('users').where('phoneNumber', '==', `+${MSISDN}`).get();
    if (userQuery.empty) {
      userQuery = await db.collection('users').where('phoneNumber', '==', BillRefNumber).get();
    }

    if (!userQuery.empty) {
      const userDoc = userQuery.docs[0];
      const userId = userDoc.id;
      const amount = Number(TransAmount);

      await db.runTransaction(async (t) => {
        // Check if this transaction was already processed
        const existingTx = await t.get(db.collection('transactions').where('reference', '==', TransID).limit(1));
        if (!existingTx.empty) return; // Already processed

        const walletRef = db.collection('wallets').doc(userId);
        t.update(walletRef, {
          balanceKes: FieldValue.increment(amount),
          totalDeposited: FieldValue.increment(amount),
          updatedAt: FieldValue.serverTimestamp()
        });

        const txRef = db.collection('transactions').doc();
        t.set(txRef, {
          userId: userId, 
          type: 'deposit', 
          amountKes: amount,
          direction: 'credit', 
          description: 'M-Pesa Paybill Deposit', 
          reference: TransID,
          status: 'completed', 
          createdAt: FieldValue.serverTimestamp()
        });
      });

      await sendFCMToUser(userId, '✅ Deposit Confirmed!', `KES ${amount} added to your wallet via Paybill`, 'deposit');
      
      const walletSnap = await db.collection('wallets').doc(userId).get();
      if (walletSnap.data()?.totalDeposited > 50000) {
        await checkAndAwardBadge(userId, 'whale');
      }
    }
    
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('M-Pesa C2B Confirmation error', error);
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