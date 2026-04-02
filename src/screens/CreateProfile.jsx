import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import confetti from 'canvas-confetti';
import { createUserProfile } from '../services/auth';
import { requestNotificationPermission } from '../services/notifications';
import toast from 'react-hot-toast';

export default function CreateProfile() {
  const location = useLocation();
  const navigate = useNavigate();
  const { uid, phone } = location.state || {};
  const [fullName, setFullName] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);

  if (!uid) {
    navigate('/login');
    return null;
  }

  const handleCreate = async () => {
    if (fullName.trim().length < 3) {
      toast.error('Please enter your full name');
      return;
    }
    setLoading(true);
    try {
      await createUserProfile(uid, phone, fullName, referralCode);
      
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#f0a500', '#ff6b35', '#ffffff', '#4caf50']
      });

      setTimeout(async () => {
        try {
          await requestNotificationPermission(uid);
        } catch (e) {
          console.warn('Notification permission skipped during onboarding:', e);
        }
        navigate('/dashboard');
      }, 2000);
      
    } catch (error) {
      setLoading(false);
      toast.error('Failed to create profile');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col px-6 pt-20">
      <div className="text-4xl mb-6">👤</div>
      <h1 className="text-3xl font-bold mb-2">Complete Profile</h1>
      <p className="text-white/60 mb-10">Set up your BitFarm account</p>

      <div className="space-y-6 mb-8">
        <div>
          <label className="block text-sm font-medium text-white/60 mb-2">Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="input-field py-4 text-lg"
            placeholder="John Doe"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-white/60 mb-2">Referral Code (Optional)</label>
          <input
            type="text"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value)}
            className="input-field py-4 text-lg uppercase"
            placeholder="JOH123"
          />
        </div>
      </div>

      <button 
        onClick={handleCreate} 
        disabled={loading} 
        className="btn-primary py-4 text-lg flex justify-center items-center"
      >
        {loading ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : 'Create Account'}
      </button>
    </motion.div>
  );
}