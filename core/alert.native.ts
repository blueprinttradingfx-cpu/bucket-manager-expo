// core/alert.native.ts
// On iOS/Android, React Native's built-in Alert works fine - it shows the
// native OS alert dialog. Just pass it through.
//
// AlertHost has nothing to do here (native alerts render as a system
// overlay, not a React tree), but it's exported so App.tsx can mount
// <AlertHost /> unconditionally without needing a platform check.

import { Alert } from 'react-native';

export function AlertHost() {
  return null;
}

export default Alert;
