import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrorHandler';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let profileUnsub = null;
    let walletUnsub = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      // Clean up previous listeners if they exist
      if (profileUnsub) profileUnsub();
      if (walletUnsub) walletUnsub();
      
      if (currentUser) {
        try {
          const tokenResult = await currentUser.getIdTokenResult();
          setIsAdmin(!!tokenResult.claims.admin || currentUser.email === 'globafriqgroup@gmail.com');
        } catch (e) {
          console.error("Error getting token result", e);
        }

        profileUnsub = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
          setProfile(snap.exists() ? snap.data() : null);
        }, (error) => handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`));
        
        walletUnsub = onSnapshot(doc(db, 'wallets', currentUser.uid), (snap) => {
          setWallet(snap.exists() ? snap.data() : null);
        }, (error) => handleFirestoreError(error, OperationType.GET, `wallets/${currentUser.uid}`));

        setLoading(false);
      } else {
        setProfile(null); 
        setWallet(null); 
        setIsAdmin(false); 
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (profileUnsub) profileUnsub();
      if (walletUnsub) walletUnsub();
    };
  }, []);

  useEffect(() => {
    let timeoutId;
    const INACTIVITY_LIMIT = 5 * 60 * 1000; // 5 minutes

    const handleActivity = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (user) {
        timeoutId = setTimeout(() => {
          signOut(auth).catch(console.error);
        }, INACTIVITY_LIMIT);
      }
    };

    handleActivity();

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    events.forEach(event => window.addEventListener(event, handleActivity));

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      events.forEach(event => window.removeEventListener(event, handleActivity));
    };
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, profile, wallet, loading, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);