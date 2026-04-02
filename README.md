# BitFarm

A complete crypto-themed virtual mining rewards platform for young people.

## Setup

1. Create a Firebase project at console.firebase.google.com
2. Enable: Authentication (Phone provider), Firestore, Cloud Functions (Blaze plan),
   Realtime Database, Cloud Messaging
3. Copy SDK config into `firebase-applet-config.json`
4. Copy VAPID key from Firebase Console → Project Settings → Cloud Messaging → Web Push
   into `.env` as `VITE_FIREBASE_VAPID_KEY`
5. Fill in `functions/.env` with M-Pesa, NOWPayments, and Africa's Talking credentials

## Creating the first admin account

Install Firebase CLI: `npm install -g firebase-tools`
Run: `firebase login`

Generate a bcrypt hash for your admin password:
`node -e "const b=require('bcrypt'); b.hash('YourPassword123!',10).then(h=>console.log(h));"`

Add the admin to Firestore (replace PROJECT_ID and HASH):
```bash
firebase firestore:set --project PROJECT_ID /admins/admin1 \
  '{"username":"admin","passwordHash":"PASTE_BCRYPT_HASH","role":"admin"}'
```

## Seeding initial data

After deploying, call the `seedInitialData` Cloud Function from the admin panel
or via the Firebase Console → Functions → seedInitialData → Test function.

## Deployment

```bash
npm run build                   # build React app to /dist
firebase deploy                 # deploy all: hosting + functions + rules
firebase deploy --only hosting  # frontend only
firebase deploy --only functions # backend only
```

## Testing M-Pesa locally

Use sandbox credentials from developer.safaricom.co.ke.
Test phone: 254708374149 (Safaricom sandbox test number).
Use ngrok to expose your local functions for callback:
```bash
firebase emulators:start --only functions
ngrok http 5001
```
Update `MPESA_CALLBACK_URL` in `functions/.env` to the ngrok URL.