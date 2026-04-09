import type { SalaryInfo } from '@/types/job';

const COMMISSION_PATTERNS = [
  /\bcommission\b/i,
  /\bOTE\b/,
  /\bon[\s-]target[\s-]earnings?\b/i,
  /\bbonus\b/i,
  /\bincentive[\s-]pay\b/i,
  /\bvariable[\s-]comp(?:ensation)?\b/i,
];

const HOURLY_PATTERNS = [
  /\$[\d,]+(?:\.\d{1,2})?(?:\s*[-\u2013\u2014]\s*\$[\d,]+(?:\.\d{1,2})?)?\s*\/?(?:per\s+)?h(?:our|r)\b/i,
  /\$[\d,]+(?:\.\d{1,2})?\s*(?:an?|per)\s+hour/i,
  /\b[\d,]+(?:\.\d{1,2})?\s*(?:[-\u2013\u2014]|to)\s*[\d,]+(?:\.\d{1,2})?\s*\/?(?:per\s+)?h(?:our|r)\b/i,
  /CA\$[\d,]+(?:\.\d{1,2})?(?:\s*[-\u2013\u2014]\s*CA\$[\d,]+(?:\.\d{1,2})?)?\s*\/h(?:r|our)/i,
  /£[\d,]+(?:\.\d{1,2})?\s*(?:[-\u2013\u2014]|to)\s*£?[\d,]+(?:\.\d{1,2})?\s*\/?(?:per\s+)?h(?:our|r)\b/i,
  /€[\d,]+(?:\.\d{1,2})?\s*(?:[-\u2013\u2014]|to)\s*€?[\d,]+(?:\.\d{1,2})?\s*\/?(?:per\s+)?h(?:our|r)\b/i,
];

// Shared number token: (digits)(optional K suffix)
const N = `([\\d,]+(?:\\.\\d{1,2})?)\\s*(K|k)?`;
// Range separator: -, –, —, or "to"
const S = `\\s*(?:[-\\u2013\\u2014]|\\bto\\b)\\s*`;

/**
 * All patterns must produce exactly 4 capture groups: (num1)(K1)(num2)(K2)
 * They are tried in order — most specific first.
 */
const RANGE_PATTERNS: RegExp[] = [
  // 1. CA$70K/yr – CA$75K/yr  (LinkedIn chip)
  new RegExp(`CA\\$\\s*${N}(?:/yr|/year|/hour|/hr)?${S}CA\\$?\\s*${N}(?:/yr|/year|/hour|/hr)?`, 'i'),
  // 2. $60K – $80K | $60,000 – $80,000 | $60–65/hr
  new RegExp(`\\$\\s*${N}${S}\\$?\\s*${N}`, 'i'),
  // 3. between $60K and $80K | from $60,000 to $80,000
  new RegExp(`(?:between|from)\\s+\\$?\\s*${N}\\s+(?:and|to)\\s+\\$?\\s*${N}`, 'i'),
  // 4. CAD 60,000 – 80,000 | CAD $60K – $80K
  new RegExp(`\\bCAD\\s*\\$?\\s*${N}${S}\\$?\\s*${N}`, 'i'),
  // 5. USD 60,000 – 80,000 | US$60K – 80K
  new RegExp(`(?:\\bUSD\\b|US\\$)\\s*${N}${S}(?:\\bUSD\\b|US\\$)?\\s*${N}`, 'i'),
  // 6. £45K – £60K | £45,000 – £60,000  (GBP)
  new RegExp(`£\\s*${N}${S}£?\\s*${N}`, 'i'),
  // 7. €45K – €60K | €45,000 – €60,000  (EUR)
  new RegExp(`€\\s*${N}${S}€?\\s*${N}`, 'i'),
  // 8. GBP/EUR keyword: GBP 45,000 – 60,000
  new RegExp(`(?:\\bGBP\\b|\\bEUR\\b)\\s*${N}${S}(?:\\bGBP\\b|\\bEUR\\b)?\\s*${N}`, 'i'),
  // 9. Comma-formatted plain numbers: 45,000 – 60,000 [near year/currency context or end of line]
  new RegExp(
    `(?<![\\d,])(\\d{2,3},\\d{3})\\s*(K|k)?${S}(\\d{2,3},\\d{3})\\s*(K|k)?(?=\\s*(?:/yr|/year|\\byr\\b|per\\s+year|annually|per\\s+annum|\\bCAD\\b|\\bUSD\\b|\\bGBP\\b|\\bEUR\\b|\\s*$))`,
    'i'
  ),
  // 10. Plain 5-6-digit numbers near salary context: salary: 45000 to 60000
  new RegExp(
    `(?:salary|compensation|pay|wage|remuneration|package)[^\\d]{0,20}(\\d{4,6})\\s*(K|k)?${S}(\\d{4,6})\\s*(K|k)?`,
    'i'
  ),
];

