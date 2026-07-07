// screens/BucketStrategyInfoScreen.tsx
// Static "Read more" article opened from the (?) next to "Add new bucket"
// on BucketsScreen. Walks the strategy problem-first: the single-broker-
// account FIFO problem, then the bucket-as-broker-account idea, why yield
// is the axis, buying, selling, per-bucket FIFO, and the flexibility to
// use the same low/high mechanism for a non-yield axis. Pure content, no
// data fetching.

import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing, fonts, radii, bucketColorFor } from '../core/theme';
import { suggestBucketForYield, YieldBracket } from '../core/bucketLogic';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

// Purely illustrative sample buckets for the diagram + simulation below -
// deliberately NOT the person's real buckets (this screen has no data
// dependency), and deliberately left with gaps between them so the
// "some yields land in no bucket at all" case has something to point at.
const SCALE_MIN = 0;
const SCALE_MAX = 9;
const SAMPLE_BUCKETS = [
  { name: 'B1', low: 3, high: 4.5 },
  { name: 'B2', low: 5, high: 6.5 },
  { name: 'B3', low: 6.5, high: 8 },
] as const;

type Segment = { kind: 'bucket'; name: string; low: number; high: number; color: string } | { kind: 'gap'; low: number; high: number };

function buildSegments(): Segment[] {
  const segments: Segment[] = [];
  let cursor = SCALE_MIN;
  SAMPLE_BUCKETS.forEach((b, i) => {
    if (b.low > cursor) segments.push({ kind: 'gap', low: cursor, high: b.low });
    segments.push({ kind: 'bucket', name: b.name, low: b.low, high: b.high, color: bucketColorFor(b.name, i) });
    cursor = b.high;
  });
  if (cursor < SCALE_MAX) segments.push({ kind: 'gap', low: cursor, high: SCALE_MAX });
  return segments;
}

// The simulation below runs through the app's actual matching function
// (suggestBucketForYield) against the same sample buckets as the diagram,
// so the worked example can't drift out of sync with real behavior -
// including the exact boundary rule (low is inclusive, high is not).
const SAMPLE_YIELD_BRACKETS: YieldBracket[] = SAMPLE_BUCKETS.map((b) => ({ name: b.name, yield_low: b.low, yield_high: b.high }));

const SAMPLE_TICKERS: { ticker: string; yieldPct: number; note?: string }[] = [
  { ticker: 'AAA', yieldPct: 3.8 },
  { ticker: 'BBB', yieldPct: 4.8, note: 'Falls in the gap between B1 and B2 - no bucket claims it.' },
  { ticker: 'CCC', yieldPct: 5, note: 'Exactly on B2\u2019s low edge - the low bound is inclusive, so it counts as B2.' },
  { ticker: 'DDD', yieldPct: 6.5, note: 'Exactly on the B2/B3 line - the high bound is exclusive, so it rolls into B3, not B2.' },
  { ticker: 'EEE', yieldPct: 8.4, note: 'Above every range - no match, closest bucket is suggested instead.' },
];

function SimulationRow({ ticker, yieldPct, note }: { ticker: string; yieldPct: number; note?: string }) {
  const suggestion = suggestBucketForYield(yieldPct, SAMPLE_YIELD_BRACKETS);
  const matchedBucket = suggestion.reason === 'match' ? suggestion.bucket : suggestion.nearestBucket ?? null;
  const bucketIndex = matchedBucket ? SAMPLE_BUCKETS.findIndex((b) => b.name === matchedBucket.name) : -1;
  const badgeColor = suggestion.reason === 'match' && matchedBucket ? bucketColorFor(matchedBucket.name, bucketIndex) : colors.surfaceContainerHighest;

  return (
    <View style={styles.simRow}>
      <View style={styles.simRowMain}>
        <View style={styles.simTickerBlock}>
          <Text style={styles.simTicker}>{ticker}</Text>
          <Text style={styles.simYield}>{yieldPct}% div yield</Text>
        </View>
        <Text style={styles.simArrow}>→</Text>
        <View style={[styles.simBadge, { backgroundColor: badgeColor }]}>
          <Text style={[styles.simBadgeText, suggestion.reason !== 'match' && styles.simBadgeTextMuted]}>
            {suggestion.reason === 'match' && matchedBucket
              ? matchedBucket.name
              : matchedBucket
                ? `No match · closest ${matchedBucket.name}`
                : 'No match'}
          </Text>
        </View>
      </View>
      {note && <Text style={styles.simNote}>{note}</Text>}
    </View>
  );
}

