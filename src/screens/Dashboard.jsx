import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Bell, ArrowDownLeft, ArrowUpRight, Plus, ArrowUpCircle, Cpu, Zap } from 'lucide-react';
import { collection, query, where, orderBy, limit, onSnapshot, doc, getDoc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../store/AuthContext';
import useCountUp from '../hooks/useCountUp';
import BottomNav from '../components/BottomNav';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrorHandler';

export default function Dashboard() {
  const { user, profile, wallet } = useAuth();
  const navigate = useNavigate();
  const [machines, setMachines] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [streak, setStreak] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const hasFiredStreak = useRef(false);

  const totalEarnedAnim = useCountUp(wallet?.totalEarned || 0);
  const withdrawnAnim = useCountUp(wallet?.totalWithdrawn || 0);

  useEffect(() => {
    if (!user) return;
    
    const mUnsub = onSnapshot(query(collection(db, 'userMachines'), where('userId', '==', user.uid)), (snap) => {
      setMachines(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'userMachines'));

    const nUnsub = onSnapshot(query(collection(db, 'notifications'), where('userId', '==', user.uid), where('read', '==', false)), (snap) => {
      setUnreadCount(snap.docs.length);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'notifications'));

    const sUnsub = onSnapshot(doc(db, 'streaks', user.uid), (snap) => {
      setStreak(snap.exists() ? snap.data() : null);
    }, (error) => handleFirestoreError(error, OperationType.GET, `streaks/${user.uid}`));

    const tUnsub = onSnapshot(query(collection(db, 'transactions'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(5)), (snap) => {
      setRecentActivity(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'transactions'));

    const checkStreak = async () => {
      if (hasFiredStreak.current) return;
      hasFiredStreak.current = true;
      
      try {
        const streakRef = doc(db, 'streaks', user.uid);
        let streakSnap;
        try {
          streakSnap = await getDoc(streakRef);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `streaks/${user.uid}`);
          throw error;
        }
        if (!streakSnap.exists()) return;
        
        const streakData = streakSnap.data();
        const now = new Date();
        now.setHours(now.getHours() + 3); // EAT timezone
        const today = now.toISOString().split('T')[0];
        
        if (streakData.lastLoginDate === today) return;
        
        const yesterdayDate = new Date(now);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = yesterdayDate.toISOString().split('T')[0];
        
        let newStreak = 1;
        if (streakData.lastLoginDate === yesterday) {
          newStreak = streakData.currentStreak + 1;
        }
        
        const newLongest = Math.max(streakData.longestStreak, newStreak);
        
        try {
          await updateDoc(streakRef, {
            currentStreak: newStreak,
            longestStreak: newLongest,
            lastLoginDate: today
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `streaks/${user.uid}`);
          throw error;
        }
        
        if (newStreak === 3) {
          try {
            await addDoc(collection(db, 'spinTickets'), { userId: user.uid, source: 'streak_bonus', used: false, createdAt: serverTimestamp() });
            await addDoc(collection(db, 'notifications'), { userId: user.uid, title: '🔥 3 Day Streak!', body: 'You earned a bonus spin ticket!', type: 'streak', read: false, sentAt: serverTimestamp() });
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, 'spinTickets/notifications');
            throw error;
          }
          toast('🔥 3-day streak! Bonus spin ticket added!', { icon: '🔥' });
        } else if (newStreak === 7) {
          try {
            await addDoc(collection(db, 'spinTickets'), { userId: user.uid, source: 'streak_bonus', used: false, createdAt: serverTimestamp() });
            await updateDoc(doc(db, 'users', user.uid), { streakBonus: true, updatedAt: serverTimestamp() });
            await addDoc(collection(db, 'notifications'), { userId: user.uid, title: '🔥 7 Day Streak!', body: 'You earned a bonus spin ticket and a payout boost!', type: 'streak', read: false, sentAt: serverTimestamp() });
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, 'spinTickets/users/notifications');
            throw error;
          }
          toast('🔥 7-day streak! Bonus spin ticket added!', { icon: '🔥' });
        } else if (newStreak === 30) {
          try {
            await addDoc(collection(db, 'spinTickets'), { userId: user.uid, source: 'streak_bonus', used: false, createdAt: serverTimestamp() });
            await addDoc(collection(db, 'spinTickets'), { userId: user.uid, source: 'streak_bonus', used: false, createdAt: serverTimestamp() });
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, 'spinTickets');
            throw error;
          }
          
          const userRef = doc(db, 'users', user.uid);
          let uSnap;
          try {
            uSnap = await getDoc(userRef);
          } catch (error) {
            handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
            throw error;
          }
          const badgeKeys = uSnap.data()?.badgeKeys || [];
          if (!badgeKeys.includes('loyal_miner')) {
            try {
              await updateDoc(userRef, { badgeKeys: [...badgeKeys, 'loyal_miner'], updatedAt: serverTimestamp() });
            } catch (error) {
              handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
              throw error;
            }
          }
          try {
            await addDoc(collection(db, 'notifications'), { userId: user.uid, title: '🔥 30 Day Streak!', body: 'Incredible! You earned 2 bonus spin tickets and the Loyal Miner badge!', type: 'streak', read: false, sentAt: serverTimestamp() });
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, 'notifications');
            throw error;
          }
          toast('🔥 30-day streak! Bonus spin ticket added!', { icon: '🔥' });
        }
      } catch (error) {
        console.error('Error updating streak:', error);
      }
    };

    checkStreak();

    return () => { mUnsub(); nUnsub(); sUnsub(); tUnsub(); };
  }, [user]);

  const getInitials = (name) => name ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '??';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pb-24 min-h-screen px-4 pt-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <p className="text-white/60 text-sm">Good day,</p>
          <h1 className="text-xl font-bold">{profile?.fullName?.split(' ')[0]} 👋</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative cursor-pointer" onClick={() => navigate('/notifications')}>
            <Bell size={24} className="text-white/80" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </div>
          <div onClick={() => navigate('/profile')} className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#f0a500] to-[#ff6b35] flex items-center justify-center font-bold shadow-lg cursor-pointer">
            {getInitials(profile?.fullName)}
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="card p-3 flex flex-col items-center justify-center text-center">
          <span className="text-white/50 text-xs mb-1">Total Earned</span>
          <span className="font-bold text-[#4caf50]">KES {totalEarnedAnim.toLocaleString()}</span>
        </div>
        <div className="card p-3 flex flex-col items-center justify-center text-center">
          <span className="text-white/50 text-xs mb-1">Expected Payout</span>
          <span className="font-bold text-[#f0a500]">KES {machines.reduce((sum, m) => sum + m.weeklyAmountKes, 0).toLocaleString()}</span>
        </div>
        <div className="card p-3 flex flex-col items-center justify-center text-center">
          <span className="text-white/50 text-xs mb-1">Streak 🔥</span>
          <span className={`font-bold ${streak?.currentStreak >= 7 ? 'streak-glow text-[#f0a500]' : ''}`}>
            {streak?.currentStreak || 0} Days
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-4 gap-3 mb-8">
        <button onClick={() => navigate('/wallet')} className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-[#f0a500] active:scale-95 transition-transform">
            <Plus size={24} />
          </div>
          <span className="text-xs text-white/70">Deposit</span>
        </button>
        <button onClick={() => navigate('/wallet')} className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-white active:scale-95 transition-transform">
            <ArrowUpCircle size={24} />
          </div>
          <span className="text-xs text-white/70">Withdraw</span>
        </button>
        <button onClick={() => navigate('/machines')} className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-white active:scale-95 transition-transform">
            <Cpu size={24} />
          </div>
          <span className="text-xs text-white/70">Machines</span>
        </button>
        <button onClick={() => navigate('/spin')} className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-[#ff6b35] active:scale-95 transition-transform">
            <Zap size={24} />
          </div>
          <span className="text-xs text-white/70">Spin</span>
        </button>
      </div>

      {/* Streak Banner */}
      {streak?.currentStreak > 0 && (
        <div className={`rounded-xl p-4 mb-8 bg-gradient-to-r from-[#f0a500]/20 to-[#ff6b35]/20 border border-[#f0a500]/30 flex items-center justify-between`}>
          <div>
            <h3 className={`font-bold text-lg ${streak.currentStreak >= 7 ? 'streak-glow' : ''}`}>🔥 {streak.currentStreak} Day Streak</h3>
            <p className="text-xs text-white/70">Keep mining daily for bonuses!</p>
          </div>
          <Zap className="text-[#f0a500]" size={24} />
        </div>
      )}

      {/* My Machines */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-lg">My Machines</h2>
          <button onClick={() => navigate('/machines')} className="text-xs text-[#f0a500]">View All</button>
        </div>
        
        {machines.length === 0 ? (
          <div onClick={() => navigate('/machines')} className="border border-dashed border-white/20 rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer active:bg-white/5 transition-colors">
            <Cpu size={32} className="text-white/40 mb-2" />
            <p className="font-medium">No machines yet</p>
            <p className="text-xs text-[#f0a500] mt-1">Buy your first rig →</p>
          </div>
        ) : (
          <div className="space-y-3">
            {machines.slice(0, 2).map(m => {
              const now = new Date().getTime();
              const last = m.purchasedAt?.toMillis() || now;
              const next = m.nextPayoutAt?.toMillis() || now + 7 * 24 * 60 * 60 * 1000;
              const progress = Math.min(100, Math.max(0, ((now - last) / (next - last)) * 100));
              
              return (
                <motion.div whileHover={{ scale: 1.02 }} key={m.id} className="card flex items-center gap-4 p-4">
                  <div className="text-4xl">{m.tierIcon}</div>
                  <div className="flex-1">
                    <h3 className="font-bold text-sm">{m.tierName}</h3>
                    <div className="w-full bg-white/10 h-1.5 rounded-full mt-2 mb-1 overflow-hidden">
                      <div className="bg-[#f0a500] h-full rounded-full" style={{ width: `${progress}%` }}></div>
                    </div>
                    <p className="text-[10px] text-white/50">Next payout: KES {m.weeklyAmountKes}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="font-bold text-lg mb-4">Recent Activity</h2>
        <div className="card space-y-4">
          {recentActivity.length === 0 ? (
            <p className="text-center text-sm text-white/50 py-4">No activity yet</p>
          ) : (
            recentActivity.map(tx => (
              <div key={tx.id} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tx.direction === 'credit' ? 'bg-[#4caf50]/20 text-[#4caf50]' : 'bg-[#f44336]/20 text-[#f44336]'}`}>
                    {tx.direction === 'credit' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{tx.description}</p>
                    <p className="text-[10px] text-white/50">{tx.createdAt ? formatDistanceToNow(tx.createdAt.toDate(), { addSuffix: true }) : 'Just now'}</p>
                  </div>
                </div>
                <span className={`font-bold text-sm ${tx.direction === 'credit' ? 'text-[#4caf50]' : ''}`}>
                  {tx.direction === 'credit' ? '+' : '-'}KES {tx.amountKes.toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <BottomNav />
    </motion.div>
  );
}