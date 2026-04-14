import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';

export default function Terms() {
  const navigate = useNavigate();

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen px-6 pt-12 pb-24 bg-[#0a0a1a] text-white">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-white/60 hover:text-white mb-8 transition-colors">
        <ArrowLeft size={20} />
        <span>Back</span>
      </button>
      
      <h1 className="text-3xl font-bold mb-6 text-[#f0a500]">Terms of Service</h1>
      
      <div className="space-y-6 text-white/80 leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold text-white mb-2">1. Acceptance of Terms</h2>
          <p>By accessing or using the BitFarm application, you agree to be bound by these Terms of Service and all applicable laws and regulations.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-2">2. User Accounts</h2>
          <p>You must provide accurate and complete information when creating an account. You are responsible for maintaining the security of your account and for all activities that occur under your account.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-2">3. Virtual Assets and Earnings</h2>
          <p>BitFarm provides simulated mining machines and virtual earnings. The conversion, withdrawal, and value of these virtual assets are subject to platform rules and may change at our discretion.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-2">4. Prohibited Conduct</h2>
          <p>You agree not to engage in any activity that interferes with or disrupts the services, including attempting to exploit bugs, use automated scripts, or create multiple accounts to abuse referral systems.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-2">5. Termination</h2>
          <p>We reserve the right to terminate or suspend your account immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms.</p>
        </section>
      </div>
    </motion.div>
  );
}
