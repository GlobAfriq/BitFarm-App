const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

admin.initializeApp({
  projectId: "gen-lang-client-0907348027"
});

async function test() {
  try {
    const db = getFirestore(admin.app());
    const snap = await db.collection('admins').limit(1).get();
    console.log('Success, found docs:', snap.size);
  } catch (e) {
    console.error('Error:', e);
  }
}

test();
