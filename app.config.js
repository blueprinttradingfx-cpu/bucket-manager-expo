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
    name: "Ani",
    // NOTE: slug/android.package/ios.bundleIdentifier intentionally left as
    // the old "bucketportfoliomanager" identifiers - see Tier 3 of
    // ani-branding-plan.md. This is a load-bearing decision (Play
    // Store/App Store/Firebase permanent app identity), not an oversight.
    slug: "bucket-portfolio-manager",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    // Ani branding plan, Tier 2: real icon/splash assets built around the
    // sprout mark (previously no icon was configured at all - native builds
    // fell back to Expo's default gray icon).
    icon: "./assets/icon.png",
    android: {
      package: "com.wilzebob.bucketportfoliomanager",
      adaptiveIcon: {
        // Sprout only, shrunk to fit Android's ~66%-diameter safe zone so it
        // isn't clipped by circle/squircle/rounded-square launcher masks.
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#0052FF"
      }
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
      ],
      [
        // Replaces the old top-level `splash` key, which SDK 52 is
        // deprecating in favor of this plugin - and Android no longer
        // supports a full-screen splash image at all, only a small
        // centered one. `splash-icon.png` is the circular sprout badge
        // (same mark as the web favicon/sidebar), sized to read as a
        // logo rather than a stretched full-bleed image.
        "expo-splash-screen",
        {
          image: "./assets/splash-icon.png",
          resizeMode: "contain",
          backgroundColor: "#FFFFFF"
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