// FIFO worked example - one bucket, one ticker, three buy lots bought over
// time, then a sale that doesn't cleanly match any single lot. Mirrors the
// same "shift oldest lot first, split it if the sale is smaller" logic
// computeHoldings() actually runs, just with made-up numbers.
const FIFO_LOTS = [
  { id: 'Lot 1', qty: 100, unitCost: 10, dateLabel: 'bought Jan' },
  { id: 'Lot 2', qty: 50, unitCost: 12, dateLabel: 'bought Mar' },
  { id: 'Lot 3', qty: 80, unitCost: 15, dateLabel: 'bought Jun' },
];
const FIFO_SELL_QTY = 120;
const FIFO_SELL_PRICE = 14;

function simulateFifoSell() {
  let toSell = FIFO_SELL_QTY;
  let costBasisMatched = 0;
  const matched: { id: string; qty: number; unitCost: number }[] = [];
  const remaining: { id: string; qty: number; unitCost: number }[] = [];
  for (const lot of FIFO_LOTS) {
    if (toSell <= 0) { remaining.push({ ...lot }); continue; }
    const consumed = Math.min(lot.qty, toSell);
    costBasisMatched += consumed * lot.unitCost;
    matched.push({ id: lot.id, qty: consumed, unitCost: lot.unitCost });
    toSell -= consumed;
    if (lot.qty - consumed > 0.0001) remaining.push({ id: lot.id, qty: lot.qty - consumed, unitCost: lot.unitCost });
  }
  const proceeds = FIFO_SELL_QTY * FIFO_SELL_PRICE;
  return { matched, remaining, costBasis: costBasisMatched, proceeds, realizedGain: proceeds - costBasisMatched };
}

function LotChip({ id, qty, unitCost, dateLabel, muted }: { id: string; qty: number; unitCost: number; dateLabel?: string; muted?: boolean }) {
  return (
    <View style={[styles.lotChip, muted && styles.lotChipMuted]}>
      <Text style={[styles.lotChipId, muted && styles.lotChipTextMuted]}>{id}</Text>
      <Text style={[styles.lotChipQty, muted && styles.lotChipTextMuted]}>{qty} sh @ ₱{unitCost.toFixed(2)}</Text>
      {dateLabel && <Text style={styles.lotChipDate}>{dateLabel}</Text>}
    </View>
  );
}

