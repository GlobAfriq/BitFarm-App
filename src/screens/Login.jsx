import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { setupRecaptcha, clearRecaptcha, sendOTP } from '../services/auth';
import toast from 'react-hot-toast';

export default function Login() {
  const [phone, setPhone] = useState('+254');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setupRecaptcha('recaptcha-container');
    return () => {
      clearRecaptcha();
    };
  }, []);

  const handleSendCode = async () => {
    const cleanPhone = phone.replace(/\s+/g, '');
    if (cleanPhone.length < 12) {
      toast.error('Please enter a valid phone number');
      return;
    }
    setLoading(true);
    try {
      const confirmationResult = await sendOTP(cleanPhone);
      window.confirmationResult = confirmationResult;
      navigate('/verify', { state: { phone: cleanPhone } });
    } catch (error) {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col px-6 pt-20">
      <div className="text-4xl mb-6">📱</div>
      <h1 className="text-3xl font-bold mb-2">Welcome Back</h1>
      <p className="text-white/60 mb-10">Enter your phone number to continue</p>

      <div className="mb-6">
        <label className="block text-sm font-medium text-white/60 mb-2">Phone Number</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="input-field py-4 text-lg"
          placeholder="+254 700 000000"
        />
      </div>

      <button 
        onClick={handleSendCode} 
        disabled={loading} 
        className="btn-primary py-4 text-lg flex justify-center items-center"
      >
        {loading ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : 'Send Code'}
      </button>

      <p className="text-center text-xs text-white/40 mt-6">
        By continuing you agree to our Terms of Service
      </p>

      <div id="recaptcha-container"></div>
    </motion.div>
  );
}