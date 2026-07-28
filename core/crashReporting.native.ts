// core/crashReporting.native.ts
// Pre-launch pass (2026-07-26). Firebase Crashlytics, via
// @react-native-firebase/crashlytics - a SEPARATE native module from the
// plain `firebase` JS SDK already used for Auth/Firestore
// (core/firebaseConfig.ts). This isn't redundancy: the JS SDK doesn't
// support Crashlytics at all on native (Expo's own Firebase docs say so
// directly - Analytics/Dynamic Links/Crashlytics are RNFB-only), so both
// SDKs coexisting, pointed at the same Firebase project
// ("bucketportfoliomanager"), is the standard, documented setup - not an
// accident of two libraries getting mixed up.
//
// @react-native-firebase auto-initializes from the native config files
// (google-services.json / GoogleService-Info.plist - see app.config.js's
// googleServicesFile fields) rather than an explicit initializeApp() call
// like the JS SDK needs, so there's no equivalent of firebaseConfig.ts
// here.
//
// Requires a native/EAS dev build - won't work in Expo Go. Not a new
// constraint: this project already can't run in Expo Go because of
// @react-native-google-signin/google-signin.

import crashlytics from '@react-native-firebase/crashlytics';

/** Reports a caught error to Crashlytics. `context` becomes Crashlytics
 *  "custom keys" attached to the report - keep values short strings, not
 *  full objects or anything that could contain portfolio figures. */
export function recordError(error: Error, context?: Record<string, string>): void {
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      crashlytics().setAttribute(key, value);
    }
  }
  crashlytics().recordError(error);
}

/** Breadcrumb-style log line, bundled into whatever report follows it -
 *  NOT sent as its own event. Same "short strings, no portfolio data"
 *  rule as recordError's context. */
export function log(message: string): void {
  crashlytics().log(message);
}

/** Associates subsequent reports with a Firebase Auth uid, so a crash can
 *  be traced to "this signed-in account" without identifying who that is
 *  from the Crashlytics dashboard alone. Call with null on sign-out so
 *  reports after that point aren't misattributed to the account that just
 *  left. */
export function setUserId(uid: string | null): void {
  crashlytics().setUserId(uid ?? '');
}
