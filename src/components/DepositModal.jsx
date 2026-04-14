import React, { useState, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../store/AuthContext';
import toast from 'react-hot-toast';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrorHandler';

export default function DepositModal({ onClose }) {
  const { user } = useAuth();
  const [activeRequest, setActiveRequest] = useState(null);
  const [amount, setAmount] = useState('');
  const [mpesaCode, setMpesaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const functions = getFunctions();

  // Listen for active requests to prevent duplicates and show status
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'depositRequests'), where('userId', '==', user.uid), where('status', '==', 'pending_admin_review'));
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        setActiveRequest({ id: snap.docs[0].id, ...snap.docs[0].data() });
      } else {
        setActiveRequest(null);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, 'depositRequests'));
    return () => unsub();
  }, [user]);

  const handleSubmitProof = async () => {
    if (!amount || amount < 50) return toast.error('Minimum KES 50');
    if (!mpesaCode || mpesaCode.length < 8) return toast.error('Invalid M-PESA code');
    
    setLoading(true);
    try {
      const submitProof = httpsCallable(functions, 'submitDepositProof');
      await submitProof({ amountKes: Number(amount), mpesaCode });
      toast.success('Proof submitted! Awaiting admin verification.');
    } catch (error) {
      toast.error(error.message);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-[#111225] p-6 rounded-xl w-full max-w-md border border-white/10">
        <h2 className="text-xl font-bold mb-4">Deposit via M-PESA</h2>
        
        {!activeRequest && (
          <div className="space-y-4">
            <div className="bg-[#1a1a35] p-4 rounded-lg text-center border border-[#f0a500]/30">
              <p className="text-sm text-white/60">1. Go to M-PESA Paybill</p>
              <p className="font-bold text-lg text-[#f0a500]">Paybill: 880100</p>
              <p className="font-bold text-lg text-[#f0a500]">Account: 9412260019</p>
            </div>
            
            <div>
              <label className="text-xs text-white/60">2. Enter Exact Amount Deposited</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded p-3 mt-1" placeholder="KES" />
            </div>
            
            <div>
              <label className="text-xs text-white/60">3. Enter M-PESA Transaction Code</label>
              <input type="text" value={mpesaCode} onChange={e => setMpesaCode(e.target.value.toUpperCase())} className="w-full bg-black/50 border border-white/10 rounded p-3 mt-1 uppercase" placeholder="e.g. UD9QK05L91" />
            </div>

            <button onClick={handleSubmitProof} disabled={loading} className="w-full btn-primary py-3 mt-2">
              {loading ? 'Submitting...' : 'Submit Proof'}
            </button>
          </div>
        )}

        {activeRequest?.status === 'pending_admin_review' && (
          <div className="text-center py-6">
            <div className="animate-pulse text-4xl mb-4">⏳</div>
            <h3 className="font-bold text-lg text-[#f0a500]">Verification Pending</h3>
            <p className="text-sm text-white/60 mt-2">Your deposit of KES {activeRequest.amountKes} (Code: {activeRequest.mpesaCode}) is being reviewed by our team. This usually takes 1-4 hours.</p>
          </div>
        )}

        <button onClick={onClose} className="w-full mt-4 py-2 text-sm text-white/40 hover:text-white">Close</button>
      </div>
    </div>
  );
}
