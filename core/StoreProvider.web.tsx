// core/StoreProvider.web.tsx
// Web provider. Opens IndexedDB asynchronously on mount, then exposes the
// same StoreContext shape as the native version - same useStore() hook,
// same BucketStoreAPI, so screens are identical across platforms.

import React, { createContext, useContext, useEffect, useState } from 'react';
import { View, Text, Appearance } from 'react-native';
import { WebBucketStore } from './db.web';
import { BucketStoreAPI } from './storeApi';
import { lightColors, darkColors } from './theme';

const StoreContext = createContext<BucketStoreAPI | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<BucketStoreAPI | null>(null);

  useEffect(() => {
    WebBucketStore.create().then(setStore);
  }, []);

  if (!store) {
    // IndexedDB open is async, unlike SQLite's near-instant native open -
    // brief loading state on web only, first mount. ThemeContext isn't
    // mounted yet at this point (it lives inside this provider and needs
    // useStore() itself), so this falls back to the OS appearance directly
    // rather than a saved preference - same approach as App.tsx's
    // pre-fonts-loaded splash.
    const colors = Appearance.getColorScheme() === 'dark' ? darkColors : lightColors;
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.onSurfaceVariant }}>Loading…</Text>
      </View>
    );
  }
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): BucketStoreAPI {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used within StoreProvider');
  return store;
}
