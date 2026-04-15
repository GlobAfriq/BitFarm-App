import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import {getMessaging} from "firebase-admin/messaging";
import bcrypt from "bcryptjs";
import {processPayouts} from "./jobs/weeklyPayouts.js";
import {sendFCMToUser} from "./services/fcm.js";
import {rateLimit} from "./utils/security.js";

const requireAdmin = async (request, db) => {
  if (!request.auth?.token?.admin)
    throw new HttpsError("permission-denied", "Admin only");
  
  // Rate limit admin actions: 100 requests per 5 minutes
  await rateLimit(db, request.auth.uid, "admin_action", 5 * 60 * 1000, 100);
};

export const signInAdmin = onCall(async (request) => {
  try {
    const {username, password} = request.data;
    const db = getFirestore();
    
    // Rate limit admin login: 5 attempts per 15 minutes per IP
    const ip = request.rawRequest?.ip || "unknown_ip";
    await rateLimit(db, ip, "admin_login", 15 * 60 * 1000, 5);

    const adminSnap = await db
      .collection("admins")
      .where("username", "==", username)
      .limit(1)
      .get();

    if (adminSnap.empty)
      throw new HttpsError("permission-denied", "Invalid credentials");

    const adminDoc = adminSnap.docs[0];
    const adminData = adminDoc.data();

    const match = await bcrypt.compare(password, adminData.passwordHash);
    if (!match)
      throw new HttpsError("permission-denied", "Invalid credentials");

    const customToken = await getAuth().createCustomToken(adminDoc.id, {
      admin: true,
    });

    await db.collection("auditLog").add({
      actorId: adminDoc.id,
      actorType: "admin",
      action: "admin_login",
      createdAt: FieldValue.serverTimestamp(),
    });

    return {token: customToken};
  } catch (error) {
    console.error("signInAdmin Error:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Internal server error");
  }
});

