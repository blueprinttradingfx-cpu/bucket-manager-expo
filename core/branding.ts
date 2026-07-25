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
