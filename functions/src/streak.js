const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { checkAndAwardBadge } = require('./services/badges');
const { sendFCMToUser } = require('./services/fcm');
const { requireAuth, rateLimit } = require('./utils/security');

exports.recordDailyLogin = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = getFirestore('ai-studio-7c48d254-792c-4a9f-aed6-50d6c4dc3791');

  await rateLimit(db, uid, 'recordDailyLogin', 60000); // 1 minute cooldown

  const now = new Date();
  now.setHours(now.getHours() + 3); // EAT timezone
  const today = now.toISOString().split('T')[0];
  
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().split('T')[0];

  try {
    const result = await db.runTransaction(async (t) => {
      const streakRef = db.collection('streaks').doc(uid);
      const streakSnap = await t.get(streakRef);
      
      if (!streakSnap.exists) {
        t.set(streakRef, {
          currentStreak: 1,
          longestStreak: 1,
          lastLoginDate: today
        });
        return { currentStreak: 1, longestStreak: 1, milestoneReached: null };
      }
      
      const streak = streakSnap.data();

      if (streak.lastLoginDate === today) {
        return { currentStreak: streak.currentStreak, longestStreak: streak.longestStreak, milestoneReached: null };
      }

      let newStreak = 1;
      if (streak.lastLoginDate === yesterday) {
        newStreak = streak.currentStreak + 1;
      }

      const newLongest = Math.max(streak.longestStreak, newStreak);
      t.update(streakRef, {
        currentStreak: newStreak,
        longestStreak: newLongest,
        lastLoginDate: today
      });

      let milestoneReached = null;
      if (newStreak === 3) {
        t.set(db.collection('spinTickets').doc(), { userId: uid, source: 'streak_bonus', used: false, createdAt: FieldValue.serverTimestamp() });
        milestoneReached = 3;
      } else if (newStreak === 7) {
        t.set(db.collection('spinTickets').doc(), { userId: uid, source: 'streak_bonus', used: false, createdAt: FieldValue.serverTimestamp() });
        t.update(db.collection('users').doc(uid), { streakBonus: true });
        milestoneReached = 7;
      } else if (newStreak === 30) {
        t.set(db.collection('spinTickets').doc(), { userId: uid, source: 'streak_bonus', used: false, createdAt: FieldValue.serverTimestamp() });
        t.set(db.collection('spinTickets').doc(), { userId: uid, source: 'streak_bonus', used: false, createdAt: FieldValue.serverTimestamp() });
        milestoneReached = 30;
      }

      return { currentStreak: newStreak, longestStreak: newLongest, milestoneReached };
    });

    if (result.milestoneReached === 3) {
      await sendFCMToUser(uid, '🔥 3 Day Streak!', 'You earned a bonus spin ticket!', 'streak');
    } else if (result.milestoneReached === 7) {
      await sendFCMToUser(uid, '🔥 7 Day Streak!', 'You earned a bonus spin ticket and a payout boost!', 'streak');
    } else if (result.milestoneReached === 30) {
      await checkAndAwardBadge(uid, 'loyal_miner');
      await sendFCMToUser(uid, '🔥 30 Day Streak!', 'Incredible! You earned 2 bonus spin tickets and the Loyal Miner badge!', 'streak');
    }

    return result;
  } catch (error) {
    console.error('Streak error:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to record streak');
  }
});
