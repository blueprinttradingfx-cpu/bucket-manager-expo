// core/branding.ts
// Single source of truth for the app's display name/tagline. Screens that
// reference the app by name should import from here instead of declaring
// their own local constant - see ani-branding-plan.md, Tier 1.
//
// Note: this is display copy only. It's deliberately NOT wired into
// app.config.js (name/slug/bundleIdentifier) - those are handled directly
// in app.config.js per Tier 1/Tier 3 of the branding plan, since
// app.config.js can't import from the app's TS source at build time.

export const APP_NAME = 'Ani';
export const APP_TAGLINE = 'PH Stock & Mutual Fund Portfolio Tracker';

// PLACEHOLDER (2026-07-26 pre-launch pass) - a real support inbox, not yet
// a real domain. Swap for the actual support address before submitting to
// either store; Contact/Privacy Policy/Terms of Use all read from here.
export const SUPPORT_EMAIL = 'ani.app.support@gmail.com';

// PLACEHOLDER - donation details for SupportScreen.tsx. Deliberately NOT an
// in-app payment flow (no IAP, no card form in-app) - GCash/Maya are sent
// from the person's own app after copying these details, and Buy Me a
// Coffee opens in the system browser. Both stay outside Apple/Google's
// in-app-purchase review requirements entirely, since no payment is
// processed inside this app.
export const GCASH_NAME = '[GCASH_ACCOUNT_NAME]';
export const GCASH_NUMBER = '[GCASH_NUMBER]';
// Optional. Leave as the placeholder to skip the QR code (name+number copy
// still works fine on its own). Must be a hosted URL, not a local asset -
// SupportScreen.tsx loads it via `Image source={{ uri: ... }}` rather than
// a static require(), so a missing/placeholder value can never break the
// Metro bundle the way a missing local file would.
export const GCASH_QR_IMAGE_URL: string = '[GCASH_QR_IMAGE_URL]';
export const BUY_ME_A_COFFEE_USERNAME = '[BUY_ME_A_COFFEE_USERNAME]';
