import admin from "firebase-admin";
import bcrypt from "bcryptjs";

admin.initializeApp();

async function createAdmin() {
  const username = process.env.INITIAL_ADMIN_USERNAME;
  const password = process.env.INITIAL_ADMIN_PASSWORD;

  if (!username || !password) {
    console.error("Error: INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD environment variables must be set.");
    process.exit(1);
  }

  const db = admin.firestore();
  const passwordHash = await bcrypt.hash(password, 10);
  await db.collection("admins").doc("default_admin").set({
    username: username,
    passwordHash: passwordHash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(
    `Admin created successfully: username: ${username}`,
  );
}

createAdmin().catch(console.error);
