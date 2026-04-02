import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../../services/firebase';
import toast from 'react-hot-toast';

export default function AdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    const functions = getFunctions();
    const signInAdmin = httpsCallable(functions, 'signInAdmin');
    
    try {
      const result = await signInAdmin({ username, password });
      await signInWithCustomToken(auth, result.data.token);
      toast.success('Admin logged in');
      navigate('/admin');
    } catch (error) {
      toast.error(error.message || 'Login failed');
    }
    setLoading(false);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex items-center justify-center bg-[#0a0a1a] px-4">
      <div className="card w-full max-w-md p-8 border border-blue-500/30">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🛡️</div>
          <h1 className="text-2xl font-bold">Admin Portal</h1>
          <p className="text-white/50 text-sm">BitFarm Operations</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm text-white/60 mb-1">Username</label>
            <input 
              type="text" 
              value={username} 
              onChange={e => setUsername(e.target.value)} 
              className="input-field bg-white/5" 
              required 
            />
          </div>
          <div>
            <label className="block text-sm text-white/60 mb-1">Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              className="input-field bg-white/5" 
              required 
            />
          </div>
          <button type="submit" disabled={loading} className="w-full py-3 rounded-lg font-bold bg-blue-600 text-white mt-4 active:scale-95 transition-transform">
            {loading ? 'Authenticating...' : 'Login'}
          </button>
        </form>
      </div>
    </motion.div>
  );
}