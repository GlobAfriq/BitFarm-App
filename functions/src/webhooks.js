const { onRequest } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');
const { sendFCMToUser } = require('./services/fcm');
const { checkAndAwardBadge } = require('./services/badges');

exports.receiveMpesaSMS = onRequest(async (req, res) => {
  const db = getFirestore();
  try {
    // Basic API Key authentication for the Android app
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.SMS_LISTENER_API_KEY && process.env.NODE_ENV === 'production') {
      if (apiKey !== 'BITFARM_SMS_SECRET_2026') {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const rawMessage = req.body.rawMessage || req.body.text || req.body.message;

    if (!rawMessage) {
      return res.status(400).json({ error: 'Missing rawMessage field in JSON body' });
    }

    const codeMatch = rawMessage.match(/\b[A-Z0-9]{10}\b/i);
    const amountMatch = rawMessage.match(/(?:KES|Ksh)\s*([\d,.]+)/i);
    const phoneMatch = rawMessage.match(/(2547\d{8}|07\d{8}|2541\d{8}|01\d{8})/);

    if (!codeMatch || !amountMatch) {
      console.error('Failed to parse SMS:', rawMessage);
      await db.collection('unparsed_sms').add({
        rawMessage,
        createdAt: FieldValue.serverTimestamp()
      });
      return res.status(400).json({ error: 'Could not parse M-Pesa SMS format' });
    }

    const code = codeMatch[0].toUpperCase();
    const amount = Math.round(parseFloat(amountMatch[1].replace(/,/g, '')));
    const phone = phoneMatch ? phoneMatch[0] : 'UNKNOWN';

    const txRef = db.collection('mpesa_transactions').doc(code);
    
    await db.runTransaction(async (t) => {
      const doc = await t.get(txRef);
      if (doc.exists) {
        throw new Error('Duplicate transaction');
      }
      
      t.set(txRef, {
        mpesaCode: code,
        amount: amount,
        phone,
        used: false,
        rawMessage,
        createdAt: FieldValue.serverTimestamp()
      });
    });

    res.status(200).json({ success: true, message: 'Transaction recorded' });
  } catch (error) {
    console.error('receiveMpesaSMS error:', error);
    if (error.message === 'Duplicate transaction') {
      return res.status(409).json({ error: 'Transaction already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

exports.mpesaC2BValidation = onRequest(async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

exports.mpesaC2BConfirmation = onRequest(async (req, res) => {
  const db = getFirestore();
  try {
    const { TransID, TransAmount, BillRefNumber, MSISDN } = req.body;
    
    if (!TransID) return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

    let userQuery = await db.collection('users').where('phoneNumber', '==', `+${MSISDN}`).get();
    if (userQuery.empty) {
      userQuery = await db.collection('users').where('phoneNumber', '==', BillRefNumber).get();
    }

    if (!userQuery.empty) {
      const userDoc = userQuery.docs[0];
      const userId = userDoc.id;
      const amount = Math.round(Number(TransAmount));

      await db.runTransaction(async (t) => {
        // Idempotency check using deterministic document ID
        const txRef = db.collection('transactions').doc(`c2b_${TransID}`);
        const existingTx = await t.get(txRef);
        if (existingTx.exists) return; // Already processed

        const walletRef = db.collection('wallets').doc(userId);
        t.update(walletRef, {
          balanceKes: FieldValue.increment(amount),
          totalDeposited: FieldValue.increment(amount),
          updatedAt: FieldValue.serverTimestamp()
        });

        t.set(txRef, {
          userId: userId, 
          type: 'deposit', 
          amountKes: amount,
          direction: 'credit', 
          description: 'M-Pesa Paybill Deposit', 
          reference: TransID,
          idempotencyKey: `c2b_${TransID}`,
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
    const payloadString = JSON.stringify(req.body, Object.keys(req.body).sort());
    const expectedSig = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET || 'fallback_secret')
      .update(payloadString).digest('hex');
    
    if (req.headers['x-nowpayments-sig'] !== expectedSig && process.env.NODE_ENV === 'production') {
      return res.status(401).send('Invalid signature');
    }

    if (req.body.payment_status === 'finished') {
      const paymentId = String(req.body.payment_id);
      const actuallyPaid = Number(req.body.actually_paid);
      const payAmount = Number(req.body.pay_amount);

      if (actuallyPaid < payAmount) {
        console.error(`Underpaid: expected ${payAmount}, got ${actuallyPaid}`);
        return res.status(400).send('Underpaid');
      }

      const deposits = await db.collection('deposits').where('paymentId', '==', paymentId).get();
      if (!deposits.empty) {
        const depositDoc = deposits.docs[0];
        const deposit = depositDoc.data();

        if (deposit.status === 'confirmed') {
          return res.status(200).send('Already processed');
        }

        // Use the original requested amountKes to avoid floating point conversion issues
        const amountKes = Math.round(deposit.amountKes);

        await db.runTransaction(async (t) => {
          // Idempotency check
          const txRef = db.collection('transactions').doc(`crypto_${paymentId}`);
          const existingTx = await t.get(txRef);
          if (existingTx.exists) return;

          t.update(depositDoc.ref, { status: 'confirmed', confirmedAt: FieldValue.serverTimestamp() });
          
          const walletRef = db.collection('wallets').doc(deposit.userId);
          t.update(walletRef, {
            balanceKes: FieldValue.increment(amountKes),
            totalDeposited: FieldValue.increment(amountKes),
            updatedAt: FieldValue.serverTimestamp()
          });

          t.set(txRef, {
            userId: deposit.userId, 
            type: 'deposit', 
            amountKes,
            direction: 'credit', 
            description: 'USDT Deposit', 
            reference: paymentId,
            idempotencyKey: `crypto_${paymentId}`,
            status: 'completed', 
            createdAt: FieldValue.serverTimestamp()
          });
        });

        await sendFCMToUser(deposit.userId, '✅ USDT Deposit Confirmed!', `KES ${amountKes} added to your wallet`, 'deposit');
      }
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('NOWPayments callback error', error);
    res.status(200).send('OK');
  }
});
