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
      // For testing in preview, we might bypass or use a default key if not set
      if (apiKey !== 'BITFARM_SMS_SECRET_2026') {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const rawMessage = req.body.rawMessage || req.body.text || req.body.message;

    if (!rawMessage) {
      return res.status(400).json({ error: 'Missing rawMessage field in JSON body' });
    }

    // Extract M-Pesa Code (10 alphanumeric characters anywhere in the message)
    // NCBA messages usually have "Ref: QGH7S8X2K" or similar.
    const codeMatch = rawMessage.match(/\b[A-Z0-9]{10}\b/i);
    // Extract Amount (e.g., KES 1,500.00, KES1500, Ksh 1500)
    const amountMatch = rawMessage.match(/(?:KES|Ksh)\s*([\d,.]+)/i);
    // Extract Phone Number (e.g., 2547XXXXXXXX, 07XXXXXXXX, 2541XXXXXXXX, 01XXXXXXXX)
    const phoneMatch = rawMessage.match(/(2547\d{8}|07\d{8}|2541\d{8}|01\d{8})/);

    if (!codeMatch || !amountMatch) {
      console.error('Failed to parse SMS:', rawMessage);
      // Save unparsed SMS for manual review so you don't lose data
      await db.collection('unparsed_sms').add({
        rawMessage,
        createdAt: FieldValue.serverTimestamp()
      });
      return res.status(400).json({ error: 'Could not parse M-Pesa SMS format' });
    }

    const code = codeMatch[0].toUpperCase();
    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    const phone = phoneMatch ? phoneMatch[0] : 'UNKNOWN';

    const txRef = db.collection('mpesa_transactions').doc(code);
    
    await db.runTransaction(async (t) => {
      const doc = await t.get(txRef);
      if (doc.exists) {
        throw new Error('Duplicate transaction');
      }
      
      t.set(txRef, {
        mpesaCode: code,
        amount: Number(amount),
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