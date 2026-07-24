// app.config.js
// Replaces the old static app.json (removed - Expo only reads one of the
// two, and app.config.js takes precedence when both exist, so keeping
// app.json around would just be a stale trap for whoever edits it next).
//
// Dynamic config so Firebase/Google OAuth values can come from env vars
// instead of being committed as plaintext. Expo CLI (SDK 49+) auto-loads
// a local .env file into process.env before this file runs for `expo
// start` / `expo export` - no dotenv package needed. That does NOT extend
// to `eas build`: the cloud build machine only sees vars pushed to EAS as
// environment variables (`eas env:create`, or legacy `eas secret:create`).
// A local-only .env will build fine locally and silently produce an
// unconfigured app from `eas build`.
//
// Note: app.config.js only supports require()/module.exports, not
// import/export - see https://docs.expo.dev/workflow/configuration/.

module.exports = {
  expo: {
    name: "Bucket Portfolio Manager",
    slug: "bucket-portfolio-manager",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    splash: {
      backgroundColor: "#FFFFFF"
    },
    android: {
      package: "com.wilzebob.bucketportfoliomanager"
    },
    ios: {
      bundleIdentifier: "com.wilzebob.bucketportfoliomanager",
      supportsTablet: false
    },
    plugins: [
      "expo-sqlite",
      [
        "@react-native-google-signin/google-signin",
        {
          // The plugin validates this must start with "com.googleusercontent.apps"
          // (it's the reversed iOS OAuth client ID) - a bracketed placeholder
          // fails that check and hard-crashes `expo config`/prebuild even
          // for local dev before real credentials exist. This dummy value
          // passes validation and is obviously fake; set the real
          // GOOGLE_IOS_URL_SCHEME env var before an actual iOS build.
          iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME || "com.googleusercontent.apps.placeholder"
        }
      ]
    ],
    extra: {
      firebase: {
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID
      },
      googleAuth: {
        webClientId: process.env.GOOGLE_WEB_CLIENT_ID,
        iosClientId: process.env.GOOGLE_IOS_CLIENT_ID,
        androidClientId: process.env.GOOGLE_ANDROID_CLIENT_ID
      },
      eas: {
        projectId: "c0a785a9-8b93-407f-a6bf-c3a3ec101f0b"
      }
    }
  }
};