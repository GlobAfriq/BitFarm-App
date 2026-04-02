import { getToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc } from 'firebase/firestore';
import { messaging, db } from './firebase';
import toast from 'react-hot-toast';

export const requestNotificationPermission = async (uid) => {
  try {
    if (!messaging) throw new Error('Messaging not initialized');
    if (typeof Notification === 'undefined') throw new Error('Notifications not supported');
    
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error(`Permission ${permission}`);

    const options = import.meta.env.VITE_FIREBASE_VAPID_KEY 
      ? { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY } 
      : {};
    const token = await getToken(messaging, options);

    if (token && uid) {
      await updateDoc(doc(db, 'users', uid), { fcmToken: token, updatedAt: new Date() });
    }
    return token;
  } catch (error) {
    console.warn('FCM permission error:', error);
    throw error;
  }
};

export const setupForegroundNotifications = () => {
  if (!messaging) return;
  return onMessage(messaging, (payload) => {
    toast(payload.notification?.body || 'New notification', {
      icon: '🔔',
      style: {
        background: '#111225', color: '#fff',
        border: '1px solid #f0a500'
      },
      duration: 5000
    });
  });
};