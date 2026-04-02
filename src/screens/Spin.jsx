import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, orderBy, limit, onSnapshot, writeBatch, doc, runTransaction, getDocs, increment, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../services/firebase';
import { useAuth } from '../store/AuthContext';
import BottomNav from '../components/BottomNav';
import toast from 'react-hot-toast';
import confetti from 'canvas-confetti';
import html2canvas from 'html2canvas';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrorHandler';

export default function Spin() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState(0);
  const [history, setHistory] = useState([]);
  const [prizes, setPrizes] = useState([]);
  const [spinning, setSpinning] = useState(false);
  const [winModal, setWinModal] = useState(null);
  
  const canvasRef = useRef(null);
  const rotationRef = useRef(0);
  const modalRef = useRef(null);

  useEffect(() => {
    if (!user) return;

    const unsubTickets = onSnapshot(query(collection(db, 'spinTickets'), where('userId', '==', user.uid), where('used', '==', false)), (snap) => {
      setTickets(snap.docs.length);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'spinTickets'));

    const unsubHistory = onSnapshot(query(collection(db, 'spinResults'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(5)), (snap) => {
      setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'spinResults'));

    const unsubPrizes = onSnapshot(query(collection(db, 'spinPrizes'), where('isActive', '==', true)), async (snap) => {
      if (snap.empty && user) {
        const batch = writeBatch(db);
        const p1 = doc(collection(db, 'spinPrizes'));
        batch.set(p1, { label: 'KES 50', prizeType: 'cash', cashAmount: 50, probabilityWeight: 40, isActive: true });
        const p2 = doc(collection(db, 'spinPrizes'));
        batch.set(p2, { label: 'KES 100', prizeType: 'cash', cashAmount: 100, probabilityWeight: 30, isActive: true });
        const p3 = doc(collection(db, 'spinPrizes'));
        batch.set(p3, { label: 'KES 500', prizeType: 'cash', cashAmount: 500, probabilityWeight: 10, isActive: true });
        const p4 = doc(collection(db, 'spinPrizes'));
        batch.set(p4, { label: 'Try Again', prizeType: 'empty', cashAmount: 0, probabilityWeight: 20, isActive: true });
        try {
          await batch.commit();
        } catch (e) {
          console.error("Failed to seed spin prizes", e);
        }
      } else {
        setPrizes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, 'spinPrizes'));

    return () => { unsubTickets(); unsubHistory(); unsubPrizes(); };
  }, [user]);

  useEffect(() => {
    drawWheel();
  }, [prizes]);

  const drawWheel = () => {
    const canvas = canvasRef.current;
    if (!canvas || prizes.length === 0) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(cx, cy) - 10;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotationRef.current);

    const sliceAngle = (2 * Math.PI) / prizes.length;
    const colors = ['#f0a500', '#111225', '#ff6b35', '#1a1a35'];

    prizes.forEach((prize, i) => {
      const startAngle = i * sliceAngle;
      const endAngle = (i + 1) * sliceAngle;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, startAngle, endAngle);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.rotate(startAngle + sliceAngle / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px Sora, sans-serif';
      ctx.fillText(prize.label, radius - 20, 4);
      ctx.restore();
    });

    // Center circle
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, 2 * Math.PI);
    ctx.fillStyle = '#0a0a1a';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#f0a500';
    ctx.stroke();
    
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '20px sans-serif';
    ctx.fillText('⛏️', 0, 0);

    ctx.restore();
  };

  const handleSpin = async () => {
    if (tickets === 0) {
      toast.error('No tickets available!');
      return;
    }
    if (spinning) return;

    setSpinning(true);

    try {
      // Start server call
      const spinPromise = runTransaction(db, async (t) => {
        const ticketsQuery = query(collection(db, 'spinTickets'), where('userId', '==', user.uid), where('used', '==', false), limit(1));
        let ticketsSnap;
        try {
          ticketsSnap = await getDocs(ticketsQuery);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, 'spinTickets');
          throw error;
        }
        
        if (ticketsSnap.empty) throw new Error('No tickets available');
        const ticketDoc = ticketsSnap.docs[0];

        const prizesQuery = query(collection(db, 'spinPrizes'), where('isActive', '==', true));
        let prizesSnap;
        try {
          prizesSnap = await getDocs(prizesQuery);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, 'spinPrizes');
          throw error;
        }
        const prizesList = prizesSnap.docs.map(d => d.data());
        
        const total = prizesList.reduce((s, p) => s + p.probabilityWeight, 0);
        let rand = Math.random() * total;
        let selected = prizesList[0];
        for (const prize of prizesList) {
          if (rand < prize.probabilityWeight) { selected = prize; break; }
          rand -= prize.probabilityWeight;
        }

        const userRef = doc(db, 'users', user.uid);
        const userSnap = await t.get(userRef);
        const userData = userSnap.data() || {};

        // Streak Logic
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        let newStreak = userData.spinStreak || 0;
        let lastSpinDate = userData.lastSpinDate || '';
        let streakBonusAwarded = false;

        if (lastSpinDate !== todayStr) {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split('T')[0];

          if (lastSpinDate === yesterdayStr) {
            newStreak += 1;
          } else {
            newStreak = 1;
          }

          t.update(userRef, {
            spinStreak: newStreak,
            lastSpinDate: todayStr
          });

          if (newStreak % 5 === 0) {
            streakBonusAwarded = true;
            // Award 2 tickets
            for (let i = 0; i < 2; i++) {
              t.set(doc(collection(db, 'spinTickets')), {
                userId: user.uid, source: 'streak_bonus', used: false, createdAt: serverTimestamp()
              });
            }
            // Award a small cash prize (e.g., KES 100)
            const walletRef = doc(db, 'wallets', user.uid);
            t.update(walletRef, {
              balanceKes: increment(100),
              totalEarned: increment(100),
              updatedAt: serverTimestamp()
            });
            const txRef = doc(collection(db, 'transactions'));
            t.set(txRef, {
              userId: user.uid, type: 'streak_bonus', amountKes: 100,
              direction: 'credit', description: `5-Day Spin Streak Bonus`,
              status: 'completed', createdAt: serverTimestamp()
            });
          }
        }

        t.update(doc(db, 'spinTickets', ticketDoc.id), { used: true, usedAt: serverTimestamp() });

        const resultRef = doc(collection(db, 'spinResults'));
        t.set(resultRef, {
          userId: user.uid,
          ticketId: ticketDoc.id,
          prizeLabel: selected.label,
          prizeType: selected.prizeType,
          cashAmount: selected.cashAmount,
          claimed: true,
          createdAt: serverTimestamp()
        });

        if (selected.prizeType === 'cash') {
          const walletRef = doc(db, 'wallets', user.uid);
          t.update(walletRef, {
            balanceKes: increment(selected.cashAmount),
            totalEarned: increment(selected.cashAmount),
            updatedAt: serverTimestamp()
          });
          const txRef = doc(collection(db, 'transactions'));
          t.set(txRef, {
            userId: user.uid, type: 'spin_win', amountKes: selected.cashAmount,
            direction: 'credit', description: `Spin Wheel Win: ${selected.label}`,
            status: 'completed', createdAt: serverTimestamp()
          });
        } else if (selected.prizeType === 'tickets') {
          for (let i = 0; i < 2; i++) {
            t.set(doc(collection(db, 'spinTickets')), {
              userId: user.uid, source: 'spin_win', used: false, createdAt: serverTimestamp()
            });
          }
        }

        return {
          prizeLabel: selected.label,
          prizeType: selected.prizeType,
          cashAmount: selected.cashAmount,
          confetti: selected.prizeType !== 'empty',
          streakBonusAwarded
        };
      });

      // Start visual animation
      const duration = 4000;
      const startAngle = rotationRef.current;
      const targetAngle = startAngle + (Math.PI * 2 * 4) + (Math.random() * Math.PI * 2); // 4 full spins + random
      const startTime = performance.now();

      const animate = (time) => {
        const elapsed = time - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // cubic ease-out
        
        rotationRef.current = startAngle + (targetAngle - startAngle) * eased;
        drawWheel();

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);

      // Wait for both
      const [result] = await Promise.all([
        spinPromise,
        new Promise(resolve => setTimeout(resolve, duration))
      ]);

      setWinModal(result);
      if (result.confetti) {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#f0a500', '#ff6b35', '#ffffff', '#4caf50'] });
        if (navigator.vibrate) navigator.vibrate(200);
      }

      // If it's a cash prize, we can show a toast immediately (the wallet listener will update the UI automatically)
      if (result.prizeType === 'cash') {
        toast.success(`You won KES ${result.cashAmount}! Your earnings have been updated.`);
      }
      if (result.streakBonusAwarded) {
        toast.success(`🔥 5-Day Streak! You won 2 extra tickets and KES 100!`, { duration: 5000 });
      }

    } catch (error) {
      toast.error(error.message || 'Spin failed');
    }
    setSpinning(false);
  };

  const shareWin = async () => {
    if (!modalRef.current) return;
    try {
      const canvas = await html2canvas(modalRef.current, { backgroundColor: '#111225' });
      canvas.toBlob(async (blob) => {
        const file = new File([blob], 'win.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'BitFarm Win!',
            text: `I just won ${winModal.prizeLabel} on BitFarm!`,
            files: [file]
          });
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'bitfarm-win.png';
          a.click();
        }
      });
    } catch (e) {
      console.error('Share error', e);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pb-24 min-h-screen px-4 pt-6 flex flex-col items-center">
      <h1 className="text-2xl font-bold mb-2">Lucky Spin</h1>
      <p className="text-white/60 text-sm mb-8">Tickets Available: <span className="font-bold text-[#f0a500]">{tickets}</span></p>

      <div className="relative mb-10">
        {/* Pointer */}
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[20px] border-t-[#f0a500] drop-shadow-lg"></div>
        
        <canvas 
          ref={canvasRef} 
          width={280} 
          height={280} 
          className="rounded-full shadow-[0_0_30px_rgba(240,165,0,0.2)]"
        />
      </div>

      <button 
        onClick={handleSpin} 
        disabled={spinning || tickets === 0}
        className={`w-full max-w-[280px] py-4 rounded-xl font-bold text-lg transition-transform ${spinning || tickets === 0 ? 'bg-white/10 text-white/40' : 'bg-gradient-to-r from-[#f0a500] to-[#ff6b35] text-white active:scale-95 shadow-lg shadow-[#f0a500]/20'}`}
      >
        {spinning ? 'Spinning...' : 'SPIN NOW'}
      </button>

      <div className="w-full mt-10">
        <h3 className="font-bold text-sm mb-3">Potential Prizes</h3>
        <div className="grid grid-cols-2 gap-2 mb-6">
          {prizes.map((p, idx) => (
            <div key={idx} className="bg-white/5 p-2 rounded text-center text-xs">
              {p.label}
            </div>
          ))}
        </div>

        <h3 className="font-bold text-sm mb-3">Recent Wins</h3>
        <div className="space-y-2">
          {history.length === 0 ? (
            <p className="text-xs text-white/40 text-center">No spins yet</p>
          ) : (
            history.map(h => (
              <div key={h.id} className="flex justify-between items-center bg-white/5 p-3 rounded-lg">
                <span className="text-sm">{h.prizeLabel}</span>
                <span className="text-[10px] text-white/50">{new Date(h.createdAt?.toDate()).toLocaleDateString()}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <AnimatePresence>
        {winModal && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.8, y: 50 }} animate={{ scale: 1, y: 0 }}
              className="bg-[#111225] border-2 border-[#f0a500] rounded-2xl p-8 w-full max-w-[320px] text-center shadow-[0_0_50px_rgba(240,165,0,0.3)]"
              ref={modalRef}
            >
              <div className="text-6xl mb-4">🎉</div>
              <h2 className="text-2xl font-bold mb-2">You Won!</h2>
              <p className="text-3xl font-bold text-[#f0a500] mb-8">{winModal.prizeLabel}</p>
              
              <div className="flex flex-col gap-3">
                <button onClick={shareWin} className="btn-primary">Share Win</button>
                <button onClick={() => setWinModal(null)} className="btn-outline text-white border-white/20">Awesome!</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNav />
    </motion.div>
  );
}