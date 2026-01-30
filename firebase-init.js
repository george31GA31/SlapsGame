// firebase-init.js

// --------------------------------------------------------------
// 1. PASTE YOUR CONFIG HERE
// Go to Firebase Console -> Project Settings -> General -> Scroll down to "Your Apps"
// Copy the "const firebaseConfig" block and replace the one below.
// --------------------------------------------------------------

const firebaseConfig = {
   apiKey: "AIzaSyACSbcWKo4HkkdYWyERnF8AVpnxNk3xCCA",
  authDomain: "isf-log-ins.firebaseapp.com",
  databaseURL: "https://isf-log-ins-default-rtdb.firebaseio.com",
  projectId: "isf-log-ins",
  storageBucket: "isf-log-ins.firebasestorage.app",
  messagingSenderId: "87043083116",
  appId: "1:87043083116:web:e03f873073626d978c0149",
  measurementId: "G-0DZY1R9RXF"
};

// --------------------------------------------------------------
// 2. INITIALIZATION CODE (DO NOT CHANGE THIS PART)
// --------------------------------------------------------------

if (typeof firebase !== 'undefined') {
    // Initialize the app
    firebase.initializeApp(firebaseConfig);
    console.log("✅ Firebase Connected Successfully!");

    // Make 'auth' and 'db' global variables so other pages can see them
    window.auth = firebase.auth();
    window.db = firebase.database();
    
} else {
    console.error("❌ CRITICAL: Firebase SDK not loaded. Check your HTML <head> tags.");
    alert("Firebase SDK is missing from the HTML file!");
}
