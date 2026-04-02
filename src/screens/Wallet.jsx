import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../services/firebase';
import { useAuth } from '../store/AuthContext';
import useCountUp from '../hooks/useCountUp';
import BottomNav from '../components/BottomNav';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { ArrowDownLeft, ArrowUpRight, Copy } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrorHandler';

export default function Wallet() {
  const { user, wallet } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [filter, setFilter] = useState('all');
  const [sheet, setSheet] = useState(null); // 'deposit' | 'withdraw' | null
  const [amount, setAmount] = useState('');
  const [depMethod, setDepMethod] = useState('mpesa');
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || '');
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [usdtData, setUsdtData] = useState(null);

  const animatedBalance = useCountUp(wallet?.balanceKes || 0);

  useEffect(() => {
    if (!user) return;
    let q = query(collection(db, 'transactions'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(20));
    const unsub = onSnapshot(q, (snap) => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'transactions'));
    return () => unsub();
  }, [user]);

  const filteredTx = transactions.filter(tx => {
    if (filter === 'all') return true;
    if (filter === 'deposits') return tx.type === 'deposit';
    if (filter === 'withdrawals') return tx.type === 'withdrawal';
    if (filter === 'earnings') return ['payout', 'referral_commission', 'spin_win'].includes(tx.type);
    return true;
  });

  const handleDeposit = async () => {
    if (!amount || isNaN(amount) || Number(amount) < 50) {
      toast.error('Minimum deposit is KES 50');
      return;
    }
    if (depMethod === 'mpesa' && (!phoneNumber || phoneNumber.length < 9)) {
      toast.error('Please enter a valid M-Pesa phone number');
      return;
    }
    setLoading(true);
    const functions = getFunctions();
    const initiateDeposit = httpsCallable(functions, 'initiateDeposit');
    try {
      const res = await initiateDeposit({ method: depMethod, amountKes: Number(amount), phoneNumber: phoneNumber });
      if (depMethod === 'mpesa') {
        toast.success(res.data.message, { duration: 5000 });
        setSheet(null);
      } else {
        setUsdtData(res.data);
      }
    } catch (error) {
      toast.error(error.message || 'Deposit failed');
    }
    setLoading(false);
  };

  const handleWithdraw = async () => {
    if (!amount || isNaN(amount) || Number(amount) < 100) {
      toast.error('Minimum withdrawal is KES 100');
      return;
    }
    if (!phoneNumber || phoneNumber.length < 9) {
      toast.error('Please enter a valid M-Pesa phone number');
      return;
    }
    if (!confirmWithdraw) {
      setConfirmWithdraw(true);
      return;
    }
    setLoading(true);
    const functions = getFunctions();
    const requestWithdrawal = httpsCallable(functions, 'requestWithdrawal');
    try {
      await requestWithdrawal({ method: 'mpesa', amountKes: Number(amount), destination: phoneNumber });
      toast.success('Withdrawal requested successfully');
      setSheet(null);
      setConfirmWithdraw(false);
    } catch (error) {
      toast.error(error.message || 'Withdrawal failed');
    }
    setLoading(false);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pb-24 min-h-screen px-4 pt-6">
      <h1 className="text-2xl font-bold mb-6">Wallet</h1>

      <div className="card bg-gradient-to-br from-[#111225] to-[#1a1a35] border border-white/10 p-6 mb-6 text-center relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#f0a500]/10 rounded-full blur-3xl"></div>
        <p className="text-white/60 text-sm mb-2">Available Balance</p>
        <div className="flex items-baseline justify-center gap-2 mb-1">
          <span className="text-xl font-bold text-[#f0a500]">KES</span>
          <span className="text-5xl font-bold tracking-tight">{animatedBalance.toLocaleString()}</span>
        </div>
        <p className="text-xs text-white/40">≈ USDT {(wallet?.balanceKes / 130 || 0).toFixed(2)}</p>
      </div>

      <div className="flex gap-3 mb-8">
        <button onClick={() => { setSheet('deposit'); setAmount(''); setUsdtData(null); }} className="flex-1 btn-primary py-3">Deposit</button>
        <button onClick={() => { setSheet('withdraw'); setAmount(''); }} className="flex-1 btn-outline py-3">Withdraw</button>
      </div>

      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold">History</h2>
          <select 
            value={filter} 
            onChange={(e) => setFilter(e.target.value)}
            className="bg-transparent text-xs text-[#f0a500] outline-none"
          >
            <option value="all" className="bg-[#111225]">All</option>
            <option value="deposits" className="bg-[#111225]">Deposits</option>
            <option value="withdrawals" className="bg-[#111225]">Withdrawals</option>
            <option value="earnings" className="bg-[#111225]">Earnings</option>
          </select>
        </div>

        <div className="space-y-3">
          {filteredTx.length === 0 ? (
            <p className="text-center text-white/40 py-8 text-sm">No transactions found</p>
          ) : (
            filteredTx.map(tx => (
              <div key={tx.id} className="card p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tx.direction === 'credit' ? 'bg-[#4caf50]/20 text-[#4caf50]' : 'bg-[#f44336]/20 text-[#f44336]'}`}>
                    {tx.direction === 'credit' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{tx.description}</p>
                    <p className="text-[10px] text-white/50">{tx.createdAt ? formatDistanceToNow(tx.createdAt.toDate(), { addSuffix: true }) : 'Just now'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-bold text-sm ${tx.direction === 'credit' ? 'text-[#4caf50]' : ''}`}>
                    {tx.direction === 'credit' ? '+' : '-'}KES {tx.amountKes.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-white/40 capitalize">{tx.status}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <AnimatePresence>
        {sheet && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center"
            onClick={() => setSheet(null)}
          >
            <motion.div 
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-[#111225] w-full max-w-[420px] rounded-t-2xl p-6"
              onClick={e => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold mb-6">{sheet === 'deposit' ? 'Deposit Funds' : 'Withdraw Funds'}</h2>
              
              {sheet === 'deposit' && (
                <>
                  <div className="mb-4">
                    <label className="block text-xs text-white/60 mb-2">M-Pesa Phone Number</label>
                    <input type="text" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} className="input-field" placeholder="07XXXXXXXX" />
                  </div>
                  <div className="mb-6">
                    <label className="block text-xs text-white/60 mb-2">Amount (KES)</label>
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="input-field text-2xl font-bold" placeholder="1000" />
                    <p className="text-[10px] text-white/40 mt-2">Payments are processed securely via M-Pesa.</p>
                  </div>
                  <button onClick={handleDeposit} disabled={loading} className="btn-primary mb-4">
                    {loading ? 'Processing...' : 'Pay with M-Pesa'}
                  </button>
                </>
              )}

              {sheet === 'withdraw' && (
                <>
                  <div className="mb-4">
                    <label className="block text-xs text-white/60 mb-2">M-Pesa Phone Number</label>
                    <input type="text" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} className="input-field" placeholder="07XXXXXXXX" />
                  </div>
                  <div className="mb-6">
                    <div className="flex justify-between text-xs text-white/60 mb-2">
                      <label>Amount (KES)</label>
                      <span>Available: KES {wallet?.balanceKes.toLocaleString()}</span>
                    </div>
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="input-field text-2xl font-bold" placeholder="1000" />
                  </div>
                  {amount && Number(amount) >= 100 && (
                    <div className="bg-white/5 p-4 rounded-lg mb-6 text-sm">
                      <div className="flex justify-between mb-2"><span className="text-white/60">Fee (2% or min 10)</span><span>KES {Math.max(Number(amount) * 0.02, 10).toFixed(0)}</span></div>
                      <div className="flex justify-between font-bold text-[#4caf50]"><span>You receive</span><span>KES {(Number(amount) - Math.max(Number(amount) * 0.02, 10)).toFixed(0)}</span></div>
                    </div>
                  )}
                  <button onClick={handleWithdraw} disabled={loading || !amount} className={`btn-primary mb-4 ${confirmWithdraw ? 'bg-red-600 border-red-600 text-white' : ''}`}>
                    {loading ? 'Processing...' : confirmWithdraw ? 'Click again to confirm' : 'Request Withdrawal'}
                  </button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNav />
    </motion.div>
  );
}