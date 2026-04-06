/**
 * Experience parser — scans full job description text including requirements
 * sections buried deep in postings.
 */

// Section headers that commonly precede experience requirements
const SECTION_HEADERS = [
  'requirements?',
  'qualifications?',
  'what you(?:\'ll)? bring',
  'what we(?:\'re)? looking for',
  'must[- ]have',
  'preferred',
  'experience(?:\\s+required)?',
  'required\\s+experience',
  'basic\\s+qualifications?',
  'minimum\\s+qualifications?',
  'preferred\\s+qualifications?',
  'key\\s+requirements?',
  'core\\s+requirements?',
  'job\\s+requirements?',
  'skills? (?:and|&) experience',
  'about you',
  'who you are',
  'what you(?:\'ll)? need',
  'what you(?:\'ll)? have',
  'you(?:\'ll)? have',
  'you(?:\'ll)? bring',
  'ideal candidate',
];

// Capture up to 1000 chars after each section header
const SECTION_RE = new RegExp(
  `(?:${SECTION_HEADERS.join('|')})[:\\s]*([\\s\\S]{0,1000})`,
  'gi'
);

// Core numeric patterns (order matters — most specific first)
const RANGE_RE =
  /(\d+)\s*(?:to|-|–|\/|or\s+more\s+to)\s*(\d+)\s+(?:years?|yrs?)(?:\s+of)?(?:\s+(?:relevant\s+|related\s+|progressive\s+)?(?:work\s+)?(?:experience|exp\.?))?/i;

const PLUS_RE =
  /(\d+)\s*\+\s*(?:years?|yrs?)(?:\s+of)?(?:\s+(?:relevant\s+|related\s+|progressive\s+)?(?:work\s+)?(?:experience|exp\.?))?/i;

const MINIMUM_RE =
  /(?:minimum|min\.?|at\s+least|minimum\s+of|at\s+least\s+)\s*(\d+)\s+(?:years?|yrs?)/i;

const OR_MORE_RE =
  /(\d+)\s+or\s+more\s+(?:years?|yrs?)(?:\s+of)?(?:\s+(?:relevant\s+|related\s+)?(?:work\s+)?(?:experience|exp\.?))?/i;

const YEARS_OF_RE =
  /(\d+)\s+(?:years?|yrs?)(?:'s?)?\s+(?:of\s+)?(?:relevant\s+|related\s+|professional\s+|hands[- ]on\s+|progressive\s+|proven\s+|solid\s+)?(?:work\s+)?(?:experience|exp\.?)/i;

const EXPERIENCE_COLON_RE =
  /(?:experience|exp\.?)[:\s]+(\d+)\s*\+?\s*(?:years?|yrs?)/i;

const YEAR_ADJ_RE =
  /(\d+)[- ]year(?:s)?\s+(?:of\s+)?(?:relevant\s+|related\s+)?(?:work\s+)?experience/i;

// Bullet-point prefixed patterns common in job postings:
// "• 3+ years experience", "- 5 years of …", "* 2-4 years …"
const BULLET_RE =
  /[•\-*–]\s*(\d+)\s*(?:\+\s*)?(?:to|-|–)?\s*(\d+)?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp\.?)/i;

// "proven X+ years", "proven track record of X years"
const PROVEN_RE =
  /proven(?:\s+track\s+record(?:\s+of)?)?\s+(?:(\d+)\s*\+?\s*(?:years?|yrs?)|(\d+)\s*[-–]\s*(\d+)\s+(?:years?|yrs?))/i;

// "X years hands-on/practical/direct experience"
const HANDS_ON_RE =
  /(\d+)\s+(?:years?|yrs?)\s+(?:hands[- ]on|practical|direct|relevant|applicable)\s+(?:work\s+)?experience/i;

const ENTRY_LEVEL =
  /\b(?:entry[\s-]level|junior|no experience(?:\s+required)?|recent graduate|new grad|internship|co-?op|0[\s-]?years?)\b/i;
const SENIOR_LEVEL =
  /\b(?:senior|lead|principal|staff\s+engineer|architect|director|vp\s+of|vice\s+president|7\s*\+|8\s*\+|9\s*\+|10\s*\+)\b/i;
const MID_LEVEL = /\b(?:mid[\s-]level|intermediate|associate)\b/i;

/** Strip HTML entities and normalize whitespace in text before parsing */
function cleanText(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
    .replace(/\s+/g, ' ')
    .trim();
}

