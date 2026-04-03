import { randomUUID } from 'crypto';
import type { Job, SearchFilters, WorkType, EmploymentType } from '@/types/job';
import { parseSalary, formatSalaryDisplay } from '@/lib/parsers/salary';
import { parseExperience } from '@/lib/parsers/experience';

export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
];

export function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelayMs = 1500
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await sleep(delay + Math.random() * 500);
      }
    }
  }
  throw lastError;
}

export function detectWorkType(text: string): WorkType {
  const lower = text.toLowerCase();
  if (lower.includes('remote') && lower.includes('hybrid')) return 'Hybrid';
  if (lower.includes('hybrid')) return 'Hybrid';
  if (lower.includes('remote')) return 'Remote';
  if (lower.includes('on-site') || lower.includes('onsite') || lower.includes('in-office') || lower.includes('in office')) return 'On-site';
  return 'Any';
}

export function detectEmploymentType(text: string): EmploymentType | null {
  const lower = text.toLowerCase();
  if (lower.includes('contract') || lower.includes('contractor') || lower.includes('freelance')) return 'Contract';
  if (lower.includes('part-time') || lower.includes('part time')) return 'Part-time';
  if (lower.includes('full-time') || lower.includes('full time')) return 'Full-time';
  return null;
}

export function detectFrench(text: string): boolean {
  const frenchIndicators = [
    /\bles?\b/i, /\bun(?:e)?\b/i, /\bdes?\b/i, /\bavec\b/i,
    /\bpour\b/i, /\bvous\b/i, /\bnous\b/i, /\bvotre\b/i,
    /\bposte\b/i, /\bemploi\b/i, /\bsalaire\b/i,
  ];
  const matches = frenchIndicators.filter((p) => p.test(text)).length;
  return matches >= 3;
}

export function detectReposted(text: string): boolean {
  return /\breposted\b/i.test(text);
}

export function buildJobFromRaw(params: {
  title: string;
  company: string;
  location: string;
  description: string;
  datePostedText: string;
  sourceUrl: string;
  source: Job['source'];
  employmentTypeText?: string;
  applyUrl?: string | null;
  isReposted?: boolean;
}): Job {
  const {
    title, company, location, description, datePostedText,
    sourceUrl, source, employmentTypeText,
    applyUrl = null, isReposted = false,
  } = params;

  const salaryInfo = parseSalary(description);
  const { years, display: expDisplay } = parseExperience(description);
  const workType = detectWorkType(`${location} ${description}`);
  const employmentType = employmentTypeText
    ? detectEmploymentType(employmentTypeText)
    : detectEmploymentType(description);
  const isFrench = detectFrench(description);
  const reposted = isReposted || detectReposted(datePostedText);

  const datePostedRaw = parseRelativeDate(datePostedText);

  return {
    id: randomUUID(),
    title: title.trim(),
    company: company.trim(),
    location: location.trim(),
    workType,
    salary: salaryInfo,
    salaryDisplay: formatSalaryDisplay(salaryInfo),
    yearsExperience: years,
    yearsExperienceDisplay: expDisplay,
    employmentType,
    datePosted: formatRelativeDate(datePostedRaw),
    datePostedRaw,
    source,
    sourceUrl,
    applyUrl,
    description,
    hasCommission: salaryInfo?.hasCommission ?? false,
    isLanguageFrench: isFrench,
    isReposted: reposted,
  };
}

function parseRelativeDate(text: string): Date | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();
  const now = new Date();

  if (lower.includes('just now') || lower.includes('today') || lower.includes('few minutes') || lower.includes('hour')) {
    return now;
  }

  const dayMatch = lower.match(/(\d+)\s*day/);
  if (dayMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(dayMatch[1], 10));
    return d;
  }

  const weekMatch = lower.match(/(\d+)\s*week/);
  if (weekMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(weekMatch[1], 10) * 7);
    return d;
  }

  const monthMatch = lower.match(/(\d+)\s*month/);
  if (monthMatch) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - parseInt(monthMatch[1], 10));
    return d;
  }

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) return parsed;

  return null;
}

function formatRelativeDate(date: Date | null): string {
  if (!date) return 'Unknown';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return '1 week ago';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return '1 month ago';
  return `${Math.floor(diffDays / 30)} months ago`;
}

/** Returns true if job passes the datePostedDays filter (0 = any time). */
export function filterByDatePostedDays(date: Date | string | null, maxDays: number): boolean {
  if (maxDays === 0) return true;
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return false;
  const diffDays = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= maxDays;
}
