const admin = require('firebase-admin');

// تهيئة Firebase الجديدة
const firebaseConfig = {
  apiKey: "AIzaSyD9aLabUWNfgjqoIuZSYNm1X8kAtM-Eac8",
  authDomain: "andex-html.firebaseapp.com",
  databaseURL: "https://andex-html-default-rtdb.firebaseio.com",
  projectId: "andex-html",
  storageBucket: "andex-html.firebasestorage.app",
  messagingSenderId: "94749059385",
  appId: "1:94749059385:web:332359f7c770aea05520e8",
  measurementId: "G-LN0D106XNC"
};

// Initialize Firebase
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: firebaseConfig.databaseURL,
      projectId: firebaseConfig.projectId
    });
    console.log('✅ Firebase initialized successfully with new configuration');
  }
} catch (error) {
  console.log('ℹ️ Firebase initialization skipped:', error.message);
}

// محاولة تهيئة Firebase Admin مع الخيارات المتاحة
let db = null;
let rtdb = null;

try {
  if (admin.firestore) {
    db = admin.firestore();
    console.log('✅ Firestore initialized');
  }
} catch (firestoreError) {
  console.log('❌ Firestore initialization failed:', firestoreError.message);
}

try {
  if (admin.database) {
    rtdb = admin.database();
    console.log('✅ Realtime Database initialized');
  }
} catch (rtdbError) {
  console.log('❌ Realtime Database initialization failed:', rtdbError.message);
}

// دالة مساعدة للتحقق من اتصال Firebase
async function checkFirebaseConnection() {
  try {
    if (db) {
      const testRef = db.collection('connection_test').doc('test');
      await testRef.set({
        timestamp: new Date(),
        status: 'connected'
      });
      console.log('✅ Firebase connection test successful');
      return true;
    }
    return false;
  } catch (error) {
    console.log('❌ Firebase connection test failed:', error.message);
    return false;
  }
}

// دالة لحفظ الجلسات العكسية في Firebase
async function saveReverseSession(sessionData) {
  try {
    if (db) {
      const sessionRef = db.collection('reverse_sessions').doc(sessionData.device_id);
      await sessionRef.set({
        ...sessionData,
        socket: null, // لا نحفظ كائن السوكيت
        last_updated: new Date()
      });
      return true;
    }
    return false;
  } catch (error) {
    console.log('❌ Error saving reverse session:', error.message);
    return false;
  }
}

// دالة لاسترجاع الجلسات النشطة
async function getActiveSessions() {
  try {
    if (db) {
      const snapshot = await db.collection('reverse_sessions')
        .where('connected', '==', true)
        .get();
      
      const sessions = [];
      snapshot.forEach(doc => {
        sessions.push(doc.data());
      });
      
      return sessions;
    }
    return [];
  } catch (error) {
    console.log('❌ Error getting active sessions:', error.message);
    return [];
  }
}

module.exports = {
  admin,
  db,
  rtdb,
  firebaseConfig,
  checkFirebaseConnection,
  saveReverseSession,
  getActiveSessions
};