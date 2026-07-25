# Ani Branding Enforcement Plan

**Goal:** replace every leftover "Bucket Manager" / "Bucket Portfolio Manager" reference with the finalized "Ani" branding (sprout/seedling mark, harvest theme), consistently across native app, web build, and config/metadata.

**Status:** Tiers 1-4 all executed/decided (see checklists below). Tier 4's
"lean v1 scope" is done - dashboard/sidebar/empty-state placements are
explicitly deferred, not forgotten.

---

## Audit - where the old/inconsistent branding currently lives

| # | Location | What's there now | Risk to change |
|---|----------|-------------------|-----------------|
| 1 | `screens/components/SidebarNav.tsx` | Hardcoded `"Bucket Manager"` text + generic `wallet-outline` icon in the sidebar header (this is what's visible in the current dashboard screenshot) | None - pure UI text/icon |
| 2 | `screens/AboutScreen.tsx`, `ContactScreen.tsx`, `TermsOfUseScreen.tsx`, `PrivacyPolicyScreen.tsx` | Each independently declares `const APP_NAME = '[APP_NAME]';` - the literal bracketed placeholder was never filled in. **This is a live bug**, unrelated to which name we pick: real users currently see "About [APP_NAME]" and similar on these four screens. | None - bug fix regardless of naming decision |
| 3 | `app.config.js` → `name`, `package.json` → `name`, `README.md` | Still say "Bucket Portfolio Manager" / "bucket-portfolio-manager" | None - display name / npm package name / docs only, nothing external depends on these |
| 4 | `app.config.js` → no `icon` or splash image configured at all | Native builds fall back to Expo's default gray icon | None to fix, but needs a real asset first (see Tier 2) |
| 5 | `app.config.js` → `slug`, `android.package`, `ios.bundleIdentifier` (`com.wilzebob.bucketportfoliomanager`) | Placeholder-ish name baked into permanent identifiers | **High** - see Tier 3 |
| 6 | Web (`public/index.html`, OG image, favicon) | Already updated to "Ani" branding during the SEO pass | Already done, no action needed |

---

## Tier 1 - safe, zero cost, no new assets needed

- [x] Create a single shared branding constant, `core/branding.ts`:
  ```ts
  export const APP_NAME = 'Ani';
  export const APP_TAGLINE = 'PH Stock & Mutual Fund Portfolio Tracker';
  ```
- [x] Updated `AboutScreen.tsx`, `ContactScreen.tsx`, `TermsOfUseScreen.tsx`, `PrivacyPolicyScreen.tsx` to import `APP_NAME` from that shared file instead of each declaring their own unfilled `'[APP_NAME]'` placeholder.
- [x] `SidebarNav.tsx`: replaced `"Bucket Manager"` text with `{APP_NAME}`, and swapped the `wallet-outline` icon for a new `SproutMark.tsx` component - reuses the exact leaf/stem SVG paths from `public/favicon.svg` (minus the circle backdrop, which `brandMark`'s existing View already provides), so the mark is visually identical between web favicon and in-app UI.
- [x] `app.config.js`: `name` updated to `"Ani"` (display name only - `slug`/`android.package`/`ios.bundleIdentifier` deliberately left untouched, see Tier 3).
- [x] `package.json`: `name` updated to `"ani"`.
- [x] `README.md`: title updated to `# Ani (Expo Universal)`.
- [ ] `sync-plan.md`: not present in this repo snapshot - nothing to update, or it lives elsewhere. Flag if it turns up.

**Verified:** `npx tsc --noEmit` passes on both `tsconfig.native.json` and `tsconfig.web.json` after these changes (pre-existing, unrelated errors in `core/auth.ts`/`core/firebaseConfig.ts` around Google auth/Firestore settings remain - not touched by this pass, not caused by it).

## Tier 2 - needs a real asset first

- [x] Designed a proper app icon and splash image built around the sprout mark, at 1024x1024 (iOS/Android's expected master size - Expo/EAS downsamples from this for all required resolutions):
  - `assets/icon.png` - full-bleed `#0052FF` square (no transparent corners, so OS-side masking never reveals a checkerboard edge) with the white/green sprout centered at the same proportions as the original favicon mark.
  - `assets/adaptive-icon.png` - sprout only, transparent background, shrunk to ~65% so it stays inside Android's ~66%-diameter safe zone across circle/squircle/rounded-square launcher masks.
  - `assets/splash-icon.png` - the circular sprout badge (same mark as the web favicon/sidebar), sized to read as a small centered logo via `resizeMode: "contain"`, not a stretched full-bleed image.
  - `app.config.js` wired up: `icon`, `android.adaptiveIcon.{foregroundImage, backgroundColor}`.
- [x] Android adaptive icon layers: foreground image above, `backgroundColor: "#0052FF"` (no separate background image needed).
- [x] Splash migrated off the deprecated top-level `splash` key onto the `expo-splash-screen` config plugin (SDK 52 requirement - Android no longer supports a full-screen splash image at all). Added `expo-splash-screen` to `package.json`.

**Verified:** `node -c app.config.js` and `require('./app.config.js')` both resolve cleanly with the new `icon`/`adaptiveIcon`/`expo-splash-screen` plugin config; `npx expo-doctor` / an actual prebuild weren't run in this pass (no native tooling in this environment) - worth a sanity check before the next build.

## Tier 3 - consequential identifiers: decided

- [x] **Decision: keep the existing identifiers permanently.** `slug` stays `"bucket-portfolio-manager"`, `android.package`/`ios.bundleIdentifier` stay `com.wilzebob.bucketportfoliomanager`. Not renaming to an Ani-branded identifier (e.g. `com.wilzebob.ani`).

**Why this is the risky tier:** these are the identifiers Google Play, the App Store, and Firebase treat as the app's permanent identity. Changing them *after* a native Firebase app registration or a first store submission effectively creates a brand-new app from Google's/Apple's perspective - lost reviews, re-registration of push/OAuth, etc.

This is now closed - `app.config.js` has a note pointing back here so a future edit doesn't "fix" the mismatch between the `"Ani"` display name and the `bucketportfoliomanager` identifiers by accident.

---

## Tier 4 - visual identity / "look and feel" (currently empty, separate from the renaming work above)

Everything above is about naming consistency. None of it actually makes the app *feel* like Ani. Right now the only Ani-specific visual asset that exists anywhere is the placeholder sprout mark made for the web favicon - the in-app UI is still generic fintech blue/green with no mascot, and the "sprout mascot tied to per-bucket dividend maturity" idea exists only as a concept - there's no code field for a bucket's "growth stage" yet, and no illustration for one.

**1. Decide what "maturity" actually means (a product decision, not a design one - has to happen first):**
- [x] **Decision: a blend of yield-vs-target and time held**, not either alone. Implemented as `computeBucketGrowthStage()` in `core/bucketLogic.ts`:
  - Yield dimension: trailing-12-month dividends ÷ current cost basis, compared against the bucket's own `yield_low`. Annualized deliberately - `yield_low`/`yield_high` are an *annual* yield % used to sort stocks into a bucket (see `suggestBucketForYield`), not a target for all-time cumulative dividends, so comparing raw lifetime `totalDividends` against it would hit 1.0 within a year or two and then sit there permanently, measuring nothing. Buckets with no `yield_low` set drop this dimension entirely (time-only) rather than being treated as 0%.
  - Time dimension: months since the bucket's earliest BUY transaction, capped at 60 months (5 years) = full maturity.
  - Combined: average of the two (or just time, when there's no yield target) mapped to 4 stage thresholds.
  - Both inputs come from data that already existed (`getBucketTransactionFeed`, `positions[].totalCostBasis`, `yield_low`) - no schema/DB changes needed.
  - Verified with 6 hand-checked cases (empty bucket, no dividends yet, no target set, exactly at target, over target/capped at 1.0, a stale dividend correctly excluded from the trailing window).

**2. Define the growth-stage system:**
- [x] 4 stages: seed -> sprout -> sapling -> tree.
- [x] Built as reshapes of the existing mark, not new illustrations, in `screens/components/GrowthStageMark.tsx`: seed is a small dormant ellipse (no stem/leaves yet); sprout is the unchanged Tier-1 mark; sapling is a taller stem plus the same leaf pair duplicated at a second, higher tier (checked this actually reads as taller at small sizes, not just extra detail hidden inside the same silhouette - see note below); tree is a trunk plus 3 copies of the *same* leaf path rotated 120° apart into a canopy cluster.
- [x] Colors default to dark-on-light-card (`theme.ts` `onSurface` for stem, existing `#05B169` for leaves) rather than SproutMark's white-on-blue-circle styling, since this renders directly on bucket cards, not inside the circular badge.

**3. Where it actually shows up, prioritized (don't build all of these at once):**
- [x] Bucket cards (`BucketsScreen.tsx`, next to the name) and `BucketDetailScreen.tsx` (header) - the actual point of the concept, done first per the lean v1 scope.
- [ ] Dashboard - a small aggregate/summary version, once the per-bucket version is live and feels right.
- [ ] Sidebar/header mark - static version only (covered by Tier 1 already).
- [ ] Empty states / onboarding - nice-to-have, not essential for a v1.

**4. Color system - minor refinement, not a rebuild:**
- [ ] Keep `#0052FF` as primary - it works, it's professional, no reason to change it.
- [ ] Define an intentional rule for when the green (`#05B169`) is "the brand" (mascot, growth stages) vs. when it's just "the positive-number color" in data tables, so the two uses don't blur together.

**5. Typography - no gap here.** Inter (body) + JetBrains Mono (tabular/ticker data) are already solid, deliberate choices - nothing to change.

**Suggested lean v1 scope**, to avoid this becoming its own open-ended project: one product decision (what drives the stage) + 3-4 simple recolor/reshape variants of the mark that already exists (not fully distinct illustrations) + one placement (bucket cards only). Expand from there only once it's proven it earns its keep.

**Verified:** `npx tsc --noEmit` passes on both `tsconfig.native.json` and `tsconfig.web.json` (same 5 pre-existing `core/auth.ts`/`core/firebaseConfig.ts` errors as Tier 1, nothing new); `npm run test:core` (the existing pure-logic suite) still passes unchanged; `computeBucketGrowthStage` was hand-tested against 6 cases (empty bucket, no dividends yet, no yield target set, exactly at target, over target - confirms it caps at 1.0 instead of overflowing, and a stale >12-month-old dividend correctly excluded from the trailing window). The 4 `GrowthStageMark` stages were checked by rendering each and measuring bounding boxes, confirming sapling and tree are genuinely wider/taller than sprout rather than just adding detail inside the same silhouette - not a real on-device screenshot, worth a quick visual sanity check on first run.

Not done, left for later per the lean-scope note above: dashboard summary version, sidebar/empty-state placements.

---

## Suggested order of operations

1. ~~Do all of Tier 1 now~~ - done.
2. ~~Do Tier 2 (icon/splash)~~ - done. (Executed before the Tier 3 decision below, out of the originally suggested order - no harm came of it since nothing in Tier 2 touches the identifiers.)
3. ~~Decide on Tier 3~~ - done: kept the existing identifiers.
4. ~~Tier 4 (visual identity)~~ - lean v1 scope done: blend-based growth stage + 4-stage mark, on bucket cards and BucketDetailScreen. Dashboard/sidebar/empty-state placements deferred until the per-bucket version proves it earns its keep (per the lean-scope note above).
