import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../store/AuthContext';
import { ArrowLeft, Bell, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrorHandler';

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'notifications'), where('userId', '==', user.uid), orderBy('sentAt', 'desc'), limit(30));
    const unsub = onSnapshot(q, (snap) => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'notifications'));
    return () => unsub();
  }, [user]);

  const markAsRead = async (id) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notifications/${id}`);
    }
  };

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach(n => {
      batch.update(doc(db, 'notifications', n.id), { read: true });
    });
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'notifications');
    }
  };

  const getIcon = (type) => {
    switch(type) {
      case 'payout': return '💰';
      case 'referral': return '👥';
      case 'spin': return '🎰';
      case 'badge': return '🏆';
      case 'withdrawal': return '🏦';
      case 'deposit': return '💳';
      default: return '🔔';
    }
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="min-h-screen px-4 pt-6 bg-[#0a0a1a]">
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-white/80 active:scale-95">
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-xl font-bold">Notifications</h1>
        <button onClick={markAllRead} className="p-2 -mr-2 text-[#f0a500] active:scale-95" title="Mark all read">
          <CheckCircle2 size={24} />
        </button>
      </div>

      <div className="space-y-3 pb-10">
        {notifications.length === 0 ? (
          <div className="text-center py-20">
            <Bell size={48} className="mx-auto text-white/20 mb-4" />
            <p className="text-white/50">You're all caught up!</p>
          </div>
        ) : (
          notifications.map(n => (
            <div 
              key={n.id} 
              onClick={() => !n.read && markAsRead(n.id)}
              className={`card p-4 flex gap-4 transition-colors ${!n.read ? 'border-l-4 border-l-[#f0a500] bg-white/10 cursor-pointer' : 'opacity-70'}`}
            >
              <div className="text-3xl">{getIcon(n.type)}</div>
              <div className="flex-1">
                <h3 className={`text-sm ${!n.read ? 'font-bold' : 'font-medium'}`}>{n.title}</h3>
                <p className="text-xs text-white/70 mt-1 leading-relaxed">{n.body}</p>
                <p className="text-[10px] text-white/40 mt-2">
                  {n.sentAt ? formatDistanceToNow(n.sentAt.toDate(), { addSuffix: true }) : 'Just now'}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}