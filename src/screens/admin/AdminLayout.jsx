import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { LayoutDashboard, Users, CreditCard, Banknote, Gift, Bell, Activity, LogOut, Menu, X } from 'lucide-react';
import { logout } from '../../services/auth';
import { useAuth } from '../../store/AuthContext';
import { handleFirestoreError, OperationType } from '../../utils/firestoreErrorHandler';

export default function AdminLayout() {
  const [pendingCount, setPendingCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const q = query(collection(db, 'withdrawals'), where('status', '==', 'pending'));
    const unsub = onSnapshot(q, (snap) => setPendingCount(snap.docs.length), (error) => handleFirestoreError(error, OperationType.GET, 'withdrawals'));
    return () => unsub();
  }, []);

  const handleLogout = async () => {
    await logout(user.uid);
    navigate('/admin/login');
  };

  const navItems = [
    { to: '/admin', icon: <LayoutDashboard size={20} />, label: 'Dashboard', end: true },
    { to: '/admin/users', icon: <Users size={20} />, label: 'Users' },
    { to: '/admin/withdrawals', icon: <CreditCard size={20} />, label: 'Withdrawals', badge: pendingCount },
    { to: '/admin/payouts', icon: <Banknote size={20} />, label: 'Payouts' },
    { to: '/admin/spin-prizes', icon: <Gift size={20} />, label: 'Spin Prizes' },
    { to: '/admin/notifications', icon: <Bell size={20} />, label: 'Notifications' },
    { to: '/admin/audit-log', icon: <Activity size={20} />, label: 'Audit Log' },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a1a] flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-white/10 bg-[#111225]">
        <div className="font-bold text-lg flex items-center gap-2">🛡️ Admin</div>
        <button onClick={() => setMenuOpen(!menuOpen)} className="p-2">
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar */}
      <div className={`${menuOpen ? 'block' : 'hidden'} md:block w-full md:w-64 bg-[#111225] border-r border-white/10 flex-shrink-0 flex flex-col h-screen sticky top-0 z-40`}>
        <div className="p-6 hidden md:block border-b border-white/10">
          <h1 className="text-xl font-bold flex items-center gap-2">🛡️ BitFarm Admin</h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `flex items-center justify-between p-3 rounded-lg transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-white/70 hover:bg-white/5'}`}
            >
              <div className="flex items-center gap-3">
                {item.icon}
                <span className="font-medium">{item.label}</span>
              </div>
              {item.badge > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">{item.badge}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10">
          <button onClick={handleLogout} className="flex items-center gap-3 p-3 w-full text-red-400 hover:bg-red-400/10 rounded-lg transition-colors">
            <LogOut size={20} />
            <span className="font-medium">Logout</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-x-hidden p-4 md:p-8">
        <Outlet />
      </div>
    </div>
  );
}