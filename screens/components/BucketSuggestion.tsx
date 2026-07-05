// screens/components/BucketSuggestion.tsx
// The "AREIT - 6.5% div yield - buy on what bucket?" panel. Shared between
// SearchStockScreen (for tickers you don't hold yet) and StockDetailScreen
// (for ones you already do - useful when deciding where to add more
// shares, or just to sanity-check a holding still fits its bucket's
// yield bracket). Both screens should always agree on this logic, hence
// pulling it into one component rather than keeping two copies in sync.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { suggestBucketForYield, YieldBracket } from '../../core/bucketLogic';
import { colors, fonts } from '../../core/theme';

export default function BucketSuggestion({ ticker, yieldPct, buckets }: { ticker: string; yieldPct: number | null; buckets: YieldBracket[] }) {
  if (yieldPct == null) {
    return (
      <Text style={styles.suggestionText}>
        No dividend yield data available yet for {ticker} - the price cache doesn't have a yield figure for it (it may not be a dividend payer, or the source that priced it doesn't report yield). Bucket suggestion needs a yield to match against.
      </Text>
    );
  }

  const suggestion = suggestBucketForYield(yieldPct, buckets);

  return (
    <View>
      <Text style={styles.suggestionHeadline}>{ticker} · {yieldPct}% div yield</Text>
      {suggestion.reason === 'match' && suggestion.bucket && (
        <Text style={styles.suggestionMatch}>
          Buy into <Text style={styles.suggestionBucketName}>{suggestion.bucket.name}</Text> ({suggestion.bucket.yield_low}%–{suggestion.bucket.yield_high}%)
        </Text>
      )}
      {suggestion.reason === 'no_matching_range' && (
        <Text style={styles.suggestionNoMatch}>
          No bucket's yield range covers {yieldPct}%.
          {suggestion.nearestBucket && ` Closest is ${suggestion.nearestBucket.name} (${suggestion.nearestBucket.yield_low}%–${suggestion.nearestBucket.yield_high}%).`}
          {' '}Consider adjusting a bucket's range in the Buckets tab.
        </Text>
      )}
      {suggestion.reason === 'no_buckets_configured' && (
        <Text style={styles.suggestionNoMatch}>
          None of your buckets have a yield range set yet - add one in the Buckets tab to get suggestions here.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  suggestionHeadline: { fontFamily: fonts.monoSemiBold, fontSize: 13, color: colors.onSurface, marginBottom: 6 },
  suggestionMatch: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurface },
  suggestionBucketName: { fontFamily: fonts.bodyBold, color: colors.primary },
  suggestionNoMatch: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant },
  suggestionText: { fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant },
});
