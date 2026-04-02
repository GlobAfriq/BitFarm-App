import React, { useState, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    setLoading(true);
    const functions = getFunctions();
    const getAllUsers = httpsCallable(functions, 'getAllUsers');
    try {
      const res = await getAllUsers();
      setUsers(res.data.users);
    } catch (error) {
      toast.error('Failed to load users');
    }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleSuspend = async (uid, suspend) => {
    const functions = getFunctions();
    const suspendUser = httpsCallable(functions, 'suspendUser');
    try {
      await suspendUser({ uid, suspend });
      toast.success(`User ${suspend ? 'suspended' : 'unsuspended'}`);
      fetchUsers();
    } catch (error) {
      toast.error('Failed to update user');
    }
  };

  const filtered = users.filter(u => 
    u.fullName?.toLowerCase().includes(search.toLowerCase()) || 
    u.phoneNumber?.includes(search) ||
    u.referralCode?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">User Management</h1>
        <input 
          type="text" 
          placeholder="Search name, phone, code..." 
          value={search} 
          onChange={e => setSearch(e.target.value)}
          className="input-field max-w-xs bg-white/5"
        />
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <p className="text-center py-10 text-white/50">Loading users...</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/60">
                <th className="p-3">Name</th>
                <th className="p-3">Phone</th>
                <th className="p-3">Ref Code</th>
                <th className="p-3">Balance (KES)</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.uid} className="border-b border-white/5 hover:bg-white/5">
                  <td className="p-3 font-medium">{u.fullName}</td>
                  <td className="p-3">{u.phoneNumber}</td>
                  <td className="p-3 font-mono">{u.referralCode}</td>
                  <td className="p-3 text-[#f0a500] font-bold">{u.balanceKes?.toLocaleString()}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs ${u.isActive ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                      {u.isActive ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <button 
                      onClick={() => handleSuspend(u.uid, u.isActive)}
                      className={`px-3 py-1 rounded text-xs font-bold ${u.isActive ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}
                    >
                      {u.isActive ? 'Suspend' : 'Unsuspend'}
                    </button>
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