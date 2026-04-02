import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../store/AuthContext';

export default function Splash() {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();
  const [showButtons, setShowButtons] = useState(false);
  const [typedText, setTypedText] = useState('');
  const fullText = "Mine. Earn. Win.";
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!loading && user && profile) {
      navigate('/dashboard');
    }
  }, [user, profile, loading, navigate]);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      setTypedText(fullText.substring(0, i + 1));
      i++;
      if (i >= fullText.length) {
        clearInterval(interval);
        setTimeout(() => setShowButtons(true), 500);
      }
    }, 80);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = Array.from({ length: 80 }).map(() => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: Math.random() * 2 + 1,
      color: Math.random() > 0.5 ? '#f0a500' : '#ffffff',
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5
    }));

    let animationFrameId;
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      });
      animationFrameId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 z-0 opacity-50 pointer-events-none" />
      
      <div className="z-10 flex flex-col items-center text-center px-6 w-full">
        <div className="text-6xl mb-4">⛏️</div>
        <h1 className="text-5xl font-bold text-[#f0a500] mb-2 tracking-tight">BitFarm</h1>
        <p className="text-xl text-white/80 h-8 font-medium">{typedText}<span className="animate-pulse">|</span></p>

        <AnimatePresence>
          {showButtons && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }} 
              animate={{ opacity: 1, y: 0 }} 
              className="mt-16 w-full flex flex-col gap-4"
            >
              <button onClick={() => navigate('/login')} className="btn-primary py-4 text-lg">Get Started</button>
              <button onClick={() => navigate('/login')} className="btn-outline py-4 text-lg">Log In</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}