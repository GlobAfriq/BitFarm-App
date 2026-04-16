import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './store/AuthContext';
import NotificationManager from './components/NotificationManager';

// Screens
import Splash from './screens/Splash';
import Login from './screens/Login';
import Verify from './screens/Verify';
import CreateProfile from './screens/CreateProfile';
import Dashboard from './screens/Dashboard';
import Machines from './screens/Machines';
import Referrals from './screens/Referrals';
import Spin from './screens/Spin';
import Wallet from './screens/Wallet';
import Profile from './screens/Profile';
import Notifications from './screens/Notifications';

import Privacy from './screens/Privacy';
import Terms from './screens/Terms';

// Admin Screens
import AdminLogin from './screens/admin/AdminLogin';
import AdminLayout from './screens/admin/AdminLayout';
import AdminDashboard from './screens/admin/AdminDashboard';
import AdminUsers from './screens/admin/AdminUsers';
import AdminWithdrawals from './screens/admin/AdminWithdrawals';
import AdminPayouts from './screens/admin/AdminPayouts';
import AdminSpinPrizes from './screens/admin/AdminSpinPrizes';
import AdminNotifications from './screens/admin/AdminNotifications';
import AdminAuditLog from './screens/admin/AdminAuditLog';

import AdminDepositQueue from './screens/admin/AdminDepositQueue';

const ProtectedRoute = ({ children }) => {
  const authContext = useAuth();
  const user = authContext?.user;
  const profile = authContext?.profile;
  const loading = authContext?.loading;

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#0a0a1a]"><div className="animate-spin text-[#f0a500] text-4xl">⛏️</div></div>;
  if (!user) return <Navigate to="/" replace />;
  if (!profile) return <Navigate to="/create-profile" replace />;
  return children;
};

const AdminRoute = ({ children }) => {
  const authContext = useAuth();
  const user = authContext?.user;
  const isAdmin = authContext?.isAdmin;
  const loading = authContext?.loading;

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#0a0a1a]"><div className="animate-spin text-[#f0a500] text-4xl">⛏️</div></div>;
  if (!user || !isAdmin) return <Navigate to="/admin/login" replace />;
  return children;
};

const AppContent = () => {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin');

  return (
    <div className={isAdminRoute ? "min-h-screen bg-[#0a0a1a]" : "app-container"}>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<Splash />} />
        <Route path="/login" element={<Login />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/create-profile" element={<CreateProfile />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        
        {/* Protected Routes */}
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/machines" element={<ProtectedRoute><Machines /></ProtectedRoute>} />
        <Route path="/referrals" element={<ProtectedRoute><Referrals /></ProtectedRoute>} />
        <Route path="/spin" element={<ProtectedRoute><Spin /></ProtectedRoute>} />
        <Route path="/wallet" element={<ProtectedRoute><Wallet /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />

        {/* Admin Routes */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="deposits" element={<AdminDepositQueue />} />
          <Route path="withdrawals" element={<AdminWithdrawals />} />
          <Route path="payouts" element={<AdminPayouts />} />
          <Route path="spin-prizes" element={<AdminSpinPrizes />} />
          <Route path="notifications" element={<AdminNotifications />} />
          <Route path="audit-log" element={<AdminAuditLog />} />
        </Route>
      </Routes>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <NotificationManager />
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
      <Toaster 
        position="top-center" 
        toastOptions={{
          style: { background: '#111225', color: '#fff', border: '1px solid #f0a500' }
        }} 
      />
    </AuthProvider>
  );
}