const SINGLE_VALUE_PATTERNS: RegExp[] = [
  /CA\$\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k)?(?:\/yr|\/year|\/hr|\/hour)?/i,
  /(?:CAD\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k|M|m)?(?:\s*(?:\/yr|\/year|per year|annually|\/hr|\/hour|per hour))?/i,
  /£\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k)?(?:\/yr|\/year|\/hr|\/hour)?/i,
  /€\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k)?(?:\/yr|\/year|\/hr|\/hour)?/i,
  /(?:\bUSD\b|US\$)\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k)?(?:\/yr|\/year|\/hr|\/hour)?/i,
  // "52,500 CAD" / "22,500 USD" — number BEFORE currency code (no $ prefix)
  /(?<!\d)([\d,]{5,}(?:\.\d{1,2})?)\s*(K|k)?\s*(?:CAD|USD|GBP|EUR)\b/i,
];

function detectCurrency(text: string): string {
  if (/CA\$|CAD\b|\bC\$/.test(text)) return 'CAD';
  if (/£|\bGBP\b/.test(text)) return 'GBP';
  if (/€|\bEUR\b/.test(text)) return 'EUR';
  if (/\bUSD\b|US\$/.test(text)) return 'USD';
  return 'CAD';
}

function parseNumber(raw: string, kSuffix: boolean): number {
  const cleaned = raw.replace(/,/g, '');
  const value = parseFloat(cleaned);
  return kSuffix ? value * 1000 : value;
}

/** Try to pull a dollar amount from a commission/bonus sentence and format it. */
function extractVariableAmount(text: string, keyword: 'commission' | 'bonus'): string | null {
  const patterns = [
    // "commission pay is 22,500 CAD" / "commission target of $25,000"
    new RegExp(`${keyword}\\s+(?:pay|target|of|:)?\\s*(?:is\\s+)?(?:CA\\$|\\$|£|€)?\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s*(K|k)?\\s*(?:CAD|USD|GBP|EUR)?`, 'i'),
    // "$25,000 commission" / "22,500 CAD commission"
    new RegExp(`(?:CA\\$|\\$|£|€)?\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s*(K|k)?\\s*(?:CAD|USD)?\\s+(?:uncapped\\s+)?${keyword}`, 'i'),
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = parseNumber(m[1], !!(m[2] && /k/i.test(m[2])));
      if (!isNaN(val) && val >= 1000 && val < 1_000_000) {
        const formatted = val >= 1000 ? `$${(val / 1000).toFixed(val % 1000 !== 0 ? 1 : 0)}K` : `$${val}`;
        return `${formatted} ${keyword}`;
      }
    }
  }
  return null;
}

function detectCommission(text: string): { hasCommission: boolean; note: string | null } {
  for (const pattern of COMMISSION_PATTERNS) {
    if (pattern.test(text)) {
      if (/commission/i.test(text)) {
        const amt = extractVariableAmount(text, 'commission');
        return { hasCommission: true, note: amt ?? 'Base + Commission' };
      }
      if (/bonus/i.test(text)) {
        const amt = extractVariableAmount(text, 'bonus');
        return { hasCommission: true, note: amt ?? 'Base + Bonus' };
      }
      return { hasCommission: true, note: 'Variable Compensation' };
    }
  }
  return { hasCommission: false, note: null };
}

