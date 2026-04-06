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
  // $60 - $65/hr  or  $25/hour  or  $25 an hour  or  CA$25/hr
  /\$[\d,]+(?:\.\d{1,2})?(?:\s*[-\u2013\u2014]\s*\$[\d,]+(?:\.\d{1,2})?)?\s*\/?(?:per\s+|an?\s+)?h(?:our|r)\b/i,
  /CA\$[\d,]+(?:\.\d{1,2})?(?:\s*[-\u2013\u2014]\s*CA\$[\d,]+(?:\.\d{1,2})?)?\s*\/h(?:r|our)/i,
  // $25 an hour / $25 per hour (no slash)
  /\$[\d,]+(?:\.\d{1,2})?\s*(?:an?|per)\s+hour/i,
  // 25 - 30 per hour (no $)
  /\b[\d,]+(?:\.\d{1,2})?\s*(?:[-\u2013\u2014]|to)\s*[\d,]+(?:\.\d{1,2})?\s*\/?(?:per\s+|an?\s+)?h(?:our|r)\b/i,
  // $25 - $35 an hour (range then period)
  /\$[\d,]+(?:\.\d{1,2})?\s*[-\u2013\u2014]\s*\$[\d,]+(?:\.\d{1,2})?\s+an?\s+hour/i,
];

const MONTHLY_PATTERNS = [
  /\$[\d,]+(?:\.\d{1,2})?(?:\s*[-\u2013\u2014]\s*\$[\d,]+(?:\.\d{1,2})?)?\s*\/\s*(?:month|mo)\b/i,
  /\$[\d,]+(?:\.\d{1,2})?(?:\s*[-\u2013\u2014]\s*\$[\d,]+(?:\.\d{1,2})?)?\s*(?:per|a)\s+month\b/i,
  /CA\$[\d,]+(?:\.\d{1,2})?(?:\s*[-\u2013\u2014]\s*CA\$[\d,]+(?:\.\d{1,2})?)?\s*\/\s*(?:month|mo)\b/i,
  /\bper\s+month\b/i,
  // "per month" in JSON-LD output
  /\$[\d,]+(?:\.\d{1,2})?.*\bper\s+month\b/i,
];

// Range separator: dash / en-dash / em-dash / "to"
const SEP = `\\s*(?:[-\\u2013\\u2014]|\\bto\\b)\\s*`;
// Numeric token with optional $ prefix and optional K suffix (captures num + K)
function numTok(prefix = '\\$?') {
  return `${prefix}\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s*(K|k)?`;
}

const RANGE_PATTERNS: RegExp[] = [
  // CA$70K/yr – CA$75K/yr  (LinkedIn card chip format)
  /CA\$\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k)?(?:\/yr|\/year|\/hour|\/hr|\/month|\/mo)?\s*(?:[-\u2013\u2014]|to)\s*CA\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k)?(?:\/yr|\/year|\/hour|\/hr|\/month|\/mo)?/i,
  // $60K – $80K  |  $60,000 – $80,000  |  $60K – 80K  |  $60–65/hr
  new RegExp(`\\$\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s*(K|k)?${SEP}\\$?\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s*(K|k)?`, 'i'),
  // between $60K and $80K  |  from $60,000 to $80,000
  new RegExp(`(?:between|from)\\s+\\$\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s*(K|k)?\\s+(?:and|to)\\s+\\$?\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s*(K|k)?`, 'i'),
  // CAD 60,000 – 80,000  |  CAD $60K – $80K
  new RegExp(`\\bCAD\\s*\\$?\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s*(K|k)?${SEP}\\$?\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s*(K|k)?`, 'i'),
  // 60,000 – 80,000 [per year/annually/CAD/yr]  — comma-formatted, no $ needed
  new RegExp(`(?<![\\d,])([\\d]{2,3},[\\d]{3})\\s*(K|k)?${SEP}([\\d]{2,3},[\\d]{3})\\s*(K|k)?(?=\\s*(?:\\/yr|\\/year|\\byr\\b|per\\s+year|a\\s+year|annually|per\\s+annum|\\bCAD\\b|\\bUSD\\b|\\s*$))`, 'i'),
];

const SINGLE_VALUE_PATTERNS: RegExp[] = [
  // CA$80K/yr or $80,000/yr or CAD $80K
  /CA\$\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k)?(?:\/yr|\/year|\/hr|\/hour|\/month|\/mo)?/i,
  /(?:CAD\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k|M|m)?(?:\s*(?:\/yr|\/year|per year|a year|annually|\/hr|\/hour|per hour|an hour|\/month|\/mo|per month))?/i,
];

/** Strip Glassdoor/employer estimation parentheticals before parsing */
function normalizeText(text: string): string {
  return text
    .replace(/\((?:Employer|Glassdoor|Company|Indeed)\s+est\.?\)/gi, '')
    .replace(/\bEst(?:imated)?\.?\b/gi, '')
    .trim();
}

function parseNumber(raw: string, kSuffix: boolean): number {
  const cleaned = raw.replace(/,/g, '');
  const value = parseFloat(cleaned);
  return kSuffix ? value * 1000 : value;
}

