import {
  signInWithPhoneNumber,
  RecaptchaVerifier,
  signOut,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  getDocs,
  addDoc,
  serverTimestamp,
  writeBatch,
  collection,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import toast from "react-hot-toast";

export const setupRecaptcha = (containerId) => {
  if (!window.recaptchaVerifier) {
    auth.useDeviceLanguage();
    window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
      size: "invisible",
      callback: () => {},
    });
  }
};

export const clearRecaptcha = () => {
  if (window.recaptchaVerifier) {
    try {
      window.recaptchaVerifier.clear();
    } catch (e) {
      console.warn("Error clearing recaptcha", e);
    }
    window.recaptchaVerifier = null;
  }
};

export const sendOTP = async (phoneNumber) => {
  try {
    const appVerifier = window.recaptchaVerifier;
    const confirmationResult = await signInWithPhoneNumber(
      auth,
      phoneNumber,
      appVerifier,
    );
    toast.success("Code sent ✓");
    return confirmationResult;
  } catch (error) {
    console.error("Error sending OTP:", error);
    if (
      error.code === "auth/firebase-app-check-token-is-invalid" ||
      error.message.includes("app-check-token-is-invalid")
    ) {
      toast.error(
        "App Check is enforced in Firebase Console. Please disable App Check enforcement for Firebase Authentication, or authorize this domain.",
      );
    } else {
      toast.error("Failed to send code. Check your number and try again.");
    }
    throw error;
  }
};

export const verifyOTP = async (confirmationResult, otpCode) => {
  try {
    const result = await confirmationResult.confirm(otpCode);
    const user = result.user;
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    return { user, isNewUser: !userSnap.exists() };
  } catch (error) {
    console.error("Error verifying OTP:", error);
    toast.error("Invalid code. Please try again.");
    throw error;
  }
};

export const createUserProfile = async (
  uid,
  phoneNumber,
  fullName,
  referralCode,
  country = "Kenya",
) => {
  try {
    const batch = writeBatch(db);

    // Generate a unique referral code from the user's name + random digits
    const generatedCode =
      fullName
        .substring(0, 3)
        .toUpperCase()
        .replace(/[^A-Z]/g, "X") + Math.floor(100 + Math.random() * 900);

    // Look up referrer by referral code
    let referrerUid = null;
    if (referralCode && referralCode.trim() !== "") {
      const refDoc = await getDoc(
        doc(db, "referralCodes", referralCode.toUpperCase().trim()),
      );
      if (refDoc.exists()) {
        referrerUid = refDoc.data().uid;
      }
    }

    // Create user document
    const userRef = doc(db, "users", uid);
    batch.set(userRef, {
      uid,
      phoneNumber,
      fullName,
      country,
      referralCode: generatedCode,
      referredBy: referrerUid,
      fcmToken: null,
      kycVerified: false,
      isActive: true,
      badgeKeys: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Create referral code document
    const refCodeDoc = doc(db, "referralCodes", generatedCode);
    batch.set(refCodeDoc, {
      uid: uid,
      createdAt: serverTimestamp(),
    });

    // Create wallet document
    const walletRef = doc(db, "wallets", uid);
    batch.set(walletRef, {
      uid,
      balanceKes: 0,
      balanceUsdt: 0,
      lockedBalance: 0,
      totalEarned: 0,
      totalWithdrawn: 0,
      totalDeposited: 0,
      updatedAt: serverTimestamp(),
    });

    // Create streak document
    const streakRef = doc(db, "streaks", uid);
    batch.set(streakRef, {
      userId: uid,
      currentStreak: 0,
      longestStreak: 0,
      lastLoginDate: null,
    });

    await batch.commit();

    // If referred: create a referral record
    if (referrerUid) {
      await addDoc(collection(db, "referrals"), {
        referrerId: referrerUid,
        referredId: uid,
        referredName: fullName,
        machineId: null,
        purchaseAmount: null,
        commissionPct: 8,
        commissionAmt: null,
        status: "pending",
        createdAt: serverTimestamp(),
        paidAt: null,
      });
    }

    return { uid, fullName, referralCode: generatedCode };
  } catch (error) {
    console.error("Error creating profile:", error);
    throw error;
  }
};

export const logout = async (uid) => {
  try {
    // Clear FCM token before signing out so old device stops receiving notifications
    if (uid) {
      const userRef = doc(db, "users", uid);
      await setDoc(
        userRef,
        { fcmToken: null, updatedAt: serverTimestamp() },
        { merge: true },
      );
    }
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out:", error);
  }
};
