// screens/components/TickerLogo.tsx
// Renders a ticker's logo image inside the circular avatar slot that used
// to show a plain 2-letter text badge (see PositionsTable/WatchlistTable's
// old `badge`/`badgeText` styles). Logos are sourced from the same
// bucket-manager-web repo as prices.json/funds.json (see priceCache.ts/
// fundCache.ts) - one PNG per ticker, under public/logos/, named by ticker
// symbol exactly (e.g. AREIT.png).
//
// Not every ticker in the PSE/fund universe has a logo file checked into
// that repo yet, so this can never be a hard dependency - a 404 (or any
// other load failure) just falls back to the original letter-badge look
// rather than showing a broken image icon.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { fonts, ThemeColors } from '../../core/theme';
import { useThemeColors } from '../../core/ThemeContext';
import { DATA_PROXY_BASE_URL } from '../../core/priceCache';

// Sibling directory to public/data/prices.json and public/data/funds.json
// in the same repo - served through the Worker proxy, see priceCache.ts's
// DATA_PROXY_BASE_URL comment. The Worker returns these as image/png
// (not JSON), unlike every other route it serves.
const LOGO_BASE_URL = `${DATA_PROXY_BASE_URL}/v1/logos`;

export function tickerLogoUrl(ticker: string): string {
  return `${LOGO_BASE_URL}/${ticker.toUpperCase()}.png`;
}

interface Props {
  ticker: string;
  /** Shown instead of the image when there's no logo yet, or it fails to load. */
  fallbackText: string;
  size?: number;
}

export default function TickerLogo({ ticker, fallbackText, size = 40 }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [failed, setFailed] = useState(false);

  // A row that gets reused for a different ticker (e.g. re-sorting the
  // Positions list) shouldn't stay stuck on a previous ticker's "failed"
  // state - reset whenever the ticker itself changes.
  useEffect(() => { setFailed(false); }, [ticker]);

  const dim = { width: size, height: size, borderRadius: size / 2 };

  if (failed) {
    return (
      <View style={[styles.badge, dim]}>
        <Text style={[styles.badgeText, { fontSize: size * 0.32 }]}>{fallbackText}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.badge, dim]}>
      <Image
        source={{ uri: tickerLogoUrl(ticker) }}
        style={dim}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  badge: {
    backgroundColor: colors.surfaceContainerHighest, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  badgeText: { fontFamily: fonts.monoSemiBold, color: colors.primary },
});
