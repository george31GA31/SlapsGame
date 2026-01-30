// firebase-init.js

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyACSbcWKo4HkkdYWyERnF8AVpnxNk3xCCA",
  authDomain: "isf-log-ins.firebaseapp.com",
  projectId: "isf-log-ins",
  storageBucket: "isf-log-ins.firebasestorage.app",
  messagingSenderId: "87043083116",
  appId: "1:87043083116:web:e03f873073626d978c0149",
  measurementId: "G-0DZY1R9RXF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const firebaseConfig = {
    // Paste your keys here!
    apiKey: "AIzaSy...",
    authDomain: "isf-online.firebaseapp.com",
    projectId: "isf-online",
    // ... etc
};

// --- 2. INITIALIZE FIREBASE ---
// This starts the connection when the page loads
if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    console.log("Firebase Connected!");
    
    // We export these variables so other pages can use them
    var auth = firebase.auth();
    var db = firebase.database();
} else {
    console.error("Firebase SDK not loaded!");
}
