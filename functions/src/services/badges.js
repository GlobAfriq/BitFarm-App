const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { sendFCMToUser } = require('./fcm');

async function checkAndAwardBadge(userId, badgeKey) {
  const db = getFirestore('ai-studio-7c48d254-792c-4a9f-aed6-50d6c4dc3791');
  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return;

  const badgeKeys = userSnap.data().badgeKeys || [];
  if (badgeKeys.includes(badgeKey)) return; // Already earned

  const badgeSnap = await db.collection('badges').doc(badgeKey).get();
  if (!badgeSnap.exists) return;
  const badge = badgeSnap.data();

  await userRef.update({ badgeKeys: FieldValue.arrayUnion(badgeKey) });
  await sendFCMToUser(userId, '🏆 Achievement Unlocked!', badge.name + ': ' + badge.description, 'badge');
  await db.collection('auditLog').add({
    actorId: 'system', actorType: 'system',
    action: 'badge_awarded',
    targetCollection: 'users', targetId: userId,
    newValue: { badgeKey, badgeName: badge.name },
    createdAt: FieldValue.serverTimestamp()
  });
}

module.exports = { checkAndAwardBadge };