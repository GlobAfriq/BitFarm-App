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
 * Basic rate limiting using Firestore with a fixed window counter.
 * Backwards compatible with single-request cooldowns.
 */
const rateLimit = async (db, identifier, action, windowMs, maxRequests = 1) => {
  const ref = db.collection("rate_limits").doc(`${identifier}_${action}`);
  await db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    const now = Date.now();
    if (doc.exists) {
      const data = doc.data();
      const windowStart = data.windowStart || data.lastAttempt || 0;
      const count = data.count || 1;
      
      if (now - windowStart < windowMs) {
        if (count >= maxRequests) {
          throw new HttpsError(
            "resource-exhausted",
            "Too many requests. Please slow down."
          );
        }
        t.update(ref, { count: count + 1, lastAttempt: now });
      } else {
        t.update(ref, { windowStart: now, count: 1, lastAttempt: now });
      }
    } else {
      t.set(ref, { windowStart: now, count: 1, lastAttempt: now });
    }
  });
};

export {requireAuth, validateInt, rateLimit};
