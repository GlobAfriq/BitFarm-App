import { getFirestore } from "firebase-admin/firestore";

export const getDb = () => {
  if (!process.env.FIRESTORE_DATABASE_ID) {
    throw new Error("FIRESTORE_DATABASE_ID environment variable is missing.");
  }
  return getFirestore(process.env.FIRESTORE_DATABASE_ID);
};