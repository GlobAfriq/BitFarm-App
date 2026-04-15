import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {checkAndAwardBadge} from "./services/badges.js";
import {sendFCMToUser} from "./services/fcm.js";
import {requireAuth, validateInt, rateLimit} from "./utils/security.js";
import {getDb} from "./utils/db.js";

export const buyMachine = onCall(async (request) => {
  const uid = requireAuth(request);
  const {tierId} = request.data;
  const db = getDb();

  if (!tierId || typeof tierId !== "string")
    throw new HttpsError("invalid-argument", "Invalid tierId");

  await rateLimit(db, uid, "buyMachine", 3000);

  try {
    const result = await db.runTransaction(async (t) => {
      const userRef = db.collection("users").doc(uid);
      const walletRef = db.collection("wallets").doc(uid);
      const tierRef = db.collection("machineTiers").doc(tierId);

      const [userSnap, walletSnap, tierSnap] = await Promise.all([
        t.get(userRef),
        t.get(walletRef),
        t.get(tierRef),
      ]);

      if (!userSnap.exists || !walletSnap.exists || !tierSnap.exists) {
        throw new HttpsError("not-found", "Data not found");
      }

      const user = userSnap.data();
      const wallet = walletSnap.data();
      const tier = tierSnap.data();

      if (!user.isActive)
        throw new HttpsError("failed-precondition", "Account suspended");

      const price = Math.round(tier.priceKes);
      if (wallet.balanceKes < price)
        throw new HttpsError("failed-precondition", "Insufficient balance");

      // Deduct price
      t.update(walletRef, {
        balanceKes: FieldValue.increment(-price),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Create machine
      const machineRef = db.collection("userMachines").doc();
      const now = new Date();
      const nextPayout = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      t.set(machineRef, {
        userId: uid,
        tierId,
        tierName: tier.name,
        tierIcon: tier.icon,
        weeklyAmountKes: Math.round(tier.weeklyAmountKes),
        purchasedAt: FieldValue.serverTimestamp(),
        lastPayoutAt: null,
        nextPayoutAt: nextPayout,
        totalPaidOut: 0,
        ownershipPct: 100,
        isActive: true,
      });

      // Create transaction
      const txRef = db.collection("transactions").doc();
      t.set(txRef, {
        userId: uid,
        type: "machine_purchase",
        amountKes: price,
        direction: "debit",
        description: `Purchased ${tier.name}`,
        idempotencyKey: "buy_" + machineRef.id,
        status: "completed",
        createdAt: FieldValue.serverTimestamp(),
      });

      // Create spin tickets based on rig value
      let numTickets = 1;
      if (tier.name === "Silver Rig") numTickets = 2;
      else if (tier.name === "Gold Rig") numTickets = 3;
      else if (tier.name === "Diamond Rig") numTickets = 4;

      for (let i = 0; i < numTickets; i++) {
        const ticketRef = db.collection("spinTickets").doc();
        t.set(ticketRef, {
          userId: uid,
          source: "machine_purchase",
          used: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      // Check for pending referrals
      const pendingRefs = await t.get(
        db
          .collection("referrals")
          .where("referredId", "==", uid)
          .where("status", "==", "pending")
          .limit(1),
      );
      if (!pendingRefs.empty) {
        const refDoc = pendingRefs.docs[0];
        const commission = Math.round(price * 0.08);
        const referrerId = refDoc.data().referrerId;

        const refWallet = db.collection("wallets").doc(referrerId);
        t.update(refWallet, {
          balanceKes: FieldValue.increment(commission),
          totalEarned: FieldValue.increment(commission),
          updatedAt: FieldValue.serverTimestamp(),
        });

        t.update(refDoc.ref, {
          machineId: machineRef.id,
          purchaseAmount: price,
          commissionAmt: commission,
          status: "paid",
          paidAt: FieldValue.serverTimestamp(),
        });

        const refTxRef = db.collection("transactions").doc();
        t.set(refTxRef, {
          userId: referrerId,
          type: "referral_commission",
          amountKes: commission,
          direction: "credit",
          description: "Referral commission",
          idempotencyKey: "ref_" + refDoc.id,
          status: "completed",
          createdAt: FieldValue.serverTimestamp(),
        });

        return {
          machineId: machineRef.id,
          nextPayoutAt: nextPayout,
          tierPrice: price,
          tierName: tier.name,
          referrerId,
          commission,
        };
      }

      return {
        machineId: machineRef.id,
        nextPayoutAt: nextPayout,
        tierPrice: price,
        tierName: tier.name,
      };
    });

    if (result.referrerId) {
      await sendFCMToUser(
        result.referrerId,
        "💰 Commission Earned!",
        `Your referral bought a machine! You earned KES ${result.commission}`,
        "referral",
      );
      await checkAndAwardBadge(result.referrerId, "social_starter");

      try {
        const lbRef = db.collection("leaderboard").doc(result.referrerId);

        const userSnap = await db
          .collection("users")
          .doc(result.referrerId)
          .get();
        const displayName = userSnap.exists
          ? userSnap.data().fullName
          : "Unknown";

        const refsSnap = await db
          .collection("referrals")
          .where("referrerId", "==", result.referrerId)
          .where("status", "==", "paid")
          .get();

        let totalRefEarnings = 0;
        refsSnap.forEach((doc) => {
          totalRefEarnings += doc.data().commissionAmt || 0;
        });

        await lbRef.set({
          displayName,
          referralEarnings: totalRefEarnings,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.error("Failed to update Firestore leaderboard", e);
      }
    }

    await checkAndAwardBadge(uid, "first_machine");
    if (result.tierName === "Diamond Rig") {
      await checkAndAwardBadge(uid, "diamond_miner");
    }
    await sendFCMToUser(
      uid,
      "⛏️ Machine Active!",
      `${result.tierName} is mining for you! First payout in 7 days.`,
      "general",
    );

    await db.collection("auditLog").add({
      actorId: uid,
      actorType: "user",
      action: "machine_purchased",
      targetCollection: "userMachines",
      targetId: result.machineId,
      newValue: {tierName: result.tierName, price: result.tierPrice},
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      machineId: result.machineId,
      nextPayoutAt: result.nextPayoutAt,
    };
  } catch (error) {
    console.error("Buy machine error:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message || "Failed to buy machine");
  }
});

export const sellFraction = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = getDb();
  const {machineId} = request.data;
  const pctForSale = validateInt(request.data.pctForSale, 10, "pctForSale");

  if (pctForSale > 90)
    throw new HttpsError(
      "invalid-argument",
      "Percentage must be between 10 and 90",
    );

  await rateLimit(db, uid, "sellFraction", 5000);

  try {
    const fractionId = await db.runTransaction(async (t) => {
      const machineRef = db.collection("userMachines").doc(machineId);
      const machineSnap = await t.get(machineRef);

      if (!machineSnap.exists || machineSnap.data().userId !== uid) {
        throw new HttpsError(
          "permission-denied",
          "Machine not found or not owned",
        );
      }

      const machine = machineSnap.data();
      if (machine.ownershipPct < pctForSale) {
        throw new HttpsError(
          "failed-precondition",
          "Not enough ownership percentage to sell",
        );
      }

      const tierRef = db.collection("machineTiers").doc(machine.tierId);
      const tierSnap = await t.get(tierRef);
      const askingPrice = Math.round(
        (pctForSale / 100) * tierSnap.data().priceKes,
      );

      // We don't deduct ownership yet, we just lock it by creating a listing.
      // To prevent overselling, we should check existing listings.
      const existingListings = await t.get(
        db
          .collection("machineFractions")
          .where("machineId", "==", machineId)
          .where("status", "==", "listed"),
      );

      let lockedPct = 0;
      existingListings.forEach((doc) => (lockedPct += doc.data().pctForSale));

      if (machine.ownershipPct - lockedPct < pctForSale) {
        throw new HttpsError(
          "failed-precondition",
          "You have already listed too much of this machine",
        );
      }

      const fracRef = db.collection("machineFractions").doc();
      t.set(fracRef, {
        machineId,
        sellerId: uid,
        buyerId: null,
        pctForSale,
        askingPrice,
        status: "listed",
        listedAt: FieldValue.serverTimestamp(),
        soldAt: null,
      });

      return fracRef.id;
    });

    return {success: true, fractionId};
  } catch (error) {
    console.error("Sell fraction error:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to list fraction");
  }
});

export const buyFraction = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = getDb();
  const {fractionId} = request.data;

  if (!fractionId || typeof fractionId !== "string")
    throw new HttpsError("invalid-argument", "Invalid fractionId");

  await rateLimit(db, uid, "buyFraction", 5000);

  try {
    await db.runTransaction(async (t) => {
      const fracRef = db.collection("machineFractions").doc(fractionId);
      const fracSnap = await t.get(fracRef);

      if (!fracSnap.exists || fracSnap.data().status !== "listed") {
        throw new HttpsError("failed-precondition", "Fraction not available");
      }

      const frac = fracSnap.data();
      if (frac.sellerId === uid) {
        throw new HttpsError(
          "failed-precondition",
          "Cannot buy your own fraction",
        );
      }

      const buyerWalletRef = db.collection("wallets").doc(uid);
      const sellerWalletRef = db.collection("wallets").doc(frac.sellerId);
      const machineRef = db.collection("userMachines").doc(frac.machineId);

      const [buyerSnap, machineSnap] = await Promise.all([
        t.get(buyerWalletRef),
        t.get(machineRef),
      ]);

      if (!machineSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          "Original machine no longer exists",
        );
      }

      const askingPrice = Math.round(frac.askingPrice);

      if (buyerSnap.data().balanceKes < askingPrice) {
        throw new HttpsError("failed-precondition", "Insufficient balance");
      }

      const machine = machineSnap.data();

      // Calculate new weekly amounts
      const originalWeekly = machine.weeklyAmountKes;
      const fractionWeekly = Math.round(
        originalWeekly * (frac.pctForSale / machine.ownershipPct),
      );
      const newSellerWeekly = originalWeekly - fractionWeekly;

      // Deduct from buyer, add to seller
      t.update(buyerWalletRef, {
        balanceKes: FieldValue.increment(-askingPrice),
        updatedAt: FieldValue.serverTimestamp(),
      });
      t.update(sellerWalletRef, {
        balanceKes: FieldValue.increment(askingPrice),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Update fraction status
      t.update(fracRef, {
        status: "sold",
        buyerId: uid,
        soldAt: FieldValue.serverTimestamp(),
      });

      // Update seller's machine
      t.update(machineRef, {
        ownershipPct: FieldValue.increment(-frac.pctForSale),
        weeklyAmountKes: newSellerWeekly,
      });

      // Create new machine record for buyer
      const newMachineRef = db.collection("userMachines").doc();
      t.set(newMachineRef, {
        userId: uid,
        tierId: machine.tierId,
        tierName: machine.tierName + ` (${frac.pctForSale}%)`,
        tierIcon: machine.tierIcon,
        weeklyAmountKes: fractionWeekly,
        purchasedAt: FieldValue.serverTimestamp(),
        lastPayoutAt: machine.lastPayoutAt,
        nextPayoutAt: machine.nextPayoutAt,
        totalPaidOut: 0,
        ownershipPct: frac.pctForSale,
        isActive: true,
        parentMachineId: frac.machineId,
      });

      // Create transactions
      const buyerTx = db.collection("transactions").doc();
      t.set(buyerTx, {
        userId: uid,
        type: "fraction_purchase",
        amountKes: askingPrice,
        direction: "debit",
        description: `Bought ${frac.pctForSale}% machine stake`,
        idempotencyKey: `frac_buy_${fractionId}`,
        status: "completed",
        createdAt: FieldValue.serverTimestamp(),
      });

      const sellerTx = db.collection("transactions").doc();
      t.set(sellerTx, {
        userId: frac.sellerId,
        type: "fraction_sale",
        amountKes: askingPrice,
        direction: "credit",
        description: `Sold ${frac.pctForSale}% machine stake`,
        idempotencyKey: `frac_sell_${fractionId}`,
        status: "completed",
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return {success: true};
  } catch (error) {
    console.error("Buy fraction error:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to buy fraction");
  }
});
