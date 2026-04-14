import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { setupRecaptcha, clearRecaptcha, sendOTP } from '../services/auth';
import toast from 'react-hot-toast';

export default function Login() {
  const [phone, setPhone] = useState('+254');
  const [fullName, setFullName] = useState('');
  const [country, setCountry] = useState('Kenya');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const mode = location.state?.mode || 'login'; // 'signup' or 'login'

  useEffect(() => {
    setupRecaptcha('recaptcha-container');
    return () => {
      clearRecaptcha();
    };
  }, []);

  const handleSendCode = async () => {
    if (mode === 'signup') {
      if (fullName.trim().length < 3) {
        toast.error('Please enter your full name');
        return;
      }
      if (!country.trim()) {
        toast.error('Please enter your country');
        return;
      }
    }

    const cleanPhone = phone.replace(/\s+/g, '');
    if (cleanPhone.length < 12) {
      toast.error('Please enter a valid phone number');
      return;
    }
    setLoading(true);
    try {
      const confirmationResult = await sendOTP(cleanPhone);
      window.confirmationResult = confirmationResult;
      navigate('/verify', { state: { phone: cleanPhone, mode, fullName, country } });
    } catch (error) {
      setLoading(false);
      clearRecaptcha();
      setupRecaptcha('recaptcha-container');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col px-6 pt-20">
      <div className="text-4xl mb-6">📱</div>
      <h1 className="text-3xl font-bold mb-2">
        {mode === 'signup' ? 'Create Account' : 'Welcome Back'}
      </h1>
      <p className="text-white/60 mb-10">
        {mode === 'signup' ? 'Enter your details to create an account' : 'Enter your phone number to continue'}
      </p>

      {mode === 'signup' && (
        <>
          <div className="mb-4">
            <label className="block text-sm font-medium text-white/60 mb-2">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input-field py-4 text-lg"
              placeholder="John Doe"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-white/60 mb-2">Country</label>
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="input-field py-4 text-lg"
              placeholder="Kenya"
            />
          </div>
        </>
      )}

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

      {mode === 'signup' ? (
        <p className="text-center text-sm text-white/60 mt-6">
          Already registered? <span className="text-[#f0a500] font-bold cursor-pointer" onClick={() => navigate('/login', { state: { mode: 'login' }, replace: true })}>Log in</span>
        </p>
      ) : (
        <p className="text-center text-sm text-white/60 mt-6">
          Don't have an account? <span className="text-[#f0a500] font-bold cursor-pointer" onClick={() => navigate('/login', { state: { mode: 'signup' }, replace: true })}>Sign up</span>
        </p>
      )}

      <p className="text-center text-xs text-white/40 mt-6">
        By continuing you agree to our <span className="text-[#f0a500] cursor-pointer hover:underline" onClick={() => navigate('/terms')}>Terms of Service</span> and <span className="text-[#f0a500] cursor-pointer hover:underline" onClick={() => navigate('/privacy')}>Privacy Policy</span>
      </p>

      <div id="recaptcha-container"></div>
    </motion.div>
  );
}