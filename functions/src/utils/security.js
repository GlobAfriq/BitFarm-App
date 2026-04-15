import {HttpsError} from "firebase-functions/v2/https";

/**
 * Ensures the request is authenticated and returns the user ID.
 */
const requireAuth = (request) => {
  if (!request.auth)
    throw new HttpsError("unauthenticated", "Must be logged in");
  return request.auth.uid;
};

/**
 * Validates that a value is an integer and meets the minimum requirement.
 */
const validateInt = (val, min = 0, fieldName = "Value") => {
  const num = Number(val);
  if (!Number.isInteger(num) || num < min) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must be an integer >= ${min}`,
    );
  }
  return num;
};

/**
 * Basic rate limiting using Firestore.
 */
const rateLimit = async (db, uid, action, limitMs) => {
  const ref = db.collection("rate_limits").doc(`${uid}_${action}`);
  await db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    const now = Date.now();
    if (doc.exists && now - doc.data().lastAttempt < limitMs) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many requests. Please slow down.",
      );
    }
    t.set(ref, {lastAttempt: now});
  });
};

export {requireAuth, validateInt, rateLimit};
