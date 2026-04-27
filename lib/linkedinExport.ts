import type { Job } from '@/types/job';

const BOLD_UPPER_BASE = 0x1d400;
const BOLD_LOWER_BASE = 0x1d41a;
const BOLD_DIGIT_BASE = 0x1d7ce;

export function toLinkedInBold(text: string): string {
  return Array.from(text).map((ch) => {
    const c = ch.codePointAt(0)!;
    if (c >= 65 && c <= 90) return String.fromCodePoint(BOLD_UPPER_BASE + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(BOLD_LOWER_BASE + c - 97);
    if (c >= 48 && c <= 57) return String.fromCodePoint(BOLD_DIGIT_BASE + c - 48);
    return ch;
  }).join('');
}

const CA_PROVINCES = new Set([
  'ON', 'BC', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'NT', 'YT', 'NU',
]);
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  'WI','WY','DC',
]);
const AU_STATES = new Set(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']);

export function getCountryFlag(location: string): string {
  const upper = location.toUpperCase();
  if (/\bCANADA\b/.test(upper)) return '🇨🇦';
  if (/\b(UNITED STATES|USA|U\.S\.A)\b/.test(upper)) return '🇺🇸';
  if (/\b(UNITED KINGDOM|ENGLAND|SCOTLAND|WALES|NORTHERN IRELAND)\b/.test(upper)) return '🇬🇧';
  if (/\bAUSTRALIA\b/.test(upper)) return '🇦🇺';
  if (/\b(GERMANY|DEUTSCHLAND)\b/.test(upper)) return '🇩🇪';
  if (/\bFRANCE\b/.test(upper)) return '🇫🇷';
  if (/\bINDIA\b/.test(upper)) return '🇮🇳';
  if (/\bSINGAPORE\b/.test(upper)) return '🇸🇬';
  if (/\b(NETHERLANDS|HOLLAND)\b/.test(upper)) return '🇳🇱';
  if (/\bIRELAND\b/.test(upper)) return '🇮🇪';

  // Match trailing province/state code, e.g. "Toronto, ON" or "New York, NY"
  const codeMatch = location.match(/,\s*([A-Z]{2,3})\s*$/i);
  if (codeMatch) {
    const code = codeMatch[1].toUpperCase();
    if (CA_PROVINCES.has(code)) return '🇨🇦';
    if (US_STATES.has(code)) return '🇺🇸';
    if (AU_STATES.has(code)) return '🇦🇺';
  }

  // City keywords
  if (/\b(LONDON|MANCHESTER|BIRMINGHAM|GLASGOW|EDINBURGH|BRISTOL|LIVERPOOL)\b/.test(upper)) return '🇬🇧';
  if (/\b(SYDNEY|MELBOURNE|BRISBANE|PERTH|ADELAIDE)\b/.test(upper)) return '🇦🇺';
  if (/\b(BERLIN|MUNICH|MÜNCHEN|HAMBURG|FRANKFURT|COLOGNE|DÜSSELDORF)\b/.test(upper)) return '🇩🇪';
  if (/\b(PARIS|LYON|MARSEILLE)\b/.test(upper)) return '🇫🇷';
  if (/\b(MUMBAI|BANGALORE|BENGALURU|DELHI|HYDERABAD|CHENNAI|PUNE)\b/.test(upper)) return '🇮🇳';

  return '🌍';
}

function formatSalary(job: Job): string {
  if (!job.salary) return toLinkedInBold('Not listed');
  const { min, max } = job.salary;
  if (min && max) return toLinkedInBold(`$${min.toLocaleString()} – $${max.toLocaleString()} CAD`);
  if (max) return toLinkedInBold(`Up to $${max.toLocaleString()} CAD`);
  if (min) return toLinkedInBold(`From $${min.toLocaleString()} CAD`);
  return job.salaryDisplay ? toLinkedInBold(job.salaryDisplay) : toLinkedInBold('Not listed');
}

export function formatJobsAsLinkedInText(jobs: Job[], keywords: string): string {
  const header = `Job Search: ${keywords || 'All'} — ${jobs.length} result${jobs.length !== 1 ? 's' : ''}`;
  const divider = '─'.repeat(60);

const NUMBER_EMOJIS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
function toNumberEmoji(n: number): string {
  return n >= 1 && n <= 10 ? NUMBER_EMOJIS[n - 1] : `${n}.`;
}

  const lines = jobs.map((job, i) => {
    const flag = getCountryFlag(job.location);
    const link = job.applyUrl ?? job.sourceUrl;
    return [
      `${toNumberEmoji(i + 1)} ${job.title}`,
      job.company,
      formatSalary(job),
      `${job.location} ${flag}`,
      link,
    ].join(' | ');
  });

  return [header, divider, ...lines].join('\n');
}
