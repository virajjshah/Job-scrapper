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
  /\$[\d,]+(?:\.\d{1,2})?(?:\s*[-–]\s*\$[\d,]+(?:\.\d{1,2})?)?\s*\/?\s*(?:per\s+)?h(?:our|r)/i,
  /\$[\d,]+(?:\.\d{1,2})?\s*(?:an?|per)\s+hour/i,
];

const ANNUAL_PATTERNS = [
  /\$[\d,]+(?:K|k|,000)?(?:\s*[-–]\s*\$[\d,]+(?:K|k|,000)?)?\s*\/?\s*(?:per\s+)?(?:year|yr|annum|annual)/i,
  /(?:annual|yearly)\s+salary.*?\$[\d,]+/i,
  /salary.*?\$[\d,.]+\s*(?:K|k)?/i,
];

const RANGE_PATTERNS = [
  /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:K|k)?\s*(?:[-–]|to)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k)?/i,
  /(?:between|from)\s+\$\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k)?\s+(?:and|to)\s+\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k)?/i,
];

const SINGLE_VALUE_PATTERNS = [
  /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k|M|m)?(?:\s*(?:\/yr|\/year|per year|annually|\/hr|\/hour|per hour))?/i,
];

function parseNumber(raw: string, kSuffix: boolean): number {
  const cleaned = raw.replace(/,/g, '');
  const value = parseFloat(cleaned);
  return kSuffix ? value * 1000 : value;
}

function detectCommission(text: string): { hasCommission: boolean; note: string | null } {
  for (const pattern of COMMISSION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
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

export function parseSalary(text: string): SalaryInfo | null {
  if (!text || text.trim().length === 0) return null;

  const { hasCommission, note: commissionNote } = detectCommission(text);

  // Detect if hourly
  const isHourly = HOURLY_PATTERNS.some((p) => p.test(text));

  // Try to extract a range first
  for (const pattern of RANGE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      let min: number;
      let max: number;

      if (match.length >= 5) {
        // between X K and Y K pattern
        min = parseNumber(match[1], !!(match[2] && /k/i.test(match[2])));
        max = parseNumber(match[3], !!(match[4] && /k/i.test(match[4])));
      } else {
        min = parseNumber(match[1], !!(match[2] && /k/i.test(match[2])));
        max = parseNumber(match[2] && /\d/.test(match[2]) ? match[2] : match[3], !!(match[3] && /k/i.test(match[3])));
      }

      // Sanity check – avoid bad parses
      if (isNaN(min) || isNaN(max) || min <= 0 || max <= 0) continue;
      if (min > max) [min, max] = [max, min];

      if (isHourly) {
        return {
          min: hourlyToAnnual(min),
          max: hourlyToAnnual(max),
          currency: 'CAD',
          period: 'annual',
          isEstimated: true,
          hasCommission,
          commissionNote,
          raw: text,
        };
      }

      // If both values look like annual (> 1000) treat as annual, else may be K
      return {
        min,
        max,
        currency: 'CAD',
        period: 'annual',
        isEstimated: false,
        hasCommission,
        commissionNote,
        raw: text,
      };
    }
  }

  // Try single value
  for (const pattern of SINGLE_VALUE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const value = parseNumber(match[1], !!(match[2] && /k/i.test(match[2])));
      if (isNaN(value) || value <= 0) continue;

      const annualValue = isHourly ? hourlyToAnnual(value) : value;

      return {
        min: annualValue,
        max: annualValue,
        currency: 'CAD',
        period: 'annual',
        isEstimated: isHourly,
        hasCommission,
        commissionNote,
        raw: text,
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
      raw: text,
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
      base = `${fmt(info.min)} – ${fmt(info.max)}`;
    }
  }

  const suffix = info.isEstimated ? ' ~est.' : '';
  const commission = info.commissionNote ? ` (${info.commissionNote})` : '';

  if (!base && info.hasCommission) return info.commissionNote ?? 'Commission-based';
  if (!base) return 'Not listed';

  return `${base}${suffix}${commission}`;
}
