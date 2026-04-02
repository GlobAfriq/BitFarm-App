import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../services/firebase';
import toast from 'react-hot-toast';
import { handleFirestoreError, OperationType } from '../../utils/firestoreErrorHandler';

export default function AdminPayouts() {
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchPayouts = async () => {
    try {
      const q = query(collection(db, 'payouts'), orderBy('processedAt', 'desc'), limit(50));
      const snap = await getDocs(q);
      setPayouts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'payouts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPayouts(); }, []);

  const handleRunPayouts = async () => {
    if (!window.confirm('WARNING: This will process all due payouts immediately. Continue?')) return;
    setRunning(true);
    const functions = getFunctions();
    const runPayoutsNow = httpsCallable(functions, 'runPayoutsNow');
    try {
      const res = await runPayoutsNow();
      toast.success(`Processed ${res.data.processed} payouts`);
      fetchPayouts();
    } catch (error) {
      toast.error(error.message || 'Failed to run payouts');
    }
    setRunning(false);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Payouts History</h1>
        <button 
          onClick={handleRunPayouts} 
          disabled={running}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold active:scale-95"
        >
          {running ? 'Processing...' : 'Run Payouts Now'}
        </button>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <p className="text-center py-10 text-white/50">Loading payouts...</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/60">
                <th className="p-3">User ID</th>
                <th className="p-3">Machine ID</th>
                <th className="p-3">Amount (KES)</th>
                <th className="p-3">Week</th>
                <th className="p-3">Processed At</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map(p => (
                <tr key={p.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="p-3 font-mono text-xs text-white/60">{p.userId}</td>
                  <td className="p-3 font-mono text-xs text-white/60">{p.machineId}</td>
                  <td className="p-3 font-bold text-green-400">{p.amountKes}</td>
                  <td className="p-3">{p.payoutWeek}</td>
                  <td className="p-3 text-white/60">{p.processedAt ? new Date(p.processedAt.toDate()).toLocaleString() : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}