import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { verifyOTP, sendOTP, setupRecaptcha, clearRecaptcha } from '../services/auth';
import { auth } from '../services/firebase';
import { signOut } from 'firebase/auth';
import toast from 'react-hot-toast';

export default function Verify() {
  const location = useLocation();
  const navigate = useNavigate();
  const { phone, mode, fullName, country } = location.state || {};
  const confirmationResult = window.confirmationResult;
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [shake, setShake] = useState(false);
  const inputRefs = useRef([]);

  useEffect(() => {
    if (!confirmationResult) navigate('/login');
    setupRecaptcha('recaptcha-container-verify');
    
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    
    return () => {
      clearInterval(timer);
      clearRecaptcha();
    };
  }, [confirmationResult, navigate]);

  const handleChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;
    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    if (value && index < 5) {
      inputRefs.current[index + 1].focus();
    }
    if (value && index === 5) {
      handleVerify(newCode.join(''));
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1].focus();
    }
  };

  const handleVerify = async (otpString) => {
    if (otpString.length !== 6) return;
    setLoading(true);
    try {
      const { user, isNewUser } = await verifyOTP(confirmationResult, otpString);
      
      if (mode === 'signup' && !isNewUser) {
        // User is trying to sign up but already exists
        signOut(auth).catch(console.error);
        toast.error('Account already exists. Please log in instead.');
        navigate('/login', { state: { mode: 'login' } });
        return;
      }
      
      if (mode === 'login' && isNewUser) {
        // User is trying to log in but doesn't exist
        signOut(auth).catch(console.error);
        toast.error('Account not found. Please sign up first.');
        navigate('/login', { state: { mode: 'signup' } });
        return;
      }

      if (isNewUser) {
        navigate('/create-profile', { state: { uid: user.uid, phone, fullName, country } });
      } else {
        navigate('/dashboard');
      }
    } catch (error) {
      setLoading(false);
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0].focus();
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setLoading(true);
    try {
      const newResult = await sendOTP(phone);
      window.confirmationResult = newResult;
      setCountdown(60);
      toast.success('Code resent');
    } catch (error) {
      clearRecaptcha();
      setupRecaptcha('recaptcha-container-verify');
    }
    setLoading(false);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col px-6 pt-20">
      <div className="text-4xl mb-6">🔐</div>
      <h1 className="text-3xl font-bold mb-2">Verify Phone</h1>
      <p className="text-white/60 mb-10">Code sent to {phone}</p>

      <motion.div 
        animate={shake ? { x: [0, -10, 10, -10, 0] } : {}} 
        transition={{ duration: 0.4 }}
        className="flex justify-between gap-2 mb-8"
      >
        {code.map((digit, index) => (
          <input
            key={index}
            ref={(el) => (inputRefs.current[index] = el)}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            className="w-12 h-14 text-center text-2xl font-bold bg-white/5 border border-white/10 rounded-lg focus:border-[#f0a500] outline-none"
            disabled={loading}
          />
        ))}
      </motion.div>

      <button 
        onClick={() => handleVerify(code.join(''))} 
        disabled={loading || code.join('').length !== 6} 
        className="btn-primary py-4 text-lg flex justify-center items-center mb-6"
      >
        {loading ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : 'Verify'}
      </button>

      <div className="text-center">
        {countdown > 0 ? (
          <p className="text-white/40">Resend code in {countdown}s</p>
        ) : (
          <button onClick={handleResend} className="text-[#f0a500] font-medium" disabled={loading}>
            Resend Code
          </button>
        )}
      </div>
      <div id="recaptcha-container-verify"></div>
    </motion.div>
  );
}