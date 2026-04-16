import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { collection, query, where, onSnapshot, getDoc, doc, orderBy, limit } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../store/AuthContext';
import BottomNav from '../components/BottomNav';
import toast from 'react-hot-toast';
import { Users, Copy, Share2 } from 'lucide-react';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrorHandler';

export default function Referrals() {
  const { user, profile } = useAuth();
  const [tab, setTab] = useState('overview');
  const [referrals, setReferrals] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [userCache, setUserCache] = useState({});

  useEffect(() => {
    if (!user) return;

    const unsubRefs = onSnapshot(query(collection(db, 'referrals'), where('referrerId', '==', user.uid)), async (snap) => {
      const refs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setReferrals(refs);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'referrals'));

    const unsubLb = onSnapshot(
      query(collection(db, 'leaderboard'), orderBy('referralEarnings', 'desc'), limit(10)),
      (snap) => {
        const sorted = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
        setLeaderboard(sorted);
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'leaderboard')
    );

    return () => { unsubRefs(); unsubLb(); };
  }, [user]);

  const copyCode = () => {
    navigator.clipboard.writeText(profile?.referralCode || '');
    toast.success('Code copied to clipboard!');
  };

  const shareCode = () => {
    const text = `Join BitFarm and start earning!\n\nUse my code: ${profile?.referralCode}\n\nLink: https://bitfarm.uk/signup?ref=${profile?.referralCode}`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const totalCommission = referrals.reduce((sum, r) => sum + (r.commissionAmt || 0), 0);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pb-24 min-h-screen px-4 pt-6">
      <h1 className="text-2xl font-bold mb-6">Refer & Earn</h1>

      <div className="flex bg-white/5 rounded-lg p-1 mb-6">
        {['overview', 'network', 'leaderboard'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors capitalize ${tab === t ? 'bg-[#f0a500] text-white shadow-md' : 'text-white/60'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-3 text-center">
              <p className="text-white/50 text-xs mb-1">Total Referrals</p>
              <p className="font-bold text-lg">{referrals.length}</p>
            </div>
            <div className="card p-3 text-center col-span-2">
              <p className="text-white/50 text-xs mb-1">Commission Earned</p>
              <p className="font-bold text-lg text-[#4caf50]">KES {totalCommission.toLocaleString()}</p>
            </div>
          </div>

          <div className="card border border-[#f0a500]/30 p-6 text-center">
            <p className="text-sm text-white/60 mb-2">Your Referral Code</p>
            <div className="text-3xl font-mono font-bold text-[#f0a500] tracking-widest mb-6">
              {profile?.referralCode}
            </div>
            <div className="flex gap-3">
              <button onClick={copyCode} className="flex-1 btn-outline py-3 flex items-center justify-center gap-2">
                <Copy size={18} /> Copy
              </button>
              <button onClick={shareCode} className="flex-1 btn-primary py-3 flex items-center justify-center gap-2">
                <Share2 size={18} /> Share
              </button>
            </div>
          </div>

          <div>
            <h3 className="font-bold mb-4">How it works</h3>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold text-[#f0a500]">1</div>
                <div>
                  <p className="font-medium text-sm">Share your code</p>
                  <p className="text-xs text-white/50">Send your unique code to friends.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold text-[#f0a500]">2</div>
                <div>
                  <p className="font-medium text-sm">They buy a machine</p>
                  <p className="text-xs text-white/50">Your friend signs up and buys any mining rig.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold text-[#f0a500]">3</div>
                <div>
                  <p className="font-medium text-sm">You earn 8%</p>
                  <p className="text-xs text-white/50">Instantly receive 8% of their purchase price in KES.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'network' && (
        <div className="space-y-3">
          {referrals.length === 0 ? (
            <div className="text-center py-10">
              <Users size={48} className="mx-auto text-white/20 mb-4" />
              <p className="text-white/50">No referrals yet.</p>
            </div>
          ) : (
            referrals.map(r => (
              <div key={r.id} className="card flex items-center justify-between p-4">
                <div>
                  <p className="font-bold text-sm">{r.referredName || 'Unknown User'}</p>
                  <p className="text-[10px] text-white/50">Joined {new Date(r.createdAt?.toDate()).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  {r.status === 'pending' ? (
                    <span className="text-[10px] bg-white/10 text-white/60 px-2 py-1 rounded">Pending</span>
                  ) : (
                    <span className="font-bold text-sm text-[#4caf50]">KES {r.commissionAmt?.toLocaleString()}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'leaderboard' && (
        <div className="space-y-3">
          {leaderboard.length === 0 ? (
            <p className="text-center text-white/50 py-10">Leaderboard updating...</p>
          ) : (
            leaderboard.map((entry, index) => {
              const isMe = entry.uid === user?.uid;
              const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
              
              return (
                <div key={entry.uid} className={`card flex items-center p-4 ${isMe ? 'border border-[#f0a500] border-l-4' : ''}`}>
                  <div className="w-8 font-bold text-lg text-white/60">{medal}</div>
                  <div className="flex-1 ml-2">
                    <p className="font-bold text-sm">{entry.displayName} {isMe && '(You)'}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-[#f0a500]">KES {entry.referralEarnings.toLocaleString()}</p>
                  </div>
                </div>
              );
            })
          )}
          <div className="mt-6 p-4 bg-[#f0a500]/10 border border-[#f0a500]/30 rounded-lg text-center">
            <p className="text-sm text-[#f0a500]">
              <span className="font-bold">Weekly Bonus:</span> The leading referrer by every Friday at 1pm receives a bonus of KES 3,000!
            </p>
          </div>
        </div>
      )}

      <BottomNav />
    </motion.div>
  );
}