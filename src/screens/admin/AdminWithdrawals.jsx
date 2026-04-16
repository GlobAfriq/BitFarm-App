import React, { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, startAfter, getDocs, getDoc, doc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../services/firebase';
import toast from 'react-hot-toast';
import { handleFirestoreError, OperationType } from '../../utils/firestoreErrorHandler';

export default function AdminWithdrawals() {
  const [withdrawals, setWithdrawals] = useState([]);
  const [userCache, setUserCache] = useState({});
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  
  const [loading, setLoading] = useState(true);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [pageHistory, setPageHistory] = useState([]); // Stack of lastDocs for "Previous"
  const PAGE_SIZE = 10;

  const fetchWithdrawals = async (startDoc = null, isBack = false) => {
    setLoading(true);
    try {
      let q = query(
        collection(db, 'withdrawals'), 
        where('status', '==', 'pending'), 
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE)
      );

      if (startDoc) {
        q = query(q, startAfter(startDoc));
      }

      const snap = await getDocs(q);
      const wds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setWithdrawals(wds);
      setHasMore(snap.docs.length === PAGE_SIZE);
      
      if (!isBack && startDoc) {
        setPageHistory(prev => [...prev, lastDoc]);
      }
      setLastDoc(snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null);

      const newCache = { ...userCache };
      for (const w of wds) {
        if (!newCache[w.userId]) {
          try {
            const uDoc = await getDoc(doc(db, 'users', w.userId));
            if (uDoc.exists()) newCache[w.userId] = uDoc.data();
          } catch (error) {
            handleFirestoreError(error, OperationType.GET, `users/${w.userId}`);
          }
        }
      }
      setUserCache(newCache);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'withdrawals');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchWithdrawals();
  }, []);

  const handleNext = () => {
    if (hasMore && lastDoc) {
      fetchWithdrawals(lastDoc);
    }
  };

  const handlePrev = () => {
    if (pageHistory.length > 0) {
      const prevDoc = pageHistory[pageHistory.length - 1];
      setPageHistory(prev => prev.slice(0, -1));
      fetchWithdrawals(prevDoc, true);
    } else {
      fetchWithdrawals(null, true);
    }
  };

  const handleApprove = async (id) => {
    if (!window.confirm('Approve this withdrawal? Funds will be sent to M-Pesa.')) return;
    const functions = getFunctions();
    const approveWithdrawal = httpsCallable(functions, 'approveWithdrawal');
    try {
      await approveWithdrawal({ withdrawalId: id });
      toast.success('Withdrawal approved');
      setWithdrawals(withdrawals.filter(w => w.id !== id));
    } catch (error) {
      toast.error(error.message || 'Failed to approve');
    }
  };

  const handleReject = async () => {
    if (!rejectReason) return toast.error('Reason required');
    const functions = getFunctions();
    const rejectWithdrawal = httpsCallable(functions, 'rejectWithdrawal');
    try {
      await rejectWithdrawal({ withdrawalId: rejectModal, reason: rejectReason });
      toast.success('Withdrawal rejected');
      setWithdrawals(withdrawals.filter(w => w.id !== rejectModal));
      setRejectModal(null);
      setRejectReason('');
    } catch (error) {
      toast.error(error.message || 'Failed to reject');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Pending Withdrawals</h1>
        <button onClick={() => fetchWithdrawals(null, true)} className="px-3 py-1 bg-white/10 rounded text-sm hover:bg-white/20">
          Refresh
        </button>
      </div>

      <div className="space-y-4">
        {loading ? (
          <p className="text-center py-10 text-white/50">Loading withdrawals...</p>
        ) : withdrawals.length === 0 ? (
          <p className="text-white/50">No pending withdrawals.</p>
        ) : (
          <>
            {withdrawals.map(w => {
              const u = userCache[w.userId];
              return (
                <div key={w.id} className="card p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <p className="font-bold">{u?.fullName || 'Loading...'} <span className="text-white/50 font-normal text-sm">({w.destination})</span></p>
                    <p className="text-sm text-white/70 mt-1">Requested: {new Date(w.createdAt?.toDate()).toLocaleString()}</p>
                    <div className="flex gap-4 mt-2 text-sm">
                      <span className="text-white/60">Amount: KES {w.amountKes}</span>
                      <span className="text-red-400">Fee: KES {w.feeKes}</span>
                      <span className="text-green-400 font-bold">Net: KES {w.netAmount}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 w-full md:w-auto">
                    <button onClick={() => handleApprove(w.id)} className="flex-1 md:flex-none px-4 py-2 bg-green-600 text-white rounded font-bold hover:bg-green-500">
                      Approve
                    </button>
                    <button onClick={() => setRejectModal(w.id)} className="flex-1 md:flex-none px-4 py-2 bg-red-600 text-white rounded font-bold hover:bg-red-500">
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
            
            <div className="flex justify-between items-center mt-6 p-4 bg-white/5 rounded-lg">
              <button 
                onClick={handlePrev} 
                disabled={pageHistory.length === 0}
                className="px-4 py-2 bg-white/10 rounded font-bold disabled:opacity-30 hover:bg-white/20 transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-white/50">Page {pageHistory.length + 1}</span>
              <button 
                onClick={handleNext} 
                disabled={!hasMore}
                className="px-4 py-2 bg-white/10 rounded font-bold disabled:opacity-30 hover:bg-white/20 transition-colors"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>

      {rejectModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-[#111225] p-6 rounded-xl w-full max-w-md border border-red-500/30">
            <h2 className="text-xl font-bold mb-4">Reject Withdrawal</h2>
            <textarea 
              value={rejectReason} 
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (sent to user)..."
              className="input-field bg-white/5 h-24 mb-4 resize-none"
            />
            <div className="flex gap-2">
              <button onClick={handleReject} className="flex-1 bg-red-600 py-2 rounded font-bold text-white">Confirm Reject</button>
              <button onClick={() => setRejectModal(null)} className="flex-1 bg-white/10 py-2 rounded font-bold text-white">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}