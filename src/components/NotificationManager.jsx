import { useEffect, useRef } from 'react';
import { setupForegroundNotifications } from '../services/notifications';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../store/AuthContext';
import toast from 'react-hot-toast';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrorHandler';

export default function NotificationManager() {
  const { user } = useAuth();
  const initialLoad = useRef(true);

  useEffect(() => {
    const unsubscribe = setupForegroundNotifications();
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    const unsub = onSnapshot(q, (snap) => {
      if (initialLoad.current) {
        initialLoad.current = false;
        return;
      }

      snap.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const tx = change.doc.data();
          const amount = tx.amountKes?.toLocaleString() || 0;
          
          if (tx.direction === 'credit') {
            toast(`Wallet credited with KES ${amount}`, {
              icon: '💰',
              style: { background: '#111225', color: '#4caf50', border: '1px solid #4caf50' },
              duration: 5000
            });
            
            // Also try to show a native browser notification if permitted
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              new Notification('Wallet Credited', {
                body: `Your wallet has been credited with KES ${amount}.`,
                icon: '/icon.png'
              });
            }
          } else if (tx.direction === 'debit') {
            toast(`Wallet debited by KES ${amount}`, {
              icon: '💸',
              style: { background: '#111225', color: '#f44336', border: '1px solid #f44336' },
              duration: 5000
            });
            
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              new Notification('Wallet Debited', {
                body: `Your wallet has been debited by KES ${amount}.`,
                icon: '/icon.png'
              });
            }
          }
        }
      });
    }, (error) => handleFirestoreError(error, OperationType.GET, 'transactions'));

    return () => unsub();
  }, [user]);

  return null;
}