import React, { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, startAfter, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../services/firebase';
import toast from 'react-hot-toast';
import { handleFirestoreError, OperationType } from '../../utils/firestoreErrorHandler';

export default function AdminDepositQueue() {
  const [requests, setRequests] = useState([]);
  const [loadingId, setLoadingId] = useState(null);
  const functions = getFunctions();
  
  const [loading, setLoading] = useState(true);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [pageHistory, setPageHistory] = useState([]); // Stack of lastDocs for "Previous"
  const PAGE_SIZE = 10;

  const fetchDeposits = async (startDoc = null, isBack = false) => {
    setLoading(true);
    try {
      let q = query(
        collection(db, 'depositRequests'), 
        where('status', '==', 'pending_admin_review'), 
        orderBy('submittedAt', 'asc'),
        limit(PAGE_SIZE)
      );

      if (startDoc) {
        q = query(q, startAfter(startDoc));
      }

      const snap = await getDocs(q);
      const deps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setRequests(deps);
      setHasMore(snap.docs.length === PAGE_SIZE);
      
      if (!isBack && startDoc) {
        setPageHistory(prev => [...prev, lastDoc]);
      }
      setLastDoc(snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'depositRequests');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchDeposits();
  }, []);

  const handleNext = () => {
    if (hasMore && lastDoc) {
      fetchDeposits(lastDoc);
    }
  };

  const handlePrev = () => {
    if (pageHistory.length > 0) {
      const prevDoc = pageHistory[pageHistory.length - 1];
      setPageHistory(prev => prev.slice(0, -1));
      fetchDeposits(prevDoc, true);
    } else {
      fetchDeposits(null, true);
    }
  };

  const handleVerify = async (id) => {
    if (!window.confirm('Have you verified this exact amount and code on the M-PESA statement?')) return;
    setLoadingId(id);
    try {
      const verify = httpsCallable(functions, 'verifyDepositRequest');
      await verify({ depositRequestId: id });
      toast.success('Deposit verified and wallet credited.');
      setRequests(requests.filter(r => r.id !== id));
    } catch (error) {
      toast.error(error.message);
    }
    setLoadingId(null);
  };

  const handleReject = async (id) => {
    const reason = window.prompt('Enter rejection reason (e.g., "Code not found on statement"):');
    if (!reason) return;
    setLoadingId(id);
    try {
      const reject = httpsCallable(functions, 'rejectDepositRequest');
      await reject({ depositRequestId: id, reason });
      toast.success('Deposit rejected.');
      setRequests(requests.filter(r => r.id !== id));
    } catch (error) {
      toast.error(error.message);
    }
    setLoadingId(null);
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Pending Deposits</h2>
        <button onClick={() => fetchDeposits(null, true)} className="px-3 py-1 bg-white/10 rounded text-sm hover:bg-white/20">
          Refresh
        </button>
      </div>
      
      <div className="bg-[#111225] rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/40 text-white/60">
            <tr>
              <th className="p-4">Time Submitted</th>
              <th className="p-4">User ID</th>
              <th className="p-4">M-PESA Code</th>
              <th className="p-4">Amount (KES)</th>
              <th className="p-4">Alert Status</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-white/40">Loading deposits...</td></tr>
            ) : requests.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-white/40">No pending deposits.</td></tr>
            ) : (
              requests.map(req => {
                const hoursPending = (Date.now() - req.submittedAt.toMillis()) / (1000 * 60 * 60);
                const isAlert = hoursPending > 4;

                return (
                  <tr key={req.id} className="border-t border-white/5">
                    <td className="p-4">{new Date(req.submittedAt.toMillis()).toLocaleString()}</td>
                    <td className="p-4 font-mono text-xs">{req.userId}</td>
                    <td className="p-4 font-mono font-bold text-[#f0a500]">{req.mpesaCode}</td>
                    <td className="p-4 font-bold">{req.amountKes}</td>
                    <td className="p-4">
                      {isAlert ? <span className="text-red-500 font-bold">⚠️ &gt; 4 Hours</span> : <span className="text-green-500">Normal</span>}
                    </td>
                    <td className="p-4 text-right space-x-2">
                      <button 
                        onClick={() => handleVerify(req.id)} 
                        disabled={loadingId === req.id}
                        className="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-xs font-bold disabled:opacity-50"
                      >
                        Verify
                      </button>
                      <button 
                        onClick={() => handleReject(req.id)} 
                        disabled={loadingId === req.id}
                        className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded text-xs font-bold disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        
        {!loading && requests.length > 0 && (
          <div className="flex justify-between items-center p-4 border-t border-white/10">
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
        )}
      </div>
    </div>
  );
}
