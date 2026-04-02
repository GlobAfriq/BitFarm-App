const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { checkAndAwardBadge } = require('./services/badges');
const { sendFCMToUser } = require('./services/fcm');

exports.recordDailyLogin = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in');
  const uid = request.auth.uid;
  const db = getFirestore();

  const now = new Date();
  now.setHours(now.getHours() + 3); // EAT timezone
  const today = now.toISOString().split('T')[0];
  
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().split('T')[0];

  const streakRef = db.collection('streaks').doc(uid);
  const streakSnap = await streakRef.get();
  
  if (!streakSnap.exists) return { currentStreak: 0, longestStreak: 0, milestoneReached: null };
  const streak = streakSnap.data();

  if (streak.lastLoginDate === today) {
    return { currentStreak: streak.currentStreak, longestStreak: streak.longestStreak, milestoneReached: null };
  }

  let newStreak = 1;
  if (streak.lastLoginDate === yesterday) {
    newStreak = streak.currentStreak + 1;
  }

  const newLongest = Math.max(streak.longestStreak, newStreak);
  await streakRef.update({
    currentStreak: newStreak,
    longestStreak: newLongest,
    lastLoginDate: today
  });

  let milestoneReached = null;
  if (newStreak === 3) {
    await db.collection('spinTickets').add({ userId: uid, source: 'streak_bonus', used: false, createdAt: FieldValue.serverTimestamp() });
    milestoneReached = 3;
    await sendFCMToUser(uid, '🔥 3 Day Streak!', 'You earned a bonus spin ticket!', 'streak');
  } else if (newStreak === 7) {
    await db.collection('spinTickets').add({ userId: uid, source: 'streak_bonus', used: false, createdAt: FieldValue.serverTimestamp() });
    await db.collection('users').doc(uid).update({ streakBonus: true });
    milestoneReached = 7;
    await sendFCMToUser(uid, '🔥 7 Day Streak!', 'You earned a bonus spin ticket and a payout boost!', 'streak');
  } else if (newStreak === 30) {
    await db.collection('spinTickets').add({ userId: uid, source: 'streak_bonus', used: false, createdAt: FieldValue.serverTimestamp() });
    await db.collection('spinTickets').add({ userId: uid, source: 'streak_bonus', used: false, createdAt: FieldValue.serverTimestamp() });
    await checkAndAwardBadge(uid, 'loyal_miner');
    milestoneReached = 30;
    await sendFCMToUser(uid, '🔥 30 Day Streak!', 'Incredible! You earned 2 bonus spin tickets and the Loyal Miner badge!', 'streak');
  }

  return { currentStreak: newStreak, longestStreak: newLongest, milestoneReached };
});