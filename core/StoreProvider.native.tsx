// core/StoreProvider.native.tsx
// Native (iOS/Android) provider. Wraps expo-sqlite's own SQLiteProvider,
// then exposes a NativeBucketStore instance through StoreContext so screens
// never need to know expo-sqlite exists - they just call useStore().

import React, { createContext, useContext, useState } from 'react';
import { SQLiteProvider, useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { initSchema, NativeBucketStore } from './db.native';
import { BucketStoreAPI } from './storeApi';

const StoreContext = createContext<BucketStoreAPI | null>(null);

function InnerProvider({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const [store] = useState(() => new NativeBucketStore(db));
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

async function onInit(db: SQLiteDatabase) {
  await initSchema(db);
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  return (
    <SQLiteProvider databaseName="bucket_portfolio.db" onInit={onInit}>
      <InnerProvider>{children}</InnerProvider>
    </SQLiteProvider>
  );
}

export function useStore(): BucketStoreAPI {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used within StoreProvider');
  return store;
}
