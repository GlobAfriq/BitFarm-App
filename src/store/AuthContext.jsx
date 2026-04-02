import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
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
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const tokenResult = await currentUser.getIdTokenResult();
        setIsAdmin(!!tokenResult.claims.admin);

        const profileUnsub = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
          setProfile(snap.exists() ? snap.data() : null);
        }, (error) => handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`));
        
        const walletUnsub = onSnapshot(doc(db, 'wallets', currentUser.uid), (snap) => {
          setWallet(snap.exists() ? snap.data() : null);
        }, (error) => handleFirestoreError(error, OperationType.GET, `wallets/${currentUser.uid}`));

        setLoading(false);
        return () => { profileUnsub(); walletUnsub(); };
      } else {
        setProfile(null); setWallet(null); setIsAdmin(false); setLoading(false);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, wallet, loading, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);