function tryExtract(text: string): { years: number | null; display: string } | null {
  // Range: "2–4 years" — use lo (minimum) so the job isn't filtered out for
  // users who meet the minimum requirement (e.g. expMax=3 should pass "3–5 yrs")
  const rangeMatch = text.match(RANGE_RE);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10);
    const hi = parseInt(rangeMatch[2], 10);
    if (!isNaN(lo) && !isNaN(hi) && lo <= hi && hi <= 30) {
      return { years: lo, display: `${lo}–${hi} yrs` };
    }
  }

  // Bullet range: "• 3-5 years experience" — same, use lo
  const bulletMatch = text.match(BULLET_RE);
  if (bulletMatch) {
    const lo = parseInt(bulletMatch[1], 10);
    const hi = bulletMatch[2] ? parseInt(bulletMatch[2], 10) : lo;
    if (!isNaN(lo) && lo <= 30) {
      const display = hi > lo ? `${lo}–${hi} yrs` : `${lo}+ yrs`;
      return { years: lo, display };
    }
  }

  // Plus: "3+ years"
  const plusMatch = text.match(PLUS_RE);
  if (plusMatch) {
    const y = parseInt(plusMatch[1], 10);
    if (!isNaN(y) && y <= 30) return { years: y, display: `${y}+ yrs` };
  }

  // "X or more years"
  const orMoreMatch = text.match(OR_MORE_RE);
  if (orMoreMatch) {
    const y = parseInt(orMoreMatch[1], 10);
    if (!isNaN(y) && y <= 30) return { years: y, display: `${y}+ yrs` };
  }

  // Minimum: "minimum 3 years" / "minimum of 3 years"
  const minMatch = text.match(MINIMUM_RE);
  if (minMatch) {
    const y = parseInt(minMatch[1], 10);
    if (!isNaN(y) && y <= 30) return { years: y, display: `${y}+ yrs` };
  }

  // "N years of experience" (includes "N years experience" since "of" is optional)
  const yofMatch = text.match(YEARS_OF_RE);
  if (yofMatch) {
    const y = parseInt(yofMatch[1], 10);
    if (!isNaN(y) && y <= 30) return { years: y, display: `${y} yrs` };
  }

  // "experience: N years"
  const ecMatch = text.match(EXPERIENCE_COLON_RE);
  if (ecMatch) {
    const y = parseInt(ecMatch[1], 10);
    if (!isNaN(y) && y <= 30) return { years: y, display: `${y} yrs` };
  }

  // "N-year experience"
  const yaMatch = text.match(YEAR_ADJ_RE);
  if (yaMatch) {
    const y = parseInt(yaMatch[1], 10);
    if (!isNaN(y) && y <= 30) return { years: y, display: `${y} yrs` };
  }

  // "proven X+ years" or "proven track record of X years"
  const provenMatch = text.match(PROVEN_RE);
  if (provenMatch) {
    if (provenMatch[2] && provenMatch[3]) {
      const lo = parseInt(provenMatch[2], 10);
      const hi = parseInt(provenMatch[3], 10);
      if (!isNaN(lo) && lo <= 30) return { years: lo, display: `${lo}–${hi} yrs` };
    } else if (provenMatch[1]) {
      const y = parseInt(provenMatch[1], 10);
      if (!isNaN(y) && y <= 30) return { years: y, display: `${y}+ yrs` };
    }
  }

  // "X years hands-on/practical experience"
  const hoMatch = text.match(HANDS_ON_RE);
  if (hoMatch) {
    const y = parseInt(hoMatch[1], 10);
    if (!isNaN(y) && y <= 30) return { years: y, display: `${y} yrs` };
  }

  return null;
}

export function parseExperience(rawText: string): { years: number | null; display: string } {
  if (!rawText || rawText.trim().length === 0) {
    return { years: null, display: 'Not specified' };
  }

  const text = cleanText(rawText);

  // 1. Try every requirements/qualifications section for best precision
  //    Use exec loop to find ALL section matches, not just the first
  const sectionRe = new RegExp(SECTION_RE.source, 'gi');
  let sectionMatch: RegExpExecArray | null;
  while ((sectionMatch = sectionRe.exec(text)) !== null) {
    const result = tryExtract(sectionMatch[1]);
    if (result) return result;
  }

  // 2. Fall back to scanning the full text
  const result = tryExtract(text);
  if (result) return result;

  // 3. Level keyword fallbacks — runs on full text
  if (ENTRY_LEVEL.test(text)) return { years: 0, display: 'Entry level' };
  if (MID_LEVEL.test(text)) return { years: 3, display: 'Mid-level (~3 yrs)' };
  if (SENIOR_LEVEL.test(text)) return { years: 7, display: 'Senior (7+ yrs)' };

  return { years: null, display: 'Not specified' };
}
