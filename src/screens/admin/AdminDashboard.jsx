import React, { useState, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import useCountUp from '../../hooks/useCountUp';
import { Users, Cpu, CreditCard, Banknote } from 'lucide-react';

export default function AdminDashboard() {
  const [stats, setStats] = useState({ totalUsers: 0, activeMachines: 0, pendingWithdrawals: 0, totalPayoutsPaid: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      const functions = getFunctions();
      const getAdminDashboard = httpsCallable(functions, 'getAdminDashboard');
      try {
        const res = await getAdminDashboard();
        setStats(res.data);
      } catch (error) {
        console.error('Failed to load stats', error);
      }
      setLoading(false);
    };
    fetchStats();
  }, []);

  const usersAnim = useCountUp(stats.totalUsers);
  const machinesAnim = useCountUp(stats.activeMachines);
  const withdrawalsAnim = useCountUp(stats.pendingWithdrawals);
  const payoutsAnim = useCountUp(stats.totalPayoutsPaid);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard Overview</h1>
      
      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-6 border border-blue-500/20">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-blue-500/20 text-blue-500 flex items-center justify-center"><Users size={24} /></div>
              <p className="text-white/60 font-medium">Total Users</p>
            </div>
            <p className="text-3xl font-bold">{usersAnim.toLocaleString()}</p>
          </div>
          
          <div className="card p-6 border border-green-500/20">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center"><Cpu size={24} /></div>
              <p className="text-white/60 font-medium">Active Machines</p>
            </div>
            <p className="text-3xl font-bold">{machinesAnim.toLocaleString()}</p>
          </div>
          
          <div className="card p-6 border border-red-500/20">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center"><CreditCard size={24} /></div>
              <p className="text-white/60 font-medium">Pending Withdrawals</p>
            </div>
            <p className="text-3xl font-bold">{withdrawalsAnim.toLocaleString()}</p>
          </div>
          
          <div className="card p-6 border border-yellow-500/20">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-yellow-500/20 text-yellow-500 flex items-center justify-center"><Banknote size={24} /></div>
              <p className="text-white/60 font-medium">Total Payouts Paid</p>
            </div>
            <p className="text-3xl font-bold text-[#f0a500]">KES {payoutsAnim.toLocaleString()}</p>
          </div>
        </div>
      )}
    </div>
  );
}