// core/firebaseAuth.web.ts
// Metro resolves './firebaseAuth' to THIS file on web (same convention as
// './db' and './StoreProvider'). Plain getAuth() is enough here - the
// browser's own IndexedDB-backed persistence is automatic, no extra
// wiring needed.

import { getAuth } from 'firebase/auth';
import { firebaseApp } from './firebaseConfig';

export const auth = getAuth(firebaseApp);
