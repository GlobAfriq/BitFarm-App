import {onRequest} from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import crypto from "crypto";
import {sendFCMToUser} from "./services/fcm.js";
import {checkAndAwardBadge} from "./services/badges.js";
import {rateLimit} from "./utils/security.js";

export const receiveMpesaSMS = onRequest(async (req, res) => {
  const db = getFirestore();
  try {
    const ip = req.ip || "unknown_ip";
    await rateLimit(db, ip, "webhook_sms", 60 * 1000, 60);

    if (!process.env.SMS_LISTENER_API_KEY) {
      console.error("SMS_LISTENER_API_KEY is missing");
      return res.status(500).json({error: "Internal server error"});
    }
    const apiKey = req.headers["x-api-key"];
    if (!apiKey || apiKey !== process.env.SMS_LISTENER_API_KEY) {
      return res.status(401).json({error: "Unauthorized"});
    }

    const rawMessage = req.body.rawMessage || req.body.text || req.body.message;

    if (!rawMessage) {
      return res
        .status(400)
        .json({error: "Missing rawMessage field in JSON body"});
    }

    const codeMatch = rawMessage.match(/\b[A-Z0-9]{10}\b/i);
    const amountMatch = rawMessage.match(/(?:KES|Ksh)\s*([\d,.]+)/i);
    const phoneMatch = rawMessage.match(
      /(2547\d{8}|07\d{8}|2541\d{8}|01\d{8})/,
    );

    if (!codeMatch || !amountMatch) {
      console.error("Failed to parse SMS:", rawMessage);
      await db.collection("unparsed_sms").add({
        rawMessage,
        createdAt: FieldValue.serverTimestamp(),
      });
      return res.status(400).json({error: "Could not parse M-Pesa SMS format"});
    }

    const code = codeMatch[0].toUpperCase();
    const amount = Math.round(parseFloat(amountMatch[1].replace(/,/g, "")));
    const phone = phoneMatch ? phoneMatch[0] : "UNKNOWN";

    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({error: "Invalid amount"});
    }

    const txRef = db.collection("mpesa_transactions").doc(code);

    await db.runTransaction(async (t) => {
      const doc = await t.get(txRef);
      if (doc.exists) {
        throw new Error("Duplicate transaction");
      }

      t.set(txRef, {
        mpesaCode: code,
        amount: amount,
        phone,
        used: false,
        rawMessage,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    res.status(200).json({success: true, message: "Transaction recorded"});
  } catch (error) {
    if (error.code === "resource-exhausted") {
      return res.status(429).json({error: "Too many requests"});
    }
    console.error("receiveMpesaSMS error:", error);
    if (error.message === "Duplicate transaction") {
      return res.status(409).json({error: "Transaction already exists"});
    }
    res.status(500).json({error: "Internal server error"});
  }
});

export const mpesaC2BValidation = onRequest(async (req, res) => {
  const db = getFirestore();
  try {
    const ip = req.ip || "unknown_ip";
    await rateLimit(db, ip, "webhook_c2b_val", 60 * 1000, 60);
    res.status(200).json({ResultCode: 0, ResultDesc: "Accepted"});
  } catch (error) {
    if (error.code === "resource-exhausted") {
      return res.status(429).json({ResultCode: 1, ResultDesc: "Too many requests"});
    }
    res.status(200).json({ResultCode: 0, ResultDesc: "Accepted"});
  }
});

export const mpesaC2BConfirmation = onRequest(async (req, res) => {
  const db = getFirestore();
  try {
    const ip = req.ip || "unknown_ip";
    await rateLimit(db, ip, "webhook_c2b_conf", 60 * 1000, 60);

    const {TransID, TransAmount, BillRefNumber, MSISDN} = req.body;

    if (!TransID || !TransAmount || !BillRefNumber || !MSISDN) {
      return res.status(400).json({ResultCode: 1, ResultDesc: "Malformed payload"});
    }

    let userQuery = await db
      .collection("users")
      .where("phoneNumber", "==", `+${MSISDN}`)
      .get();
    if (userQuery.empty) {
      userQuery = await db
        .collection("users")
        .where("phoneNumber", "==", BillRefNumber)
        .get();
    }

    if (!userQuery.empty) {
      const userDoc = userQuery.docs[0];
      const userId = userDoc.id;
      const amount = Math.round(Number(TransAmount));

      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ResultCode: 1, ResultDesc: "Invalid amount"});
      }

      const isDuplicate = await db.runTransaction(async (t) => {
        // Idempotency check using deterministic document ID
        const txRef = db.collection("transactions").doc(`c2b_${TransID}`);
        const existingTx = await t.get(txRef);
        if (existingTx.exists) return true; // Already processed

        const walletRef = db.collection("wallets").doc(userId);
        t.update(walletRef, {
          balanceKes: FieldValue.increment(amount),
          totalDeposited: FieldValue.increment(amount),
          updatedAt: FieldValue.serverTimestamp(),
        });

        t.set(txRef, {
          userId: userId,
          type: "deposit",
          amountKes: amount,
          direction: "credit",
          description: "M-Pesa Paybill Deposit",
          reference: TransID,
          idempotencyKey: `c2b_${TransID}`,
          status: "completed",
          createdAt: FieldValue.serverTimestamp(),
        });

        return false;
      });

      if (isDuplicate) {
        return res.status(200).json({ResultCode: 0, ResultDesc: "Already processed"});
      }

      await sendFCMToUser(
        userId,
        "✅ Deposit Confirmed!",
        `KES ${amount} added to your wallet via Paybill`,
        "deposit",
      );

      const walletSnap = await db.collection("wallets").doc(userId).get();
      if (walletSnap.data()?.totalDeposited > 50000) {
        await checkAndAwardBadge(userId, "whale");
      }
    }

    res.status(200).json({ResultCode: 0, ResultDesc: "Accepted"});
  } catch (error) {
    if (error.code === "resource-exhausted") {
      return res.status(429).json({ResultCode: 1, ResultDesc: "Too many requests"});
    }
    console.error("M-Pesa C2B Confirmation error", error);
    res.status(200).json({ResultCode: 0, ResultDesc: "Accepted"});
  }
});

