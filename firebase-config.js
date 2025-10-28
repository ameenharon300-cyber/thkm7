const admin = require('firebase-admin');

const firebaseConfig = {
  apiKey: "AIzaSyD9aLabUWNfgjqoIuZSYNm1X8kAtM-Eac8",
  authDomain: "andex-html.firebaseapp.com",
  databaseURL: "https://andex-html-default-rtdb.firebaseio.com",
  projectId: "andex-html",
  storageBucket: "andex-html.firebasestorage.app",
  messagingSenderId: "94749059385",
  appId: "1:94749059385:web:a0b449d411a93cd75520e8",
  measurementId: "G-QH61RWKH8K"
};

// Initialize Firebase
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: firebaseConfig.projectId,
        clientEmail: 'firebase-adminsdk@andex-html.iam.gserviceaccount.com',
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      }),
      databaseURL: firebaseConfig.databaseURL
    });
  }
  console.log('✅ Firebase initialized successfully');
} catch (error) {
  console.log('ℹ️ Firebase initialization skipped:', error.message);
}

const db = admin.firestore ? admin.firestore() : null;
const rtdb = admin.database ? admin.database() : null;

module.exports = {
  admin,
  db,
  rtdb,
  firebaseConfig
};