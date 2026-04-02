import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { handleFirestoreError, OperationType } from '../../utils/firestoreErrorHandler';

export default function AdminAuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const q = query(collection(db, 'auditLog'), orderBy('createdAt', 'desc'), limit(100));
        const snap = await getDocs(q);
        setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'auditLog');
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Audit Log</h1>

      <div className="card overflow-x-auto">
        {loading ? (
          <p className="text-center py-10 text-white/50">Loading logs...</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/60">
                <th className="p-3">Timestamp</th>
                <th className="p-3">Actor</th>
                <th className="p-3">Action</th>
                <th className="p-3">Target</th>
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="p-3 text-white/60 whitespace-nowrap">
                    {log.createdAt ? new Date(log.createdAt.toDate()).toLocaleString() : ''}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-[10px] uppercase font-bold mr-2 ${log.actorType === 'system' ? 'bg-purple-500/20 text-purple-400' : log.actorType === 'admin' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400'}`}>
                      {log.actorType}
                    </span>
                    <span className="font-mono text-xs">{log.actorId?.substring(0,8)}...</span>
                  </td>
                  <td className="p-3 font-medium text-blue-400">{log.action}</td>
                  <td className="p-3 font-mono text-xs text-white/60">{log.targetId || '-'}</td>
                  <td className="p-3 text-xs text-white/50 max-w-xs truncate">
                    {log.newValue ? JSON.stringify(log.newValue) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}