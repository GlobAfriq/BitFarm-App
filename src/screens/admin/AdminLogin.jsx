import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { signInWithCustomToken, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '../../services/firebase';
import { useAuth } from '../../store/AuthContext';
import toast from 'react-hot-toast';

export default function AdminLogin() {
  console.log("AdminLogin rendering");
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const authContext = useAuth();
  const isAdmin = authContext?.isAdmin;

  useEffect(() => {
    if (isAdmin) {
      navigate('/admin');
    }
  }, [isAdmin, navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    const functions = getFunctions();
    const signInAdmin = httpsCallable(functions, 'signInAdmin');
    
    try {
      const result = await signInAdmin({ username, password });
      
      if (result.data.error) {
        throw new Error(`Backend Error: ${result.data.error}`);
      }

      await signInWithCustomToken(auth, result.data.token);
      toast.success('Admin logged in');
      navigate('/admin');
    } catch (error) {
      toast.error(error.message || 'Login failed');
    }
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      toast.success('Logged in with Google');
      // The useEffect will redirect if they are an admin
    } catch (error) {
      console.error("Google Login Error:", error);
      if (error.code === 'auth/unauthorized-domain') {
        const domain = window.location.hostname;
        toast.error(
          `Domain not authorized! Please add EXACTLY this to Firebase: ${domain}`,
          { duration: 8000 }
        );
        // Fallback to redirect which sometimes works better
        setTimeout(() => {
          toast('Trying redirect method...', { icon: '🔄' });
          import('firebase/auth').then(({ signInWithRedirect }) => {
            signInWithRedirect(auth, provider).catch(console.error);
          });
        }, 3000);
      } else {
        toast.error(error.message || 'Google login failed');
      }
    }
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

        <div className="mt-6 pt-6 border-t border-white/10">
          <button 
            onClick={handleGoogleLogin} 
            className="w-full py-3 rounded-lg font-bold bg-white text-black active:scale-95 transition-transform flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>
    </motion.div>
  );
}