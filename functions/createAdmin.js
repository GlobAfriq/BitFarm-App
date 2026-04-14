const admin = require('firebase-admin');
const bcrypt = require('bcrypt');

admin.initializeApp();

async function createAdmin() {
  const db = admin.firestore();
  const passwordHash = await bcrypt.hash('admin123', 10);
  await db.collection('admins').doc('default_admin').set({
    username: 'admin',
    passwordHash: passwordHash,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log('Admin created successfully: username: admin, password: admin123');
}

createAdmin().catch(console.error);
