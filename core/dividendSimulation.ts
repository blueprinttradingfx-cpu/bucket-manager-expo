// core/dividendSimulation.ts
// Turns a ticker's real dividend-history.json entries into simulated CASH
// DIVIDEND amounts for a manually-tracked position, based on how many
// shares were actually held on each dividend's ex-date. This is what
// makes "manually added transactions" produce realistic dividends-earned
// numbers instead of zero - without it, a manual BUY has no dividend
// income at all unless you type in every historical payment by hand.

import { DividendHistoryEntry } from './dividendHistory';
import { parseIsoDate, parseMonthNameDate } from './dateUtils';

export interface SimpleTxn {
  date: string; // YYYY-MM-DD
  type: 'BUY' | 'SELL';
  quantity: number;
}

export interface SimulatedDividend {
  date: string;     // payment date (YYYY-MM-DD) - when the cash is simulated to land
  exDate: string;    // original ex-date string, kept for display/debugging
  quantityHeld: number;
  perShareAmount: number;
  totalAmount: number;
}

/** Running share count as of a given date (inclusive) - NOT FIFO-lot-aware,
 *  unlike bucketLogic's computeHoldings. Dividend eligibility only cares
 *  about total shares held on the ex-date, not which specific lot they
 *  came from, so a simple running total is the right level of detail here.
 *
 *  Transactions with an unparseable date are skipped (contribute 0) rather
 *  than throwing - see simulateDividends' `unparseableTxnDates` return
 *  value for how callers surface this instead of just silently getting
 *  zero eligible dividends with no explanation. */
function quantityHeldAsOf(txns: SimpleTxn[], asOfDate: Date): number {
  return txns.reduce((total, t) => {
    const txnDate = parseIsoDate(t.date);
    if (txnDate === null || txnDate > asOfDate) return total;
    return total + (t.type === 'BUY' ? t.quantity : -t.quantity);
  }, 0);
}

export interface SimulationResult {
  dividends: SimulatedDividend[];
  /** Transaction dates that couldn't be parsed as strict YYYY-MM-DD - if
   *  this is non-empty, `dividends` may be incomplete or empty even when
   *  the ticker genuinely has eligible dividend history, because those
   *  transactions were excluded from the running share count entirely
   *  rather than guessed at. Surface these to the person so they can fix
   *  the transaction's date instead of wondering why nothing simulated. */
  unparseableTxnDates: string[];
}

/** Simulates dividend payments for one ticker given its manual BUY/SELL
 *  transactions and its real dividend history. Skips: non-"Paid" entries
 *  (declared-but-not-yet-paid dividends shouldn't be booked as income
 *  yet), entries with an unparseable ex-date, and ex-dates where zero
 *  shares were held (not eligible). */
export function simulateDividends(txns: SimpleTxn[], history: DividendHistoryEntry[]): SimulationResult {
  const unparseableTxnDates = [...new Set(txns.filter((t) => parseIsoDate(t.date) === null).map((t) => t.date))];

  const dividends: SimulatedDividend[] = [];
  for (const entry of history) {
    if (entry.status !== 'Paid') continue;
    const exDate = parseMonthNameDate(entry.exDate);
    if (exDate === null) continue;

    const quantityHeld = quantityHeldAsOf(txns, exDate);
    if (quantityHeld <= 0) continue;

    const paymentDate = parseMonthNameDate(entry.paymentDate);
    const isoDate = paymentDate !== null
      ? toIsoString(paymentDate)
      : toIsoString(exDate); // fall back to ex-date if paymentDate is unparseable

    dividends.push({
      date: isoDate,
      exDate: entry.exDate,
      quantityHeld,
      perShareAmount: entry.amount,
      totalAmount: Math.round(quantityHeld * entry.amount * 100) / 100,
    });
  }
  return { dividends, unparseableTxnDates };
}

function toIsoString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
