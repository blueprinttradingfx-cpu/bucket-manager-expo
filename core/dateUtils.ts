// core/dateUtils.ts
// Deterministic date parsing, used anywhere a date STRING needs to become
// a comparable Date. Deliberately does NOT use `new Date(someString)` for
// anything other than exact "YYYY-MM-DD" - per the ECMAScript spec, only
// that exact extended ISO form is guaranteed to parse consistently across
// engines. Anything else (a bare year like "2024", a month-name format
// like "Aug 13, 2024", slash-separated dates, etc.) is "implementation-
// defined" - V8 (Node, this dev environment) tends to be lenient about it,
// but React Native's actual runtime engine (Hermes) isn't guaranteed to
// parse the same string the same way. Building Date objects from parsed
// numeric components via `new Date(year, monthIndex, day)` instead avoids
// this entirely - that constructor form is unambiguous on every engine.

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Parses a strict "YYYY-MM-DD" string. Returns null (not an Invalid Date)
 *  for anything else, including a bare year ("2024"), a full-but-wrong
 *  separator ("2024/01/01"), or missing components - so callers can
 *  distinguish "not a date at all" from "a date, just not this one." */
export function parseIsoDate(s: string | null | undefined): Date | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const monthIndex = Number(mo) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  const date = new Date(Number(y), monthIndex, Number(d));
  // Guards against e.g. "2024-02-31" silently rolling over to March 2nd -
  // new Date() normalizes out-of-range days instead of rejecting them.
  if (date.getFullYear() !== Number(y) || date.getMonth() !== monthIndex || date.getDate() !== Number(d)) {
    return null;
  }
  return date;
}

/** Parses dividend-history.json's "MMM DD, YYYY" format (e.g. "Aug 13, 2024"),
 *  for the same cross-engine determinism reason as parseIsoDate. */
export function parseMonthNameDate(s: string): Date | null {
  const m = s.trim().match(/^([A-Za-z]{3})\w*\s+(\d{1,2}),?\s*(\d{4})$/);
  if (!m) return null;
  const [, monStr, d, y] = m;
  const monthIndex = MONTH_NAMES.indexOf(monStr.toLowerCase());
  if (monthIndex === -1) return null;
  return new Date(Number(y), monthIndex, Number(d));
}

/** True if `s` is a strict, valid "YYYY-MM-DD" date string - used to
 *  validate manual transaction date entry so a malformed date (like a
 *  bare "2024") gets caught at entry time instead of silently producing
 *  zero simulated dividends later with no clear reason why. */
export function isValidIsoDate(s: string | null | undefined): boolean {
  return parseIsoDate(s) !== null;
}
