// core/firebaseConfig.ts
// Firebase app init - the ONE piece of Firebase setup that's genuinely
// identical on native and web (sync-plan.md §3: "since it's pure JS, the
// exact same sync engine code runs on both native and web"). Auth itself
// still needs a platform split (see firebaseAuth.native.ts / .web.ts)
// because persistence works differently, but initializeApp() doesn't care
// what platform it's running on.
//
// Config lives in app.config.js's `extra.firebase` block (populated from
// env vars) rather than hardcoded here, so it's in one place alongside the
// Google OAuth client IDs (extra.googleAuth) and doesn't need a source
// change to update. These values (apiKey, authDomain, etc.) are not
// secrets - Firebase's real access control is Firestore/Auth security
// rules, not keeping this object hidden - so committing them (unlike a
// server-side API key) is normal, though this project keeps them in
// .env/EAS env vars anyway since app.config.js already reads them that way.
//
// TODO(wilbert): set FIREBASE_API_KEY etc. (see app.config.js for the full
// list) - locally in .env, and in EAS via `eas env:create` for cloud
// builds. Firebase Console > Project Settings > General > Your apps > SDK
// setup and configuration > Config. Until then this throws a clear error
// at startup instead of silently failing deep inside the Firebase SDK.

import { initializeApp, getApps, getApp, FirebaseOptions } from 'firebase/app';
import { initializeFirestore, Firestore } from 'firebase/firestore';
import Constants from 'expo-constants';

const firebaseConfig = Constants.expoConfig?.extra?.firebase as FirebaseOptions | undefined;

function assertConfigured(config: FirebaseOptions | undefined): FirebaseOptions {
  if (!config || !config.apiKey || config.apiKey.startsWith('[')) {
    throw new Error(
      'Firebase is not configured yet. Set FIREBASE_API_KEY etc. (see extra.firebase in ' +
      'app.config.js) with your Firebase project config (Firebase Console > Project Settings ' +
      '> General > Your apps).'
    );
  }
  return config;
}

// Guards against "Firebase App named '[DEFAULT]' already exists" on Fast
// Refresh (web) reloading this module without a full app restart.
export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(assertConfigured(firebaseConfig));

// Firestore, same story as firebaseApp above - one instance, no platform
// split needed (sync-plan.md §3). Used by core/syncEngine.ts only; nothing
// else should import this directly.
//
// initializeFirestore(...) with forced long-polling, NOT plain getFirestore()
// - the default streaming WebChannel transport doesn't work reliably inside
// React Native's JS runtime (Hermes has no native streaming fetch), so even
// a plain one-shot getDoc() never establishes a connection and the SDK
// reports the client as offline (FirebaseError: "Failed to get document
// because the client is offline") even when the device has a perfectly good
// connection. This is a long-standing, well-documented issue specific to the
// plain `firebase` JS SDK on RN/Expo (as opposed to @react-native-firebase).
// useFetchStreams: false pairs with experimentalForceLongPolling per the
// SDK's own guidance - can't mix the streaming fetch path with forced long
// polling. Safe on web too (same file, no platform split), just a small,
// usually-unnoticeable perf cost there.
export const firestore: Firestore = initializeFirestore(firebaseApp, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
});