export const verifyDepositRequest = onCall(async (request) => {
  const db = getFirestore();
  await requireAdmin(request, db);
  const {depositRequestId} = request.data;

  await db.runTransaction(async (t) => {
    const requestRef = db.collection("depositRequests").doc(depositRequestId);
    const requestSnap = await t.get(requestRef);

    if (
      !requestSnap.exists ||
      requestSnap.data().status !== "pending_admin_review"
    ) {
      throw new HttpsError("failed-precondition", "Invalid request state");
    }

    const requestData = requestSnap.data();
    const normalizedCode = requestData.mpesaCode;
    const amountKes = requestData.amountKes;
    const userId = requestData.userId;

    const codeRef = db
      .collection("reservedTransactionCodes")
      .doc(normalizedCode);
    const walletRef = db.collection("wallets").doc(userId);
    const ledgerRef = db.collection("walletLedger").doc();
    const auditRef = db.collection("adminAuditLogs").doc();
    const notificationRef = db.collection("notifications").doc();

    // 1. Update Request
    t.update(requestRef, {
      status: "verified",
      resolvedAt: FieldValue.serverTimestamp(),
    });

    // 2. Mark code as used
    t.update(codeRef, {status: "used"});

    // 3. Credit Wallet
    t.set(
      walletRef,
      {
        balanceKes: FieldValue.increment(amountKes),
        totalDeposited: FieldValue.increment(amountKes),
        updatedAt: FieldValue.serverTimestamp(),
      },
      {merge: true},
    );

    // 4. Write Immutable Ledger Entry
    t.set(ledgerRef, {
      userId,
      type: "deposit",
      amountKes,
      direction: "credit",
      description: "Manual M-PESA Deposit Verified",
      reference: normalizedCode,
      idempotencyKey: `dep_manual_${normalizedCode}`, // Prevents duplicate ledger entries
      status: "completed",
      createdAt: FieldValue.serverTimestamp(),
    });

    // 5. Audit Log
    t.set(auditRef, {
      adminId: request.auth.uid,
      action: "verify_deposit",
      targetId: depositRequestId,
      details: {amountKes, mpesaCode: normalizedCode},
      createdAt: FieldValue.serverTimestamp(),
    });

    // 6. Notification
    t.set(notificationRef, {
      userId,
      title: "Deposit Verified! ✅",
      body: `Your deposit of KES ${amountKes} has been credited to your wallet.`,
      read: false,
      type: "deposit",
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {success: true};
});

export const rejectDepositRequest = onCall(async (request) => {
  const db = getFirestore();
  await requireAdmin(request, db);
  const {depositRequestId, reason} = request.data;

  await db.runTransaction(async (t) => {
    const requestRef = db.collection("depositRequests").doc(depositRequestId);
    const requestSnap = await t.get(requestRef);

    if (
      !requestSnap.exists ||
      requestSnap.data().status !== "pending_admin_review"
    ) {
      throw new HttpsError("failed-precondition", "Invalid request state");
    }

    const requestData = requestSnap.data();
    const codeRef = db
      .collection("reservedTransactionCodes")
      .doc(requestData.mpesaCode);

    t.update(requestRef, {
      status: "rejected",
      rejectionReason: reason,
      resolvedAt: FieldValue.serverTimestamp(),
    });

    t.update(codeRef, {status: "rejected"}); // Keep reserved but marked rejected to prevent reuse

    t.set(db.collection("adminAuditLogs").doc(), {
      adminId: request.auth.uid,
      action: "reject_deposit",
      targetId: depositRequestId,
      details: {reason, mpesaCode: requestData.mpesaCode},
      createdAt: FieldValue.serverTimestamp(),
    });

    t.set(db.collection("notifications").doc(), {
      userId: requestData.userId,
      title: "Deposit Rejected ❌",
      body: `Your deposit request was rejected. Reason: ${reason}`,
      read: false,
      type: "deposit",
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {success: true};
});

export const getAdminDashboard = onCall(async (request) => {
  await requireAdmin(request, getFirestore());
  const db = getFirestore();

  const [users, machines, withdrawals, payouts] = await Promise.all([
    db.collection("users").count().get(),
    db.collection("userMachines").where("isActive", "==", true).count().get(),
    db.collection("withdrawals").where("status", "==", "pending").count().get(),
    db
      .collection("payouts")
      .aggregate({total: {sum: "amountKes"}})
      .get(),
  ]);

  return {
    totalUsers: users.data().count,
    activeMachines: machines.data().count,
    pendingWithdrawals: withdrawals.data().count,
    totalPayoutsPaid: payouts.data().total || 0,
  };
});

export const getAllUsers = onCall(async (request) => {
  await requireAdmin(request, getFirestore());
  const db = getFirestore();
  const query = db.collection("users").limit(50);
  const snap = await query.get();

  const users = [];
  for (const doc of snap.docs) {
    const wallet = await db.collection("wallets").doc(doc.id).get();
    users.push({...doc.data(), balanceKes: wallet.data()?.balanceKes || 0});
  }
  return {users, hasMore: false};
});

export const suspendUser = onCall(async (request) => {
  await requireAdmin(request, getFirestore());
  const {uid, suspend} = request.data;
  const db = getFirestore();

  await db.collection("users").doc(uid).update({isActive: !suspend});
  await db.collection("auditLog").add({
    actorId: request.auth.uid,
    actorType: "admin",
    action: suspend ? "user_suspended" : "user_unsuspended",
    targetId: uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return {success: true};
});

export const approveWithdrawal = onCall(async (request) => {
  await requireAdmin(request, getFirestore());
  const {withdrawalId} = request.data;
  const db = getFirestore();

  await db.runTransaction(async (t) => {
    const wdRef = db.collection("withdrawals").doc(withdrawalId);
    const wdSnap = await t.get(wdRef);
    if (!wdSnap.exists || wdSnap.data().status !== "pending")
      throw new HttpsError("failed-precondition", "Invalid withdrawal");

    const wd = wdSnap.data();
    const walletRef = db.collection("wallets").doc(wd.userId);

    t.update(wdRef, {
      status: "paid",
      approvedBy: request.auth.uid,
      processedAt: FieldValue.serverTimestamp(),
    });
    t.update(walletRef, {
      lockedBalance: FieldValue.increment(-wd.amountKes),
      totalWithdrawn: FieldValue.increment(wd.amountKes),
    });

    const txRef = db.collection("transactions").doc();
    t.set(txRef, {
      userId: wd.userId,
      type: "withdrawal",
      amountKes: wd.amountKes,
      direction: "debit",
      description: "Withdrawal Approved",
      status: "completed",
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  const wd = (
    await db.collection("withdrawals").doc(withdrawalId).get()
  ).data();
  await sendFCMToUser(
    wd.userId,
    "✅ Withdrawal Approved",
    `Your KES ${wd.amountKes} withdrawal has been sent.`,
    "withdrawal",
  );

  await db.collection("auditLog").add({
    actorId: request.auth.uid,
    actorType: "admin",
    action: "withdrawal_approved",
    targetId: withdrawalId,
    createdAt: FieldValue.serverTimestamp(),
  });
  return {success: true};
});

export const rejectWithdrawal = onCall(async (request) => {
  await requireAdmin(request, getFirestore());
  const {withdrawalId, reason} = request.data;
  const db = getFirestore();

  await db.runTransaction(async (t) => {
    const wdRef = db.collection("withdrawals").doc(withdrawalId);
    const wdSnap = await t.get(wdRef);
    if (!wdSnap.exists || wdSnap.data().status !== "pending")
      throw new HttpsError("failed-precondition", "Invalid withdrawal");

    const wd = wdSnap.data();
    const walletRef = db.collection("wallets").doc(wd.userId);

    t.update(wdRef, {
      status: "rejected",
      approvedBy: request.auth.uid,
      rejectionReason: reason,
      processedAt: FieldValue.serverTimestamp(),
    });
    t.update(walletRef, {
      lockedBalance: FieldValue.increment(-wd.amountKes),
      balanceKes: FieldValue.increment(wd.amountKes),
    });
  });

  const wd = (
    await db.collection("withdrawals").doc(withdrawalId).get()
  ).data();
  await sendFCMToUser(
    wd.userId,
    "❌ Withdrawal Declined",
    `KES ${wd.amountKes} returned to wallet. Reason: ${reason}`,
    "withdrawal",
  );

  await db.collection("auditLog").add({
    actorId: request.auth.uid,
    actorType: "admin",
    action: "withdrawal_rejected",
    targetId: withdrawalId,
    newValue: {reason},
    createdAt: FieldValue.serverTimestamp(),
  });
  return {success: true};
});

export const runPayoutsNow = onCall(async (request) => {
  await requireAdmin(request, getFirestore());
  const db = getFirestore();
  const result = await processPayouts(db);
  await db.collection("auditLog").add({
    actorId: request.auth.uid,
    actorType: "admin",
    action: "manual_payout_triggered",
    createdAt: FieldValue.serverTimestamp(),
  });
  return {success: true, processed: result.processed};
});

export const broadcastNotification = onCall(async (request) => {
  await requireAdmin(request, getFirestore());
  const {title, body, segment} = request.data;
  const db = getFirestore();

  let userDocs = [];
  if (segment === "all") {
    userDocs = (await db.collection("users").get()).docs;
  } else if (segment === "with_machines") {
    const machines = await db.collection("userMachines").get();
    const uids = [...new Set(machines.docs.map((d) => d.data().userId))];
    for (const uid of uids) {
      const u = await db.collection("users").doc(uid).get();
      if (u.exists) userDocs.push(u);
    }
  }

  const tokens = userDocs.map((d) => d.data().fcmToken).filter((t) => !!t);
  if (tokens.length > 0) {
    await getMessaging().sendEachForMulticast({
      tokens,
      notification: {title, body},
    });
  }

  const batch = db.batch();
  userDocs.forEach((d) => {
    batch.set(db.collection("notifications").doc(), {
      userId: d.id,
      title,
      body,
      type: "promo",
      read: false,
      sentAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  await db.collection("auditLog").add({
    actorId: request.auth.uid,
    actorType: "admin",
    action: "broadcast_sent",
    newValue: {segment, sent: tokens.length},
    createdAt: FieldValue.serverTimestamp(),
  });
  return {success: true, sent: tokens.length};
});

export const updateSpinPrize = onCall(async (request) => {
  await requireAdmin(request, getFirestore());
  const {prizeId, updates} = request.data;
  const db = getFirestore();
  await db.collection("spinPrizes").doc(prizeId).update(updates);
  return {success: true};
});

export const seedInitialData = onCall(async (request) => {
  await requireAdmin(request, getFirestore());
  const db = getFirestore();

  const tiers = await db.collection("machineTiers").get();
  if (tiers.empty) {
    const batch = db.batch();
    const t1 = db.collection("machineTiers").doc();
    batch.set(t1, {
      name: "Bronze Rig",
      icon: "🔩",
      priceKes: 1000,
      weeklyReturnPct: 5,
      weeklyAmountKes: 50,
      sortOrder: 1,
      isActive: true,
    });
    const t2 = db.collection("machineTiers").doc();
    batch.set(t2, {
      name: "Silver Rig",
      icon: "⚙️",
      priceKes: 5000,
      weeklyReturnPct: 6,
      weeklyAmountKes: 300,
      sortOrder: 2,
      isActive: true,
    });
    const t3 = db.collection("machineTiers").doc();
    batch.set(t3, {
      name: "Gold Rig",
      icon: "🏆",
      priceKes: 20000,
      weeklyReturnPct: 7,
      weeklyAmountKes: 1400,
      sortOrder: 3,
      isActive: true,
    });
    const t4 = db.collection("machineTiers").doc();
    batch.set(t4, {
      name: "Diamond Rig",
      icon: "💎",
      priceKes: 50000,
      weeklyReturnPct: 8,
      weeklyAmountKes: 4000,
      sortOrder: 4,
      isActive: true,
    });
    await batch.commit();
  }

  const prizes = await db.collection("spinPrizes").get();
  if (prizes.empty) {
    const batch = db.batch();
    const pData = [
      {
        label: "KES 1,000",
        prizeType: "cash",
        cashAmount: 1000,
        probabilityWeight: 1,
        isActive: true,
      },
      {
        label: "KES 500",
        prizeType: "cash",
        cashAmount: 500,
        probabilityWeight: 5,
        isActive: true,
      },
      {
        label: "KES 100",
        prizeType: "cash",
        cashAmount: 100,
        probabilityWeight: 10,
        isActive: true,
      },
      {
        label: "KES 50",
        prizeType: "cash",
        cashAmount: 50,
        probabilityWeight: 20,
        isActive: true,
      },
      {
        label: "2 Tickets",
        prizeType: "tickets",
        cashAmount: null,
        probabilityWeight: 20,
        isActive: true,
      },
      {
        label: "Try Again",
        prizeType: "empty",
        cashAmount: null,
        probabilityWeight: 44,
        isActive: true,
      },
    ];
    pData.forEach((p) => batch.set(db.collection("spinPrizes").doc(), p));
    await batch.commit();
  }

  const badges = await db.collection("badges").get();
  if (badges.empty) {
    const batch = db.batch();
    const bData = [
      {
        key: "first_machine",
        name: "First Machine",
        emoji: "🏁",
        description: "Bought your first mining rig",
        color: "#cd7f32",
      },
      {
        key: "first_payout",
        name: "First Payout",
        emoji: "💰",
        description: "Received your first weekly payout",
        color: "#f0a500",
      },
      {
        key: "social_starter",
        name: "Social Starter",
        emoji: "👥",
        description: "Your first referral joined BitFarm",
        color: "#6ac8ff",
      },
      {
        key: "squad_goals",
        name: "Squad Goals",
        emoji: "🤝",
        description: "5 friends joined using your code",
        color: "#4caf50",
      },
      {
        key: "lucky_spinner",
        name: "Lucky Spinner",
        emoji: "🎰",
        description: "Won your first spin wheel prize",
        color: "#ff6b35",
      },
      {
        key: "ten_k_earner",
        name: "KES 10,000 Earned",
        emoji: "🌟",
        description: "Total earnings crossed KES 10,000",
        color: "#FFD700",
      },
      {
        key: "diamond_miner",
        name: "Diamond Miner",
        emoji: "💎",
        description: "Owns the Diamond Rig",
        color: "#b9f2ff",
      },
      {
        key: "loyal_miner",
        name: "Loyal Miner",
        emoji: "🔥",
        description: "30-day consecutive login streak",
        color: "#ff4444",
      },
      {
        key: "whale",
        name: "Whale",
        emoji: "🐋",
        description: "Total deposits above KES 50,000",
        color: "#534AB7",
      },
    ];
    bData.forEach((b) => batch.set(db.collection("badges").doc(b.key), b));
    await batch.commit();
  }

  return {success: true};
});
