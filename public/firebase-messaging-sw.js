importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js');

const app = firebase.initializeApp({
  projectId: "gen-lang-client-0907348027",
  appId: "1:930093175883:web:5a80c17ba0360a3668e9ce",
  apiKey: "AIzaSyB5Ede3Mx39U91m16jpXwO8DPydSKOW0M0",
  authDomain: "gen-lang-client-0907348027.firebaseapp.com",
  storageBucket: "gen-lang-client-0907348027.firebasestorage.app",
  messagingSenderId: "930093175883"
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: '/icon.png',
    badge: '/badge.png'
  });
});