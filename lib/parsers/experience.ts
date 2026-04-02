const EXPERIENCE_PATTERNS = [
  // "3+ years", "3+ years of experience"
  /(\d+)\+\s*(?:years?|yrs?)(?:\s+of)?(?:\s+(?:relevant\s+)?(?:experience|exp\.?))?/i,
  // "minimum 5 years"
  /(?:minimum|min\.?|at\s+least)\s+(\d+)\s+(?:years?|yrs?)/i,
  // "2 to 4 years", "2-4 years", "2–4 years"
  /(\d+)\s*(?:to|-|–)\s*(\d+)\s+(?:years?|yrs?)(?:\s+of)?(?:\s+(?:relevant\s+)?(?:experience|exp\.?))?/i,
  // "5 years of experience"
  /(\d+)\s+(?:years?|yrs?)\s+of(?:\s+relevant)?\s+(?:experience|exp\.?)/i,
  // "experience: 3 years"
  /experience[:\s]+(\d+)\s+(?:years?|yrs?)/i,
  // "3 year experience"
  /(\d+)[- ]year(?:s)?\s+(?:of\s+)?(?:relevant\s+)?experience/i,
  // "entry level" / "junior" → 0, "senior" → 5
];

const ENTRY_LEVEL = /\b(?:entry[\s-]level|junior|no experience(?:\s+required)?|recent graduate|new grad)\b/i;
const SENIOR_LEVEL = /\b(?:senior|lead|principal|staff|7\+|8\+|9\+|10\+)\b/i;
const MID_LEVEL = /\b(?:mid[\s-]level|intermediate)\b/i;

export function parseExperience(text: string): { years: number | null; display: string } {
  if (!text || text.trim().length === 0) {
    return { years: null, display: 'Not specified' };
  }

  // Try range pattern first: "2–4 years"
  const rangePattern = /(\d+)\s*(?:to|-|–)\s*(\d+)\s+(?:years?|yrs?)(?:\s+of)?(?:\s+(?:relevant\s+)?(?:experience|exp\.?))?/i;
  const rangeMatch = text.match(rangePattern);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    const avg = Math.round((min + max) / 2);
    return { years: avg, display: `${min}–${max} yrs` };
  }

  // Try plus pattern: "3+ years"
  const plusPattern = /(\d+)\+\s*(?:years?|yrs?)(?:\s+of)?(?:\s+(?:relevant\s+)?(?:experience|exp\.?))?/i;
  const plusMatch = text.match(plusPattern);
  if (plusMatch) {
    const years = parseInt(plusMatch[1], 10);
    return { years, display: `${years}+ yrs` };
  }

  // Generic single number patterns
  for (const pattern of EXPERIENCE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const years = parseInt(match[1], 10);
      if (!isNaN(years) && years >= 0 && years <= 30) {
        return { years, display: `${years} yrs` };
      }
    }
  }

  // Fallback to level keywords
  if (ENTRY_LEVEL.test(text)) return { years: 0, display: 'Entry level' };
  if (MID_LEVEL.test(text)) return { years: 3, display: 'Mid-level (~3 yrs)' };
  if (SENIOR_LEVEL.test(text)) return { years: 7, display: 'Senior (7+ yrs)' };

  return { years: null, display: 'Not specified' };
}
