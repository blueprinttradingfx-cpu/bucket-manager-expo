# Ani — Pre-Launch Checklist

Findings from a production-readiness pass (2026-07-26). Verified by actually
running the project — `npm install`, `tsc --noEmit` on both platform
configs, `npm run test:core`, `npm run test:web-store`, and a real
`npx expo export --platform web` — not just reading the code. Grouped by
severity; check items off as they're done.

## 🔴 Blockers — fix before submitting to any store

- [x] **Rewrite `screens/PrivacyPolicyScreen.tsx`.** Done (2026-07-26) — now
      accurately discloses Google Sign-In + optional Firestore sync, what
      profile data that shares, that there's no analytics/ads/crash
      reporting yet, and a real "Deleting your data" section pointing at
      the new in-app delete flow (see below) instead of "just uninstall."
- [x] **Fill in placeholder constants.** Done — `SUPPORT_EMAIL` and
      `APP_VERSION` centralized/derived properly; `EFFECTIVE_DATE` and
      `GOVERNING_LAW` filled with reasonable defaults (Philippines) that
      are flagged in-code for you to confirm. `SUPPORT_EMAIL` is currently
      a placeholder Gmail address (`ani.app.support@gmail.com`, in
      `core/branding.ts`) — swap for the real inbox before shipping.
- [x] **Host the Privacy Policy at a public URL.** `core/linking.ts` +
      `NavigationContainer`'s new `linking` prop give every screen a real
      path (`/privacy-policy`, `/terms`, `/about`, `/contact`, etc.) instead
      of everything living behind an opaque `/`. Verified: `tsc` clean,
      path strings confirmed present in the built web bundle. **Still
      needed from you:** redeploy to Vercel, then confirm in an actual
      browser that `https://bucket-manager-zeta.vercel.app/privacy-policy`
      loads the right screen and updates the URL bar when navigating
      in-app — I can't drive a real browser from here to click through it
      myself.
- [ ] **Configure iOS Google Sign-In for real.** Still open — needs a real
      `GOOGLE_IOS_CLIENT_ID` and `GOOGLE_IOS_URL_SCHEME` from Google Cloud
      Console. Can't be done from here; these are real credentials only you
      can generate.
- [x] **Add an account/data deletion path.** Done — "Delete My Data" on
      `AccountScreen`, wired through `syncEngine.ts`'s new
      `deleteAllRemoteData(uid)`, `storeApi.ts`'s new `wipeAllLocalData()`
      on both platforms, and a new `deleteAccount()` on both
      `AuthProvider`s (with automatic reauth-and-retry for Firebase's
      `requires-recent-login`). Ordered remote → local → account
      specifically so a failure partway through never orphans Firestore
      data under a uid nobody can reach anymore.
- [ ] **Confirm EAS env vars are actually pushed** (`eas env:list`). Still
      open — needs your EAS credentials, can't be checked from here.

## 🟡 Real bugs — not blocking, but worth fixing soon

- [x] **`tsc --noEmit` failures.** Fixed — deleted dead `core/auth.ts`,
      dropped the no-longer-valid `useFetchStreams` option from
      `firebaseConfig.ts`. Both `tsconfig.native.json` and
      `tsconfig.web.json` type-check clean again.
- [x] Add a top-level Error Boundary around `AppShell`. Done —
      `core/ErrorBoundary.tsx` wraps the whole tree in `App.tsx` (outside
      even `StoreProvider`, so a provider-init crash is caught too), with a
      "Try Again" (remount) and, on web, "Reload Page." Deliberately reads
      `Appearance` directly rather than `useThemeColors()`, same reasoning
      as the existing fonts-loading splash branch: don't depend on context
      that might be the thing that's broken. `componentDidCatch` is marked
      as the hook point for whichever crash reporter gets picked below.
      Verified: `tsc` clean, web export still builds. No RN component-test
      infra exists in this project (test:core/test:web-store are logic-only
      scripts, not a component-rendering test runner), so this wasn't
      rendered-and-thrown-at in an automated test - it's a standard,
      well-established React pattern (getDerivedStateFromError +
      componentDidCatch), not novel code.
