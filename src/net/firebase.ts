// Firebase, lazily. Without a project id there is nothing to talk to and the
// game still runs: memories live in this browser only.

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseReady = Boolean(config.projectId && config.apiKey);

let app: FirebaseApp | null = null;
let cachedDb: Firestore | null = null;
let cachedAuth: Auth | null = null;
let cachedStorage: FirebaseStorage | null = null;

const ensureApp = () => {
  if (!firebaseReady) return null;
  if (!app) app = getApps().length ? getApp() : initializeApp(config);
  return app;
};

export const db = () => {
  const instance = ensureApp();
  if (!instance) return null;
  return (cachedDb ??= getFirestore(instance));
};

export const auth = () => {
  const instance = ensureApp();
  if (!instance) return null;
  return (cachedAuth ??= getAuth(instance));
};

export const storage = () => {
  const instance = ensureApp();
  if (!instance) return null;
  return (cachedStorage ??= getStorage(instance));
};

/**
 * Everyone plays signed in, anonymously. No sign-up wall, but a stable id, so
 * a memory can be deleted by whoever left it and nobody else.
 */
let signingIn: Promise<string | null> | null = null;

export const currentUid = async (): Promise<string | null> => {
  const instance = auth();
  if (!instance) return null;
  if (instance.currentUser) return instance.currentUser.uid;
  if (!signingIn) {
    signingIn = new Promise<string | null>((resolve) => {
      const stop = onAuthStateChanged(instance, (user) => {
        if (user) { stop(); resolve(user.uid); }
      });
      signInAnonymously(instance).catch(() => { stop(); resolve(null); });
    }).catch(() => null);
  }
  return signingIn;
};
