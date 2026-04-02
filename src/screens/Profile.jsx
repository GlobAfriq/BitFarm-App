import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../store/AuthContext';
import { logout } from '../services/auth';
import { requestNotificationPermission } from '../services/notifications';
import BottomNav from '../components/BottomNav';
import { ChevronRight, Shield, Info, LogOut, Settings, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrorHandler';

export default function Profile() {
  const { user, profile, wallet, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [allBadges, setAllBadges] = useState([]);
  const [modal, setModal] = useState(null); // 'privacy' or 'about'

  useEffect(() => {
    const fetchBadges = async () => {
      try {
        const snap = await getDocs(collection(db, 'badges'));
        setAllBadges(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'badges');
      }
    };
    fetchBadges();
  }, []);

  const getInitials = (name) => name ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '??';

  const handleLogout = async () => {
    await logout(user.uid);
    navigate('/');
  };

  const toggleNotifications = async () => {
    try {
      const token = await requestNotificationPermission(user.uid);
      if (token) toast.success('Notifications enabled!');
      else toast.error('Permission denied. Try opening the app in a new tab.');
    } catch (e) {
      console.error(e);
      if (e.message.includes('Permission denied') || e.message.includes('not supported') || e.message.includes('Messaging not initialized') || e.message.includes('top-level')) {
        toast.error(`Notifications blocked. Please open the app in a new tab (top right icon) to enable them.`);
      } else {
        toast.error(`Error: ${e.message}. Try opening in a new tab.`);
      }
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pb-24 min-h-screen px-4 pt-8">
      
      <div className="flex flex-col items-center mb-8">
        <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-[#f0a500] to-[#ff6b35] flex items-center justify-center text-3xl font-bold shadow-[0_0_30px_rgba(240,165,0,0.3)] mb-4">
          {getInitials(profile?.fullName)}
        </div>
        <h1 className="text-2xl font-bold">{profile?.fullName}</h1>
        <p className="text-white/50 text-sm">{profile?.phoneNumber}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-8">
        <div className="card p-4 text-center">
          <p className="text-white/50 text-xs mb-1">Total Earned</p>
          <p className="font-bold text-[#4caf50]">KES {wallet?.totalEarned?.toLocaleString() || 0}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-white/50 text-xs mb-1">Total Deposited</p>
          <p className="font-bold">KES {wallet?.totalDeposited?.toLocaleString() || 0}</p>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="font-bold mb-4">Achievements</h3>
        <div className="grid grid-cols-4 gap-3">
          {allBadges.map(b => {
            const earned = profile?.badgeKeys?.includes(b.id);
            return (
              <div key={b.id} className="flex flex-col items-center text-center group relative">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl mb-1 transition-all ${earned ? 'bg-white/10 shadow-lg' : 'bg-white/5 opacity-30 grayscale'}`} style={{ boxShadow: earned ? `0 0 15px ${b.color}40` : 'none' }}>
                  {b.emoji}
                </div>
                <span className={`text-[9px] leading-tight ${earned ? 'text-white' : 'text-white/40'}`}>{b.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-2 mb-8">
        <h3 className="font-bold mb-2 text-sm text-white/60 uppercase tracking-wider">Settings</h3>
        
        <button onClick={toggleNotifications} className="w-full card p-4 flex items-center justify-between active:scale-95 transition-transform">
          <div className="flex items-center gap-3">
            <div className="text-[#f0a500]"><Settings size={20} /></div>
            <span className="font-medium text-sm">Enable Notifications</span>
          </div>
          <ChevronRight size={18} className="text-white/40" />
        </button>
        
        <button onClick={() => setModal('privacy')} className="w-full card p-4 flex items-center justify-between active:scale-95 transition-transform">
          <div className="flex items-center gap-3">
            <div className="text-[#f0a500]"><Shield size={20} /></div>
            <span className="font-medium text-sm">Privacy & Security</span>
          </div>
          <ChevronRight size={18} className="text-white/40" />
        </button>

        <button onClick={() => setModal('about')} className="w-full card p-4 flex items-center justify-between active:scale-95 transition-transform">
          <div className="flex items-center gap-3">
            <div className="text-[#f0a500]"><Info size={20} /></div>
            <span className="font-medium text-sm">About BitFarm</span>
          </div>
          <ChevronRight size={18} className="text-white/40" />
        </button>
      </div>

      {isAdmin && (
        <button onClick={() => navigate('/admin')} className="w-full py-4 rounded-xl font-bold bg-blue-600 text-white mb-4 active:scale-95 transition-transform">
          Admin Panel
        </button>
      )}

      <button onClick={handleLogout} className="w-full py-4 rounded-xl font-bold bg-white/5 text-[#f44336] flex items-center justify-center gap-2 active:scale-95 transition-transform">
        <LogOut size={20} /> Logout
      </button>

      <AnimatePresence>
        {modal && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center"
            onClick={() => setModal(null)}
          >
            <motion.div 
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-[#111225] w-full max-w-[420px] rounded-t-2xl p-6 max-h-[80vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">{modal === 'privacy' ? 'Privacy & Security' : 'About BitFarm'}</h2>
                <button onClick={() => setModal(null)} className="p-2 bg-white/5 rounded-full"><X size={20} /></button>
              </div>
              
              {modal === 'privacy' ? (
                <div className="space-y-4 text-sm text-white/80 leading-relaxed">
                  <p>At BitFarm, your privacy and security are our highest priorities. We are committed to protecting your personal data and ensuring a secure environment for your digital assets.</p>
                  <p><strong>Data Protection:</strong> We employ industry-standard encryption protocols to safeguard your personal information and transaction history. Your data is never sold to third parties.</p>
                  <p><strong>Financial Security:</strong> All Mpesa transactions are processed through secure, encrypted channels. We maintain strict access controls and continuous monitoring to prevent unauthorized access to your wallet.</p>
                  <p><strong>Account Safety:</strong> We recommend keeping your login credentials confidential. BitFarm will never ask for your password or OTP via email or phone call.</p>
                </div>
              ) : (
                <div className="space-y-4 text-sm text-white/80 leading-relaxed">
                  <p><strong>BitFarm Global Ltd.</strong></p>
                  <p>Headquartered in London, United Kingdom, BitFarm is a premier global enterprise engaged in institutional-grade cryptocurrency mining operations.</p>
                  <p>Founded by a consortium of blockchain infrastructure experts and financial technologists, BitFarm democratizes access to high-yield crypto mining. By leveraging state-of-the-art ASIC hardware and sustainable energy partnerships across multiple continents, we provide our clients with consistent, reliable returns in a volatile market.</p>
                  <p>Our mission is to bridge the gap between complex blockchain infrastructure and everyday investors, offering a seamless, secure, and highly profitable mining experience through our proprietary cloud-based platform.</p>
                  <p className="text-xs text-white/50 mt-6 pt-4 border-t border-white/10">© {new Date().getFullYear()} BitFarm Global Ltd. All rights reserved.</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNav />
    </motion.div>
  );
}