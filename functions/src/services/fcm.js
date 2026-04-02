const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

async function sendFCMToUser(userId, title, body, type = 'general') {
  const db = getFirestore();
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const fcmToken = userDoc.data()?.fcmToken;

    if (fcmToken) {
      await getMessaging().send({
        token: fcmToken,
        notification: { title, body },
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } }
      });
    }

    // Always create a notification record even if FCM token is missing
    await db.collection('notifications').add({
      userId, title, body, type, read: false, sentAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('FCM send error for user', userId, error.message);
    // Do not throw — notification failure should not break the main operation
  }
}

module.exports = { sendFCMToUser };