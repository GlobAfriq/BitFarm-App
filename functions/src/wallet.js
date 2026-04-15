import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import axios from "axios";
import {requireAuth, validateInt, rateLimit} from "./utils/security.js";
import {getDb} from "./utils/db.js";

const normalizeCode = (code) => code.trim().toUpperCase();

export const submitDepositProof = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = getDb();
  const {amountKes, mpesaCode} = request.data;

  if (!amountKes || amountKes < 50)
    throw new HttpsError("invalid-argument", "Minimum deposit is KES 50");
  if (!mpesaCode || mpesaCode.length < 8)
    throw new HttpsError("invalid-argument", "Invalid M-PESA code");

  await rateLimit(db, uid, "submitDepositProof", 3000);

  const normalizedCode = normalizeCode(mpesaCode);

  await db.runTransaction(async (t) => {
    const codeRef = db
      .collection("reservedTransactionCodes")
      .doc(normalizedCode);
    const codeSnap = await t.get(codeRef);

    if (codeSnap.exists) {
      throw new HttpsError(
        "already-exists",
        "This M-PESA code has already been submitted.",
      );
    }

    // Check if user already has a pending request
    const activeRequests = await db
      .collection("depositRequests")
      .where("userId", "==", uid)
      .where("status", "==", "pending_admin_review")
      .get();

    if (!activeRequests.empty) {
      throw new HttpsError(
        "failed-precondition",
        "You already have a pending deposit request.",
      );
    }

    const requestRef = db.collection("depositRequests").doc();

    // Reserve the code globally
    t.set(codeRef, {
      code: normalizedCode,
      depositRequestId: requestRef.id,
      userId: uid,
      status: "reserved",
      reservedAt: FieldValue.serverTimestamp(),
    });

    // Create request
    t.set(requestRef, {
      userId: uid,
      amountKes: Number(amountKes),
      mpesaCode: normalizedCode,
      status: "pending_admin_review",
      createdAt: FieldValue.serverTimestamp(),
      submittedAt: FieldValue.serverTimestamp(),
    });
  });

  return {success: true};
});

export const requestWithdrawal = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = getDb();

  const method = request.data.method;
  const amountKes = validateInt(request.data.amountKes, 100, "amountKes");
  const destination = request.data.destination;

  if (!destination || typeof destination !== "string") {
    throw new HttpsError("invalid-argument", "Invalid destination");
  }

  await rateLimit(db, uid, "requestWithdrawal", 10000); // 10 seconds cooldown

  try {
    const withdrawalId = await db.runTransaction(async (t) => {
      const userRef = db.collection("users").doc(uid);
      const walletRef = db.collection("wallets").doc(uid);

      const [userSnap, walletSnap] = await Promise.all([
        t.get(userRef),
        t.get(walletRef),
      ]);
      if (!userSnap.exists || !walletSnap.exists)
        throw new HttpsError("not-found", "User or wallet not found");

      const user = userSnap.data();
      const wallet = walletSnap.data();

      if (wallet.balanceKes < amountKes)
        throw new HttpsError("failed-precondition", "Insufficient balance");
      if (!user.kycVerified && amountKes > 5000)
        throw new HttpsError(
          "failed-precondition",
          "KYC required for large withdrawals",
        );

      const feeKes = Math.max(Math.round(amountKes * 0.02), 10);
      const netAmount = amountKes - feeKes;

      // Deduct from balance, add to locked balance
      t.update(walletRef, {
        balanceKes: FieldValue.increment(-amountKes),
        lockedBalance: FieldValue.increment(amountKes),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const wdRef = db.collection("withdrawals").doc();
      t.set(wdRef, {
        userId: uid,
        method,
        amountKes,
        feeKes,
        netAmount,
        destination,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
      });

      return {id: wdRef.id, netAmount};
    });

    await db.collection("auditLog").add({
      actorId: uid,
      actorType: "user",
      action: "withdrawal_requested",
      targetCollection: "withdrawals",
      targetId: withdrawalId.id,
      createdAt: FieldValue.serverTimestamp(),
    });

    // B2C logic would go here (omitted for brevity, handled by admin or separate worker)
    return {success: true, message: "Withdrawal requested successfully"};
  } catch (error) {
    console.error("Withdrawal error:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Withdrawal failed");
  }
});
