// core/firebaseAuth.native.ts
// Metro resolves './firebaseAuth' to THIS file on iOS/Android. Unlike web,
// plain getAuth() on native has no persistence at all by default - every
// app restart would come up signed out, which defeats the point of
// syncing across devices ("sign in once, stays signed in"). initializeAuth
// + getReactNativePersistence(AsyncStorage) is Firebase's own documented
// fix for this, and getReactNativePersistence lives directly on
// 'firebase/auth' now (an older version of the SDK required importing
// from a 'firebase/auth/react-native' subpath - that's gone).
import {
  // @ts-expect-error - getReactNativePersistence lives behind this
  // package's "react-native" exports condition (@firebase/auth/dist/
  // index.rn.d.ts). Metro resolves that condition and provides it at
  // bundle/run time; this project's tsconfig inherits Expo's classic
  // moduleResolution: "node", which ignores conditional exports and always
  // resolves the generic (non-RN) typings - so this one line type-checks
  // as missing even though it isn't. If a future SDK/tsconfig upgrade
  // moves moduleResolution to "bundler"/"node16", this ts-expect-error
  // will itself start failing (a good thing - remove it then).
  initializeAuth, getReactNativePersistence,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebaseApp } from './firebaseConfig';

export const auth = initializeAuth(firebaseApp, {
  persistence: getReactNativePersistence(AsyncStorage),
});