- [x] Add crash reporting before wider launch. Done — Firebase Crashlytics
      via `@react-native-firebase/app` + `@react-native-firebase/crashlytics`
      (a separate native module from the plain `firebase` JS SDK already
      used for Auth/Firestore - the JS SDK doesn't support Crashlytics on
      native at all, confirmed against Expo's own Firebase docs). New
      `core/crashReporting.native.ts` / `.web.ts` split (web is a
      `console.error` stub - Crashlytics has no web product at all, not a
      gap in this implementation). Wired into `ErrorBoundary`'s
      `componentDidCatch` and into both `AuthProvider`s' `setUserId` so
      crashes trace back to an account without exposing name/email on the
      dashboard. Versions pinned to `21.6.1`/`0.13.2` (contemporaneous with
      Expo SDK 52's release window, not "latest" - the newest
      `@react-native-firebase` targets RN's newer "prebuilt core"
      architecture (RN 0.84+/Expo 54+) this project isn't on).
      **Still needed from you, and this is the real blocker on this one:**
      download `google-services.json` and `GoogleService-Info.plist` from
      the Firebase Console (`bucketportfoliomanager` project) and place
      them in the project root - `app.config.js` now points at those exact
      paths but the files themselves don't exist in this checkout, since
      they're project credentials only downloadable from your own Firebase
      Console. The build will fail at the Crashlytics config-plugin step
      until they're there. This also needs a fresh EAS/dev-client build to
      actually test (can't run in Expo Go - not a new constraint, Google
      Sign-In already required this) and I have no Android/iOS toolchain
      here to build or run it myself, so this is verified by `tsc` +
      confirming the web bundle correctly excludes the native module, not
      by an actual device crash test.
- [x] **`core/scraper.ts`** — confirmed unused/dead, safe to delete
      whenever; left in place for now since it wasn't asked for.
- [ ] **Fill in donation placeholders.** Added a "Support the Developer"
      screen (`screens/SupportScreen.tsx`, linked from a card at the top of
      Settings) - GCash/Maya (copy name+number, optional QR) and Buy Me a
      Coffee (opens browser). Deliberately not an in-app payment flow, so
      it stays outside Apple/Google's in-app-purchase review requirements
      entirely - GCash/Maya are sent from the person's own app after
      copying the details shown, and Buy Me a Coffee opens the system
      browser rather than taking a card in-app. New constants in
      `core/branding.ts` (`GCASH_NAME`, `GCASH_NUMBER`,
      `GCASH_QR_IMAGE_URL`, `BUY_ME_A_COFFEE_USERNAME`) are still
      bracketed placeholders - **still needed from you:** your real
      GCash/Maya name + number, your Buy Me a Coffee username, and
      optionally a URL to a hosted QR code image (skip it and the screen
      just omits the QR, copyable name/number still work on their own).
      Verified: `tsc` clean on both configs, `npx expo export --platform
      web` succeeds and the new `settings/support` path (added to
      `core/linking.ts` alongside every other screen) is confirmed present
      in the built bundle, both test suites still pass unchanged.

## 🟢 Verified solid — no action needed

- Firestore rules (`firestore.rules`) correctly scope every doc to
  `request.auth.uid` — no cross-user read/write path.
- `.env` is properly gitignored; the Firebase config values in it aren't
  secrets by nature (Firestore/Auth rules are the real access control, not
  obscurity) — correctly reasoned in the code's own comments.
- `npm run test:core` and `npm run test:web-store` both pass cleanly (ran
  live) — FIFO/dedup logic, sync-merge logic (11 scenarios), and the real
  IndexedDB implementation via `fake-indexeddb` all check out.
- `npx expo export --platform web` succeeds (ran live) — 659 modules,
  working `dist/` output.
- Financial math in `core/bucketLogic.ts` consistently guards divide-by-zero
  (`totalQty > 0 ? ... : 0` pattern throughout). One narrow exception: a
  zero-quantity BUY row would produce `Infinity` via `fees / qty` (~line
  416) — not a realistic broker-export case, but a one-line guard would
  close it entirely.
- Error handling is broad: 44 try/catch blocks across the sync/account code,
  only 3 deliberately-silent catches, all in low-stakes "best effort" cache
  paths.
- Native Firebase Auth persistence is correctly wired through AsyncStorage,
  with a well-documented `@ts-expect-error` explaining exactly why it's
  needed and when it'll stop being needed.
- The personal `.xlsx` test fixture (`user-data/uploads/`) is properly
  gitignored with a README explaining why it doesn't belong in source
  control.

## Suggested order of attack

1. Privacy Policy content + placeholders — the one item that can actually
   block a store submission outright.
2. `useFetchStreams` / `core/auth.ts` cleanup — quick, gets `tsc` back to
   green.
3. Error boundary + crash reporting — before this goes in front of real
   users beyond yourself.
4. Everything else, as time allows.
