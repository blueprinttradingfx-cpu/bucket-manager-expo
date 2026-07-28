// core/crashReporting.web.ts
// Crashlytics has no web SDK/product at all (it's specifically a mobile
// crash reporter - "crashes" in the native sense don't apply to a web
// page the same way), so this is a deliberate no-op stub rather than a
// missing implementation. Same exported shape as crashReporting.native.ts
// so callers (core/ErrorBoundary.tsx, AuthProvider.web.tsx) don't need a
// Platform.OS check of their own.

export function recordError(error: Error, context?: Record<string, string>): void {
  // console.error is already what ErrorBoundary's componentDidCatch logs
  // regardless of platform - this just makes the context visible too, so
  // web isn't strictly worse off for having no real crash reporter.
  console.error('[crashReporting:web]', error, context);
}

export function log(_message: string): void {}

export function setUserId(_uid: string | null): void {}