function hourlyToAnnual(hourly: number): number {
  return Math.round(hourly * 40 * 52);
}

export function parseSalary(text: string): SalaryInfo | null {
  if (!text || text.trim().length === 0) return null;

  const { hasCommission, note: commissionNote } = detectCommission(text);
  const currency = detectCurrency(text);

  // Hourly detection — /yr overrides it (CA$70K/yr is annual, not hourly)
  const hasYearSuffix = /\/yr\b|\/year\b|\bper\s+year\b|\bannually\b|\bper\s+annum\b/i.test(text);
  const isHourly = !hasYearSuffix && HOURLY_PATTERNS.some((p) => p.test(text));

  // Try range patterns first
  for (const pattern of RANGE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    // All patterns: groups 1,2,3,4 = num1, K1, num2, K2
    const rawMin = match[1];
    const k1    = match[2];
    const rawMax = match[3];
    const k2    = match[4];

    if (!rawMin || !rawMax) continue;

    let min = parseNumber(rawMin, !!(k1 && /k/i.test(k1)));
    let max = parseNumber(rawMax, !!(k2 && /k/i.test(k2)));

    // "$60,000–80" means "$60K–$80K"
    if (min > 1000 && max < 1000 && max > 0) max = max * 1000;

    if (isNaN(min) || isNaN(max) || min <= 0 || max <= 0) continue;
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    if (lo < 10 || hi > 10_000_000) continue;
    // Reject if range looks like years or other non-salary numbers
    if (!isHourly && hi < 1000 && lo < 1000) continue;

    return {
      min: isHourly ? hourlyToAnnual(lo) : lo,
      max: isHourly ? hourlyToAnnual(hi) : hi,
      currency,
      period: 'annual',
      isEstimated: isHourly,
      hasCommission,
      commissionNote,
      raw: text,
    };
  }

  // Single value
  for (const pattern of SINGLE_VALUE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const value = parseNumber(match[1], !!(match[2] && /k/i.test(match[2])));
      if (isNaN(value) || value <= 0 || value < 10) continue;
      const annualValue = isHourly ? hourlyToAnnual(value) : value;
      return {
        min: annualValue,
        max: annualValue,
        currency,
        period: 'annual',
        isEstimated: isHourly,
        hasCommission,
        commissionNote,
        raw: text,
      };
    }
  }

  if (hasCommission) {
    return {
      min: null,
      max: null,
      currency,
      period: 'annual',
      isEstimated: false,
      hasCommission: true,
      commissionNote,
      raw: text,
    };
  }

  return null;
}

export function formatSalaryDisplay(info: SalaryInfo | null): string {
  if (!info) return 'Not specified';

  const sym = info.currency === 'GBP' ? '£' : info.currency === 'EUR' ? '€' : '$';
  // Only format values that are real, non-zero numbers
  const fmt = (n: number) => `${sym}${(n / 1000).toFixed(0)}K`;

  const hasMin = info.min != null && info.min > 0;
  const hasMax = info.max != null && info.max > 0;

  let base = '';
  if (hasMin && hasMax) {
    base = info.min === info.max
      ? fmt(info.min!)
      : `${fmt(info.min!)}\u2013${fmt(info.max!)}`;
  } else if (hasMax) {
    base = fmt(info.max!);
  } else if (hasMin) {
    base = fmt(info.min!);
  }

  const suffix = info.isEstimated ? ' ~est.' : '';
  const commission = info.commissionNote ? ` (${info.commissionNote})` : '';

  if (!base && info.hasCommission) return info.commissionNote ?? 'Commission-based';
  if (!base) return 'Not specified';

  return `${base}${suffix}${commission}`;
}