function detectCommission(text: string): { hasCommission: boolean; note: string | null } {
  for (const pattern of COMMISSION_PATTERNS) {
    if (pattern.test(text)) {
      if (/\bOTE\b/.test(text)) return { hasCommission: true, note: 'OTE' };
      if (/commission/i.test(text)) return { hasCommission: true, note: 'Base + Commission' };
      if (/bonus/i.test(text)) return { hasCommission: true, note: 'Base + Bonus' };
      return { hasCommission: true, note: 'Variable Compensation' };
    }
  }
  return { hasCommission: false, note: null };
}

function hourlyToAnnual(hourly: number): number {
  return Math.round(hourly * 40 * 52);
}

function monthlyToAnnual(monthly: number): number {
  return Math.round(monthly * 12);
}

export function parseSalary(rawText: string): SalaryInfo | null {
  if (!rawText || rawText.trim().length === 0) return null;

  const text = normalizeText(rawText);

  const { hasCommission, note: commissionNote } = detectCommission(text);

  // Detect annual/hourly/monthly period
  // Annual: /yr, /year, per year, annually, per annum, a year
  const hasYearSuffix = /\/yr\b|\/year\b|\bper\s+year\b|\bannually\b|\bper\s+annum\b|\ba\s+year\b/i.test(text);
  // Monthly: /month, per month, a month
  const hasMonthSuffix = !hasYearSuffix && MONTHLY_PATTERNS.some((p) => p.test(text));
  // Hourly: override by year suffix
  const isHourly = !hasYearSuffix && !hasMonthSuffix && HOURLY_PATTERNS.some((p) => p.test(text));

  // Try to extract a range first
  for (const pattern of RANGE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    // All patterns produce 4 capture groups: num1, K1, num2, K2
    const rawMin = match[1];
    const k1 = match[2];
    const rawMax = match[3];
    const k2 = match[4];

    if (!rawMin || !rawMax) continue;

    let min = parseNumber(rawMin, !!(k1 && /k/i.test(k1)));
    let max = parseNumber(rawMax, !!(k2 && /k/i.test(k2)));

    // Heuristic: if min is full value (e.g. 60000) and max is suspiciously small (e.g. 80),
    // it was probably written as $60,000–80 meaning $60K–$80K
    if (min > 1000 && max < 1000 && max > 0) max = max * 1000;

    if (isNaN(min) || isNaN(max) || min <= 0 || max <= 0) continue;
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    // Sanity: both values should be plausible salaries
    if (lo < 10 || hi > 10_000_000) continue;

    if (isHourly) {
      return {
        min: hourlyToAnnual(lo),
        max: hourlyToAnnual(hi),
        currency: 'CAD',
        period: 'annual',
        isEstimated: true,
        hasCommission,
        commissionNote,
        raw: rawText,
      };
    }

    if (hasMonthSuffix) {
      return {
        min: monthlyToAnnual(lo),
        max: monthlyToAnnual(hi),
        currency: 'CAD',
        period: 'annual',
        isEstimated: true,
        hasCommission,
        commissionNote,
        raw: rawText,
      };
    }

    return {
      min: lo,
      max: hi,
      currency: 'CAD',
      period: 'annual',
      isEstimated: false,
      hasCommission,
      commissionNote,
      raw: rawText,
    };
  }

  // Try single value
  for (const pattern of SINGLE_VALUE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const value = parseNumber(match[1], !!(match[2] && /k/i.test(match[2])));
      if (isNaN(value) || value <= 0) continue;

      // Sanity check: single values should be > $10 (hourly min) or > $1000 (annual min)
      if (isHourly && value < 5) continue;
      if (!isHourly && !hasMonthSuffix && value < 1000 && value > 0) continue;

      let annualValue: number;
      if (isHourly) {
        annualValue = hourlyToAnnual(value);
      } else if (hasMonthSuffix) {
        annualValue = monthlyToAnnual(value);
      } else {
        annualValue = value;
      }

      return {
        min: annualValue,
        max: annualValue,
        currency: 'CAD',
        period: 'annual',
        isEstimated: isHourly || hasMonthSuffix,
        hasCommission,
        commissionNote,
        raw: rawText,
      };
    }
  }

  // Commission/bonus mentioned but no dollar figure found
  if (hasCommission) {
    return {
      min: null,
      max: null,
      currency: 'CAD',
      period: 'annual',
      isEstimated: false,
      hasCommission: true,
      commissionNote,
      raw: rawText,
    };
  }

  return null;
}

export function formatSalaryDisplay(info: SalaryInfo | null): string {
  if (!info) return 'Not listed';

  const fmt = (n: number | null) =>
    n != null ? `$${(n / 1000).toFixed(0)}K` : '';

  let base = '';
  if (info.min != null && info.max != null) {
    if (info.min === info.max) {
      base = fmt(info.min);
    } else {
      base = `${fmt(info.min)} \u2013 ${fmt(info.max)}`;
    }
  }

  const suffix = info.isEstimated ? ' ~est.' : '';
  const commission = info.commissionNote ? ` (${info.commissionNote})` : '';

  if (!base && info.hasCommission) return info.commissionNote ?? 'Commission-based';
  if (!base) return 'Not listed';

  return `${base}${suffix}${commission}`;
}
