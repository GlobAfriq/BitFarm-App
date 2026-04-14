import React, { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../services/firebase';
import toast from 'react-hot-toast';
import { handleFirestoreError, OperationType } from '../../utils/firestoreErrorHandler';

export default function AdminDepositQueue() {
  const [requests, setRequests] = useState([]);
  const [loadingId, setLoadingId] = useState(null);
  const functions = getFunctions();

  useEffect(() => {
    const q = query(collection(db, 'depositRequests'), where('status', '==', 'pending_admin_review'), orderBy('submittedAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'depositRequests'));
    return () => unsub();
  }, []);

  const handleVerify = async (id) => {
    if (!window.confirm('Have you verified this exact amount and code on the M-PESA statement?')) return;
    setLoadingId(id);
    try {
      const verify = httpsCallable(functions, 'verifyDepositRequest');
      await verify({ depositRequestId: id });
      toast.success('Deposit verified and wallet credited.');
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
    } catch (error) {
      toast.error(error.message);
    }
    setLoadingId(null);
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Pending Deposits ({requests.length})</h2>
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
            {requests.map(req => {
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
                      className="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-xs font-bold"
                    >
                      Verify
                    </button>
                    <button 
                      onClick={() => handleReject(req.id)} 
                      disabled={loadingId === req.id}
                      className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded text-xs font-bold"
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              );
            })}
            {requests.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-white/40">No pending deposits.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