export const nowpaymentsCallback = onRequest(async (req, res) => {
  const db = getFirestore();
  try {
    const ip = req.ip || "unknown_ip";
    await rateLimit(db, ip, "webhook_crypto", 60 * 1000, 60);

    const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
    if (!ipnSecret) {
      console.error("NOWPAYMENTS_IPN_SECRET is missing");
      return res.status(500).send("Internal server error");
    }

    const sigHeader = req.headers["x-nowpayments-sig"];
    if (!sigHeader) {
      return res.status(401).send("Missing signature");
    }

    const payloadString = JSON.stringify(
      req.body,
      Object.keys(req.body).sort(),
    );
    const expectedSig = crypto
      .createHmac("sha512", ipnSecret)
      .update(payloadString)
      .digest("hex");

    if (sigHeader !== expectedSig) {
      return res.status(401).send("Invalid signature");
    }

    if (req.body.payment_status === "finished") {
      const paymentId = String(req.body.payment_id);
      const actuallyPaid = Number(req.body.actually_paid);
      const payAmount = Number(req.body.pay_amount);

      if (!req.body.payment_id || isNaN(actuallyPaid) || isNaN(payAmount)) {
        return res.status(400).send("Malformed payload");
      }

      if (actuallyPaid < payAmount) {
        console.error(`Underpaid: expected ${payAmount}, got ${actuallyPaid}`);
        return res.status(400).send("Underpaid");
      }

      const deposits = await db
        .collection("deposits")
        .where("paymentId", "==", paymentId)
        .get();
      if (!deposits.empty) {
        const depositDoc = deposits.docs[0];
        const deposit = depositDoc.data();

        if (deposit.status === "confirmed") {
          return res.status(200).send("Already processed");
        }

        // Use the original requested amountKes to avoid floating point conversion issues
        const amountKes = Math.round(deposit.amountKes);

        const isDuplicate = await db.runTransaction(async (t) => {
          // Idempotency check
          const txRef = db
            .collection("transactions")
            .doc(`crypto_${paymentId}`);
          const existingTx = await t.get(txRef);
          if (existingTx.exists) return true;

          t.update(depositDoc.ref, {
            status: "confirmed",
            confirmedAt: FieldValue.serverTimestamp(),
          });

          const walletRef = db.collection("wallets").doc(deposit.userId);
          t.update(walletRef, {
            balanceKes: FieldValue.increment(amountKes),
            totalDeposited: FieldValue.increment(amountKes),
            updatedAt: FieldValue.serverTimestamp(),
          });

          t.set(txRef, {
            userId: deposit.userId,
            type: "deposit",
            amountKes,
            direction: "credit",
            description: "USDT Deposit",
            reference: paymentId,
            idempotencyKey: `crypto_${paymentId}`,
            status: "completed",
            createdAt: FieldValue.serverTimestamp(),
          });

          return false;
        });

        if (isDuplicate) {
          return res.status(200).send("Already processed");
        }

        await sendFCMToUser(
          deposit.userId,
          "✅ USDT Deposit Confirmed!",
          `KES ${amountKes} added to your wallet`,
          "deposit",
        );
      }
    }
    res.status(200).send("OK");
  } catch (error) {
    if (error.code === "resource-exhausted") {
      return res.status(429).send("Too many requests");
    }
    console.error("NOWPayments callback error", error);
    res.status(200).send("OK");
  }
});
