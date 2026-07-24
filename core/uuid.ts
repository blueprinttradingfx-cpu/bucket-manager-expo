// core/uuid.ts
// Lightweight UUID v4 generator used to give buckets and transactions a
// stable cross-device ID (see sync-plan.md §1). Deliberately dependency-free
// - no expo-crypto / uuid package - since these IDs only need to be unique
// enough to key a single user's Firestore documents, not cryptographically
// unguessable. Same code path on native and web.

export function generateUuid(): string {
  const g: any = globalThis as any;
  if (typeof g.crypto?.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (older Hermes).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
