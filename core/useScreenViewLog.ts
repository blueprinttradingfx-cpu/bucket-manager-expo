// core/useScreenViewLog.ts
// Logs which screen is currently in view, and with what params (ticker,
// bucket, etc.) where relevant. Uses useFocusEffect rather than a plain
// mount effect because React Navigation keeps prior stack screens mounted
// underneath the current one - a mount-only effect would only log the
// FIRST time you land on a screen, not every time you navigate back to it.
// Fires again on every focus (including back-navigation) and is silent on
// blur, so the log reads as a simple "here's where you are now" trail.

import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';

export function useScreenViewLog(screenName: string, params?: Record<string, unknown>) {
  const paramsKey = params ? JSON.stringify(params) : '';
  useFocusEffect(
    useCallback(() => {
      const suffix = paramsKey ? ` ${paramsKey}` : '';
      console.log(`[ScreenView] ${screenName}${suffix}`);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screenName, paramsKey])
  );
}
