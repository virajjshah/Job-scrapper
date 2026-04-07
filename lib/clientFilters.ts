import type { Job, SearchFilters } from '@/types/job';

// ─── Keyword relevance ────────────────────────────────────────────────────────

/**
 * Words that carry no signal about job relevance. Stripped before matching so
 * searches like "senior data analyst" don't require "senior" to appear literally.
 */
const STOP_WORDS = new Set([
  'a','an','the','and','or','for','in','at','to','of','is','are','with','on',
  'by','as','it','its','be','was','that','this','from','which','have','not',
  'but','will','can','do','we','our','your','all','more','about','us','no',
  'job','jobs','role','position','opportunity','opening','team','work','working',
  'based','looking','seeking','required','requirements','responsibilities',
]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns a prefix that soft-matches common inflections:
 *   analyst  → "analy"  matches analysis, analytics, analyst(s)
 *   manager  → "manag"  matches manager(s), management, managing
 *   developer→ "devel"  matches develop(er/ment/ing)
 *   marketing→ "market" matches marketing, marketer, marketplace
 *
 * Short words (≤ 4 chars) are matched exactly (whole word).
 */
function stemPrefix(word: string): string {
  if (word.length <= 4) return word;
  // Keep enough chars to be unambiguous; strip ~last 2 chars for longer words
  return word.slice(0, Math.max(4, word.length - 2));
}

/**
 * True if `term` (or its stem) appears as a whole-word prefix in `text`.
 * e.g. term="analyst" → looks for \banaly in text → matches "analytics"
 */
function termInText(term: string, text: string): boolean {
  const prefix = stemPrefix(term);
  // \b ensures we're at a word start; prefix anchors the first N chars
  const re = new RegExp(`\\b${escapeRe(prefix)}`, 'i');
  return re.test(text);
}

/**
 * Parses a raw keyword string into OR-groups of required tokens.
 *
 * Input:  "data analyst, data scientist"
 * Output: [["data","analyst"], ["data","scientist"]]
 *
 * Input:  "marketing manager OR brand manager"
 * Output: [["marketing","manager"], ["brand","manager"]]
 *
 * Quoted phrases are kept together as a single token.
 */
function parseKeywordGroups(raw: string): string[][] {
  // Split on " OR " (case-insensitive) or comma
  const segments = raw.split(/\s+OR\s+|,/i).map((s) => s.trim()).filter(Boolean);

  return segments
    .map((segment) => {
      const tokens: string[] = [];

      // Extract quoted phrases first ("senior engineer" → one token)
      const withoutQuotes = segment.replace(/"([^"]+)"/g, (_, phrase: string) => {
        const cleaned = phrase.toLowerCase().trim();
        if (cleaned) tokens.push(cleaned); // kept as-is for exact-phrase matching
        return ' ';
      });

      // Split remainder into individual words
      withoutQuotes
        .split(/\s+/)
        .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
        .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
        .forEach((w) => tokens.push(w));

      return tokens;
    })
    .filter((g) => g.length > 0);
}

/**
 * Returns true when a job is relevant to the user's keyword query.
 *
 * Logic:
 *  - Keywords are parsed into OR-groups (comma / " OR " separated).
 *  - A job passes if ALL tokens in at least ONE group appear somewhere
 *    in title + description (using stem-prefix matching).
 *  - Jobs with no parseable keyword tokens always pass (empty search).
 *  - Multi-word quoted phrases require an exact substring match.
 */
function jobMatchesKeywords(job: Job, keywords: string): boolean {
  const trimmed = keywords.trim();
  if (!trimmed) return true;

  const groups = parseKeywordGroups(trimmed);
  if (groups.length === 0) return true;

  // Combine title (included twice so title matches are weighted heavier logically)
  // and full description for the widest possible relevant text surface.
  const haystack = `${job.title} ${job.title} ${job.company} ${job.description}`;

  // Pass if ANY OR-group has every token present
  return groups.some((terms) =>
    terms.every((term) => {
      // Multi-word phrase from quoted input → exact substring match
      if (term.includes(' ')) {
        return haystack.toLowerCase().includes(term);
      }
      return termInText(term, haystack);
    })
  );
}

// ─── Date helper ─────────────────────────────────────────────────────────────

function dateWithinDays(date: Date | string | null, maxDays: number): boolean {
  if (maxDays === 0) return true;
  if (!date) return true; // unknown date → show rather than bury
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return true;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24) <= maxDays;
}

// ─── Main filter ─────────────────────────────────────────────────────────────

export function jobMatchesFilters(job: Job, filters: SearchFilters): boolean {
  // Keyword relevance — reject jobs where the search terms don't appear
  // in the title, description, or company name
  if (!jobMatchesKeywords(job, filters.keywords)) return false;

  // Work type
  if (filters.workType !== 'Any' && job.workType !== 'Any' && job.workType !== filters.workType) {
    return false;
  }

  // Employment type
  if (filters.employmentTypes.length > 0 && job.employmentType) {
    if (!filters.employmentTypes.includes(job.employmentType)) return false;
  }

  // Date posted
  if (!dateWithinDays(job.datePostedRaw, filters.datePostedDays)) return false;

  // Salary — only filter when the job actually has salary data
  // No salary detected → always passes (null = unknown = include)
  const hasSalary = job.salary !== null && (job.salary.min !== null || job.salary.max !== null);
  if (hasSalary && job.salary) {
    const jobMin = job.salary.min ?? job.salary.max ?? 0;
    const jobMax = job.salary.max ?? job.salary.min ?? Infinity;
    if (jobMax < filters.salaryMin || jobMin > filters.salaryMax) return false;
  }

  // Experience — only filter when the job actually has experience data
  const hasExp = job.yearsExperience !== null;
  if (hasExp && job.yearsExperience !== null) {
    if (job.yearsExperience < filters.expMin) return false;
    if (filters.expMax < 15 && job.yearsExperience > filters.expMax) return false;
  }

  // Industry — only filter when job has a detected industry AND user has selected industries
  if (filters.industries.length > 0 && job.industry) {
    if (!filters.industries.includes(job.industry)) return false;
  }

  return true;
}
