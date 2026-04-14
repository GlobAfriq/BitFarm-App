import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';

export default function Privacy() {
  const navigate = useNavigate();

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen px-6 pt-12 pb-24 bg-[#0a0a1a] text-white">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-white/60 hover:text-white mb-8 transition-colors">
        <ArrowLeft size={20} />
        <span>Back</span>
      </button>
      
      <h1 className="text-3xl font-bold mb-6 text-[#f0a500]">Privacy Policy</h1>
      
      <div className="space-y-6 text-white/80 leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold text-white mb-2">1. Information We Collect</h2>
          <p>We collect information you provide directly to us, such as your phone number, full name, and country when you create an account. We also collect data regarding your interactions with the BitFarm platform, including machine purchases, spins, and wallet transactions.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-2">2. How We Use Your Information</h2>
          <p>We use the information we collect to provide, maintain, and improve our services, to process your transactions, and to communicate with you regarding your account and platform updates.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-2">3. Information Sharing</h2>
          <p>We do not share your personal information with third parties except as necessary to provide our services, comply with the law, or protect our rights.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-2">4. Security</h2>
          <p>We take reasonable measures to help protect information about you from loss, theft, misuse, unauthorized access, disclosure, alteration, and destruction.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-2">5. Contact Us</h2>
          <p>If you have any questions about this Privacy Policy, please contact our support team.</p>
        </section>
      </div>
    </motion.div>
  );
}
