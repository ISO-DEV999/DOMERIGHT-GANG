import { getApp, getApps, initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyATPFGMwDMFYtV-IS5NLNH_J6FywjmIxJg",
  authDomain: "domeright-gang.firebaseapp.com",
  projectId: "domeright-gang",
  storageBucket: "domeright-gang.firebasestorage.app",
  messagingSenderId: "127748824495",
  appId: "1:127748824495:web:6d77d7b730653d3312635a",
  measurementId: "G-K3LGD72C5X",
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
// Reuse Firebase's default instance so Next.js Fast Refresh cannot initialize Firestore twice.
export const db = getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);
export const storage = getStorage(firebaseApp);
export const analytics = typeof window !== "undefined" ? getAnalytics(firebaseApp) : null;