function FifoQueueDiagram() {
  const { matched, remaining, costBasis, proceeds, realizedGain } = simulateFifoSell();
  return (
    <View style={styles.diagram}>
      <Text style={styles.fifoLabel}>Lot queue, oldest first:</Text>
      <View style={styles.lotRow}>
        {FIFO_LOTS.map((lot) => <LotChip key={lot.id} {...lot} />)}
      </View>

      <View style={styles.fifoSellBanner}>
        <Text style={styles.fifoSellBannerText}>SELL {FIFO_SELL_QTY} sh @ ₱{FIFO_SELL_PRICE.toFixed(2)}</Text>
      </View>

      <Text style={styles.fifoLabel}>FIFO fills the order from the front:</Text>
      <View style={styles.lotRow}>
        {matched.map((lot, i) => <LotChip key={i} id={lot.id} qty={lot.qty} unitCost={lot.unitCost} muted />)}
      </View>

      <Text style={styles.fifoLabel}>Queue after the sale:</Text>
      <View style={styles.lotRow}>
        {remaining.length > 0
          ? remaining.map((lot, i) => <LotChip key={i} id={lot.id} qty={lot.qty} unitCost={lot.unitCost} />)
          : <Text style={styles.simYield}>Fully sold - no lots left.</Text>}
      </View>

      <View style={styles.fifoResultRow}>
        <FifoStat label="Cost Basis" value={`₱${costBasis.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
        <FifoStat label="Proceeds" value={`₱${proceeds.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
        <FifoStat label="Realized Gain" value={`+₱${realizedGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} positive />
      </View>
    </View>
  );
}

function FifoStat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <View style={styles.fifoStat}>
      <Text style={styles.fifoStatLabel}>{label}</Text>
      <Text style={[styles.fifoStatValue, positive && styles.positive]}>{value}</Text>
    </View>
  );
}

// Text-only bar chart of the dividend-yield axis, 0%-9%, with each sample
// bucket drawn as a colored segment sized proportionally to its range, and
// the uncovered stretches drawn as plain gray gaps - a visual answer to
// "what does a yield bracket actually look like" for anyone who'd rather
// see the ranges than read them.
function YieldAxisDiagram() {
  const segments = buildSegments();
  return (
    <View style={styles.diagram}>
      <View style={styles.diagramBar}>
        {segments.map((seg, i) => {
          const widthPct = ((seg.high - seg.low) / (SCALE_MAX - SCALE_MIN)) * 100;
          return (
            <View
              key={i}
              style={[
                styles.diagramSegment,
                { width: `${widthPct}%`, backgroundColor: seg.kind === 'bucket' ? seg.color : colors.surfaceContainerHighest },
              ]}
            >
              {seg.kind === 'bucket' && <Text style={styles.diagramSegmentLabel}>{seg.name}</Text>}
            </View>
          );
        })}
      </View>
      <View style={styles.diagramAxisRow}>
        <Text style={styles.diagramAxisLabel}>{SCALE_MIN}%</Text>
        <Text style={styles.diagramAxisLabel}>{SCALE_MAX}%</Text>
      </View>
      <View style={styles.legendRow}>
        {SAMPLE_BUCKETS.map((b, i) => (
          <View key={b.name} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: bucketColorFor(b.name, i) }]} />
            <Text style={styles.legendText}>{b.name} · {b.low}%–{b.high}%</Text>
          </View>
        ))}
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.surfaceContainerHighest }]} />
          <Text style={styles.legendText}>No bucket covers this</Text>
        </View>
      </View>
    </View>
  );
}

export default function BucketStrategyInfoScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.header}>How the Multi-Bucket Strategy Works</Text>
      <Text style={styles.subheader}>
        A short explanation of the yield-bracket strategy this app is built around.
      </Text>

      <Section title="The problem with one broker account">
        <Body>
          Most investors keep every purchase of a stock inside a single broker account. You might buy the same
          stock in January at a 5% dividend yield, then again in April at 7% - very different valuations, but
          they land in the same pile. When you later take profits, your broker applies FIFO ("first in, first
          out"): the oldest shares are sold first, whether or not they were your best-priced purchases. FIFO
          itself isn't the problem - not being able to separate purchases by valuation is.
        </Body>
      </Section>

      <Section title="The core idea: one bucket, one yield bracket">
        <Body>
          Instead of treating a broker account as one undifferentiated portfolio, each bucket you create stands
          in for a broker account, and each bucket is defined by a low and high dividend-yield percentage - not
          just a name. A stock doesn't go into a bucket because you feel like putting it there; it goes in
          because its current dividend yield falls inside that bucket's range. Whenever a stock's yield sits
          inside a bucket's range, that bucket - and the broker account behind it - is where the next purchase
          belongs.
        </Body>
        <Text style={styles.diagramCaption}>Sample buckets plotted on a 0%–9% yield axis:</Text>
        <YieldAxisDiagram />
        <Body>
          Notice the ranges don't have to touch. A yield can land in the gap between two buckets, in which case
          nothing claims it, or it can sit above every defined range entirely - the app handles both by pointing
          you to the nearest bucket instead of forcing a match. And at a shared edge, like exactly 6.5% above,
          the rule is consistent everywhere: the low end of a range is included, the high end is not, so a
          boundary yield always rolls up into the next bucket rather than staying in the lower one.
        </Body>
      </Section>

      <Section title="Why dividend yield?">
        <Body>
          Dividend yield moves on its own as the price moves - it rises when the price falls, and falls when the
          price rises - so it works as an objective, self-updating measure of valuation rather than something you
          have to judge by eye. It's also a rough proxy for risk and business maturity: lower-yield stocks tend to
          be steadier, more established names reinvesting more of their earnings, while higher-yield stocks tend
          to be pricing in more risk or slower growth. As the market moves, a stock naturally drifts between
          buckets on its own, and you simply buy using whichever broker account matches where it currently sits.
        </Body>
      </Section>

      <Section title="Buying: yield decides the bucket">
        <Body>
          Same three sample buckets as above (B1 3%–4.5%, B2 5%–6.5%, B3 6.5%–8%), run against five made-up
          tickers through the app's actual matching logic - the same lookup that powers the "buy into this
          bucket" suggestion on a stock's detail page:
        </Body>
        <View style={styles.simList}>
          {SAMPLE_TICKERS.map((t) => (
            <SimulationRow key={t.ticker} ticker={t.ticker} yieldPct={t.yieldPct} note={t.note} />
          ))}
        </View>
        <Body>
          Every purchase made this way is automatically separated by the valuation level it was bought at, even
          when it's the exact same stock bought again and again over time.
        </Body>
      </Section>

      <Section title="Selling: choose the bucket you want to exit">
        <Body>
          This is where the separation pays off. If a stock rallies and its yield falls, you don't have to sell
          every share of it everywhere - you only sell out of the bucket whose valuation you're ready to exit.
          Your holdings in the other buckets, bought at different yields, stay invested untouched. If the market
          later pulls back and the yield returns to a bucket you'd sold out of, you just start buying into that
          bucket again - a repeatable cycle of buying, taking profits, and rebuilding, without disturbing anything
          in the other buckets.
        </Body>
      </Section>

      <Section title="FIFO decides which shares inside that bucket get sold">
        <Body>
          Choosing a bucket to sell from picks the target; FIFO decides the specifics. Within a bucket, share
          purchases are tracked as separate lots in the order you bought them, and a sale always draws from the
          oldest lot first - only spilling into the next lot if the sale is bigger than what's left in the front
          one. That matters for accuracy: cost basis and realized gain or loss depend entirely on which specific
          purchase price gets matched against the sale price. FIFO still applies here, same as a brokerage
          statement would - it just only ever applies within the bucket you chose, never across every purchase of
          that stock you've ever made.
        </Body>
        <Text style={styles.diagramCaption}>Worked example - one bucket, one ticker, three buy lots:</Text>
        <FifoQueueDiagram />
      </Section>

      <Section title="It keeps the numbers honest">
        <Body>
          Cost basis, market value, unrealized gain, and dividends earned are all tracked per bucket as well as
          portfolio-wide. That matters because averaging across very different yield tiers hides information - a
          strong quarter in your high-yield bucket can mask a weak one in your low-yield bucket, and vice versa.
          Separate buckets let you see each tier's performance on its own terms, then roll it up into a single
          portfolio view on the Dashboard when you want the whole picture.
        </Body>
      </Section>

      <Section title="A bucket can be anything you want, too">
        <Body>
          Nothing forces yield ranges to be the only axis - the mechanism just needs a low/high number pair.
          Most people use buckets purely as yield tiers, but the same structure works for any split you'd rather
          think in, as long as you're comfortable defining ranges that make sense for how you see the portfolio.
        </Body>
      </Section>

      <Section title="What this comes down to">
        <Body>
          The app isn't trying to replace your broker statements - it exists to remove the guesswork around one
          recurring question: which broker account should this purchase go into, and which one should this sale
          come out of? By organizing every purchase according to valuation instead of just by date, the same
          simple rule answers both: a stock is always bought using the broker account assigned to its current
          yield bucket, and sold from whichever bucket you're ready to exit.
        </Body>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.md, paddingBottom: 40 },
  header: { fontFamily: fonts.bodySemiBold, fontSize: 24, color: colors.onBackground, marginBottom: 4 },
  subheader: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.onSurfaceVariant, marginBottom: spacing.lg },
  section: { marginBottom: spacing.lg },
  sectionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.onSurface, marginBottom: 6 },
  body: { fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceVariant, lineHeight: 21 },

  diagramCaption: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginTop: spacing.md, marginBottom: spacing.sm },
  diagram: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant, borderRadius: radii.xl, padding: spacing.md },
  diagramBar: { flexDirection: 'row', height: 32, borderRadius: radii.lg, overflow: 'hidden' },
  diagramSegment: { height: '100%', alignItems: 'center', justifyContent: 'center' },
  diagramSegmentLabel: { fontFamily: fonts.monoBold, fontSize: 11, color: '#FFFFFF' },
  diagramAxisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  diagramAxisLabel: { fontFamily: fonts.mono, fontSize: 11, color: colors.onSurfaceVariant },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant },

  simList: { marginTop: spacing.sm },
  simRow: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.lg, padding: spacing.sm + 4, marginBottom: spacing.sm,
  },
  simRowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  simTickerBlock: { flex: 1 },
  simTicker: { fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.onSurface },
  simYield: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 1 },
  simArrow: { fontFamily: fonts.body, fontSize: 16, color: colors.onSurfaceVariant },
  simBadge: { borderRadius: radii.full, paddingHorizontal: spacing.sm + 2, paddingVertical: 4 },
  simBadgeText: { fontFamily: fonts.bodyBold, fontSize: 12, color: '#FFFFFF' },
  simBadgeTextMuted: { color: colors.onSurfaceVariant },
  simNote: { fontFamily: fonts.body, fontSize: 12, color: colors.onSurfaceVariant, marginTop: 6, lineHeight: 17 },

  positive: { color: colors.positive },
  fifoLabel: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant, marginBottom: spacing.sm },
  lotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  lotChip: {
    backgroundColor: colors.surfaceContainerHigh, borderWidth: 1, borderColor: colors.outlineVariant,
    borderRadius: radii.lg, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm, minWidth: 92,
  },
  lotChipMuted: { backgroundColor: colors.surfaceContainerHighest, opacity: 0.6 },
  lotChipId: { fontFamily: fonts.monoSemiBold, fontSize: 12, color: colors.onSurface },
  lotChipQty: { fontFamily: fonts.mono, fontSize: 11, color: colors.onSurfaceVariant, marginTop: 2 },
  lotChipDate: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.onSurfaceVariant, marginTop: 1 },
  lotChipTextMuted: { color: colors.onSurfaceVariant },
  fifoSellBanner: {
    backgroundColor: colors.surfaceContainerHigh, borderRadius: radii.lg, paddingVertical: spacing.sm,
    alignItems: 'center', marginBottom: spacing.md,
  },
  fifoSellBannerText: { fontFamily: fonts.monoBold, fontSize: 13, color: colors.primary },
  fifoResultRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  fifoStat: { flex: 1, backgroundColor: colors.surfaceContainerHigh, borderRadius: radii.lg, padding: spacing.sm },
  fifoStatLabel: { fontFamily: fonts.bodySemiBold, fontSize: 10, color: colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 },
  fifoStatValue: { fontFamily: fonts.monoSemiBold, fontSize: 13, color: colors.onSurface },
});
