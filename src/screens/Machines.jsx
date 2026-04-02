import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, orderBy, onSnapshot, getDocs, writeBatch, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../services/firebase';
import { useAuth } from '../store/AuthContext';
import BottomNav from '../components/BottomNav';
import toast from 'react-hot-toast';
import confetti from 'canvas-confetti';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrorHandler';

export default function Machines() {
  const { user } = useAuth();
  const [tab, setTab] = useState('shop'); // shop, mine
  const [tiers, setTiers] = useState([]);
  const [myMachines, setMyMachines] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubTiers = onSnapshot(query(collection(db, 'machineTiers'), orderBy('sortOrder')), async (snap) => {
      const expectedTiers = [
        { name: 'Bronze Rig', icon: '🔩', priceKes: 499, weeklyReturnPct: 12, weeklyAmountKes: Math.round(499 * 0.12), sortOrder: 1, isActive: true },
        { name: 'Silver Rig', icon: '⚙️', priceKes: 1299, weeklyReturnPct: 15, weeklyAmountKes: Math.round(1299 * 0.15), sortOrder: 2, isActive: true },
        { name: 'Gold Rig', icon: '🏆', priceKes: 3299, weeklyReturnPct: 18, weeklyAmountKes: Math.round(3299 * 0.18), sortOrder: 3, isActive: true },
        { name: 'Diamond Rig', icon: '💎', priceKes: 4599, weeklyReturnPct: 20, weeklyAmountKes: Math.round(4599 * 0.20), sortOrder: 4, isActive: true },
        { name: 'Platinum Rig', icon: '👑', priceKes: 5999, weeklyReturnPct: 22, weeklyAmountKes: Math.round(5999 * 0.22), sortOrder: 5, isActive: true }
      ];

      if (snap.empty && user) {
        // Auto-seed if empty
        const batch = writeBatch(db);
        expectedTiers.forEach(t => {
          const ref = doc(collection(db, 'machineTiers'));
          batch.set(ref, t);
        });
        try {
          await batch.commit();
        } catch (e) {
          console.error("Failed to seed tiers", e);
        }
      } else if (!snap.empty && user) {
        const currentTiers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const needsUpdate = currentTiers.length !== 5 || currentTiers.some(t => t.name === 'Bronze Rig' && t.priceKes !== 499);
        
        if (needsUpdate) {
          const batch = writeBatch(db);
          // Delete old tiers
          snap.docs.forEach(d => batch.delete(d.ref));
          // Add new tiers
          expectedTiers.forEach(t => {
            const ref = doc(collection(db, 'machineTiers'));
            batch.set(ref, t);
          });
          try {
            await batch.commit();
          } catch (e) {
            console.error("Failed to update tiers", e);
          }
        } else {
          setTiers(currentTiers);
        }
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, 'machineTiers'));

    let unsubMine = () => {};
    if (user) {
      unsubMine = onSnapshot(query(collection(db, 'userMachines'), where('userId', '==', user.uid)), (snap) => {
        setMyMachines(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, (error) => handleFirestoreError(error, OperationType.GET, 'userMachines'));
    }

    return () => { unsubTiers(); unsubMine(); };
  }, [user]);

  const handleBuy = async (tier) => {
    if (!user) return;
    setLoading(true);
    try {
      await runTransaction(db, async (t) => {
        const userRef = doc(db, 'users', user.uid);
        const walletRef = doc(db, 'wallets', user.uid);
        
        const [userSnap, walletSnap] = await Promise.all([
          t.get(userRef), t.get(walletRef)
        ]);

        if (!userSnap.exists() || !walletSnap.exists()) {
          throw new Error('Data not found');
        }

        const userData = userSnap.data();
        const walletData = walletSnap.data();

        if (!userData.isActive) throw new Error('Account suspended');
        if (walletData.balanceKes < tier.priceKes) throw new Error('Insufficient balance. Please deposit funds.');

        // Deduct price
        t.update(walletRef, {
          balanceKes: walletData.balanceKes - tier.priceKes,
          updatedAt: serverTimestamp()
        });

        // Create machine
        const machineRef = doc(collection(db, 'userMachines'));
        const now = new Date();
        
        // Next payout is Friday at 3 PM
        const nextPayout = new Date(now);
        nextPayout.setDate(now.getDate() + ((5 - now.getDay() + 7) % 7));
        nextPayout.setHours(15, 0, 0, 0);
        
        // If it's already past Friday 1 PM, move to next Friday
        if (now.getDay() === 5 && now.getHours() >= 13) {
          nextPayout.setDate(nextPayout.getDate() + 7);
        }
        
        t.set(machineRef, {
          userId: user.uid,
          tierId: tier.id,
          tierName: tier.name,
          tierIcon: tier.icon,
          weeklyAmountKes: tier.weeklyAmountKes,
          purchasedAt: serverTimestamp(),
          lastPayoutAt: null,
          nextPayoutAt: nextPayout,
          totalPaidOut: 0,
          ownershipPct: 100,
          isActive: true
        });

        // Create transaction
        const txRef = doc(collection(db, 'transactions'));
        t.set(txRef, {
          userId: user.uid,
          type: 'machine_purchase',
          amountKes: tier.priceKes,
          direction: 'debit',
          balanceBefore: walletData.balanceKes,
          balanceAfter: walletData.balanceKes - tier.priceKes,
          description: `Purchased ${tier.name}`,
          idempotencyKey: 'buy_' + machineRef.id,
          status: 'completed',
          createdAt: serverTimestamp()
        });

        // Create spin tickets based on rig value
        let numTickets = 1;
        if (tier.name === 'Silver Rig') numTickets = 2;
        else if (tier.name === 'Gold Rig') numTickets = 3;
        else if (tier.name === 'Diamond Rig') numTickets = 4;
        else if (tier.name === 'Platinum Rig') numTickets = 5;

        for (let i = 0; i < numTickets; i++) {
          const ticketRef = doc(collection(db, 'spinTickets'));
          t.set(ticketRef, {
            userId: user.uid,
            source: 'machine_purchase',
            used: false,
            createdAt: serverTimestamp()
          });
        }
      });

      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#f0a500', '#ff6b35', '#ffffff', '#4caf50'] });
      toast.success('⛏️ Machine purchased! First payout in 7 days');
      setTab('mine');
    } catch (error) {
      toast.error(error.message || 'Failed to buy machine');
    }
    setLoading(false);
  };

  const handleListFraction = async () => {
    if (!sellModal) return;
    setLoading(true);
    const functions = getFunctions();
    const sellFraction = httpsCallable(functions, 'sellFraction');
    try {
      await sellFraction({ machineId: sellModal.id, pctForSale: sellPct });
      toast.success('Fraction listed on marketplace!');
      setSellModal(null);
      setTab('market');
    } catch (error) {
      toast.error(error.message || 'Failed to list fraction');
    }
    setLoading(false);
  };

  const handleBuyFraction = async (frac) => {
    setLoading(true);
    const functions = getFunctions();
    const buyFraction = httpsCallable(functions, 'buyFraction');
    try {
      await buyFraction({ fractionId: frac.id });
      confetti({ particleCount: 100, spread: 60, origin: { y: 0.6 } });
      toast.success('Fraction purchased successfully!');
    } catch (error) {
      toast.error(error.message || 'Failed to buy fraction');
    }
    setLoading(false);
  };

  const ownedTierIds = myMachines.map(m => m.tierId);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pb-24 min-h-screen px-4 pt-6">
      <h1 className="text-2xl font-bold mb-6">Mining Rigs</h1>

      <div className="flex bg-white/5 rounded-lg p-1 mb-6">
        {['shop', 'mine'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${tab === t ? 'bg-[#f0a500] text-white shadow-md' : 'text-white/60'}`}
          >
            {t === 'shop' ? 'Shop' : 'My Rigs'}
          </button>
        ))}
      </div>

      {tab === 'shop' && (
        <div className="grid grid-cols-2 gap-4">
          {tiers.map(tier => (
            <div key={tier.id} className="card flex flex-col items-center text-center p-4">
              <div className="text-5xl mb-3">{tier.icon}</div>
              <h3 className="font-bold text-sm mb-1">{tier.name}</h3>
              <p className="text-[#f0a500] font-bold mb-1">KES {tier.priceKes.toLocaleString()}</p>
              <p className="text-[10px] text-white/50 mb-4">Earn KES {tier.weeklyAmountKes}/wk</p>
              
              {ownedTierIds.includes(tier.id) ? (
                <button disabled className="w-full py-2 rounded bg-white/10 text-white/40 text-xs font-bold mt-auto">Owned ✓</button>
              ) : (
                <button 
                  onClick={() => handleBuy(tier)} 
                  disabled={loading} 
                  className="w-full py-2 rounded bg-gradient-to-r from-[#f0a500] to-[#ff6b35] text-white text-xs font-bold active:scale-95 transition-transform mt-auto"
                >
                  Buy Now
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'mine' && (
        <div className="space-y-4">
          {myMachines.length === 0 ? (
            <p className="text-center text-white/50 mt-10">You don't own any machines yet.</p>
          ) : (
            myMachines.map(m => {
              const now = new Date().getTime();
              const last = m.lastPayoutAt?.toMillis() || m.purchasedAt.toMillis();
              const next = m.nextPayoutAt.toMillis();
              const progress = Math.min(100, Math.max(0, ((now - last) / (next - last)) * 100));

              return (
                <motion.div whileHover={{ scale: 1.02 }} key={m.id} className="card p-4">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="text-4xl">{m.tierIcon}</div>
                    <div className="flex-1">
                      <h3 className="font-bold">{m.tierName}</h3>
                      <p className="text-xs text-[#4caf50]">Total Earned: KES {m.totalPaidOut.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="w-full bg-white/10 h-2 rounded-full mb-2 overflow-hidden">
                    <div className="bg-[#f0a500] h-full rounded-full" style={{ width: `${progress}%` }}></div>
                  </div>
                  <div className="flex justify-between text-[10px] text-white/50">
                    <span>Progress to payout</span>
                    <span>Next: KES {m.weeklyAmountKes}</span>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      )}

      <BottomNav />
    </motion.div>
  );
}