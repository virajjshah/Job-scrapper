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

/**
 * Extracts salary, employmentType, and industry from JSON-LD JobPosting schema
 * embedded in raw HTML. LinkedIn, Indeed and many job boards include this.
 */
export function extractJsonLdData(html: string): {
  salary?: string;
  employmentType?: string;
  industry?: string;
} {
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    try {
      const schema = JSON.parse(m[1]);
      // Handle both a single object and an array of objects
      const entries: unknown[] = Array.isArray(schema) ? schema : [schema];
      const entry = entries.find(
        (s) => s && typeof s === 'object' && (s as Record<string, unknown>)['@type'] === 'JobPosting'
      ) as Record<string, unknown> | undefined;
      if (!entry) continue;

      const result: { salary?: string; employmentType?: string; industry?: string } = {};

      if (entry.employmentType) {
        result.employmentType = Array.isArray(entry.employmentType)
          ? (entry.employmentType as unknown[]).join(' ')
          : String(entry.employmentType);
      }

      if (entry.industry) result.industry = String(entry.industry);
      if (entry.occupationalCategory) result.industry = String(entry.occupationalCategory);

      // Try baseSalary first, then estimatedSalary (Glassdoor uses estimatedSalary)
      const salaryField = entry.baseSalary ?? entry.estimatedSalary;
      if (salaryField && typeof salaryField === 'object') {
        const bs = salaryField as Record<string, unknown>;
        // The value may be nested (QuantitativeValue) or flat
        const v = (bs.value && typeof bs.value === 'object' ? bs.value : bs) as Record<string, unknown>;
        const min = v.minValue != null ? Number(v.minValue) : null;
        const max = v.maxValue != null ? Number(v.maxValue) : (v.value != null ? Number(v.value) : null);
        // Normalize unit to lowercase for salary parser: "YEAR" → "year", "HOUR" → "hour", "MONTH" → "month"
        const rawUnit = String(v.unitText ?? bs.unitText ?? '').toLowerCase();
        // Map schema.org unit codes to period words the salary parser understands
        const unit = rawUnit === 'year' ? 'year'
          : rawUnit === 'hour' ? 'hour'
          : rawUnit === 'month' ? 'month'
          : rawUnit; // pass through any other value

        if (min != null && !isNaN(min) && max != null && !isNaN(max)) {
          result.salary = `$${min} - $${max}${unit ? ` per ${unit}` : ''}`;
        } else if (max != null && !isNaN(max)) {
          result.salary = `$${max}${unit ? ` per ${unit}` : ''}`;
        } else if (min != null && !isNaN(min)) {
          result.salary = `$${min}${unit ? ` per ${unit}` : ''}`;
        }
      }

      if (result.salary || result.employmentType || result.industry) {
        return result;
      }
    } catch { /* skip malformed */ }
  }
  return {};
}

const INDUSTRY_RULES: [string, RegExp][] = [
  ['Technology', /\b(software|developer|engineer(?:ing)?|devops|cloud|data\s+(science|engineer|analyst)|machine\s+learning|artificial\s+intelligence|AI|cyber|cybersecurity|IT\s+|tech\s+|SaaS|startup|programming|javascript|typescript|python|java|react|backend|frontend|full[- ]?stack|mobile\s+dev|iOS|android|platform\s+engineer|site\s+reliability|QA\s+engineer|test\s+engineer)\b/i],
  ['Finance & Banking', /\b(finance|financial\s+(analyst|services|planning)|banking|investment\s+(bank|management)|accounting|accountant|auditor|audit|tax\s+|insurance|mortgage|fintech|trading|hedge\s+fund|private\s+equity|asset\s+management|wealth\s+management|portfolio\s+manager|CFO|CPA|CFA|controller|treasury|actuarial|brokerage|capital\s+markets)\b/i],
  ['Healthcare', /\b(healthcare|health\s+care|medical|hospital|clinic|nurse|nursing|physician|doctor|pharma|pharmaceutical|biotech|patient\s+care|dental|therapy|therapist|clinical\s+trial|health\s+informatics|EMR|EHR)\b/i],
  ['Marketing & Advertising', /\b(marketing|advertis|brand\s+manager|content\s+(marketing|strategist)|SEO|SEM|social\s+media|digital\s+marketing|growth\s+hacker|PR\s+|public\s+relations|communications\s+manager|copywriter|creative\s+director|media\s+buyer)\b/i],
  ['Engineering', /\b(mechanical\s+engineer|electrical\s+engineer|civil\s+engineer|structural\s+engineer|chemical\s+engineer|manufacturing\s+engineer|aerospace|automotive\s+engineer|robotics|embedded\s+systems|hardware\s+engineer|industrial\s+engineer|process\s+engineer)\b/i],
  ['Sales', /\b(sales\s+|account\s+executive|business\s+development|BDR|SDR|revenue\s+|quota|CRM|salesforce|customer\s+success|account\s+manager|closing\s+deals|sales\s+pipeline|inside\s+sales|enterprise\s+sales)\b/i],
  ['Human Resources', /\b(human\s+resources|HR\s+|recruiter|recruiting|talent\s+acquisition|people\s+operations|HRBP|payroll|compensation\s+and\s+benefits|organizational\s+development|workforce\s+planning|onboarding|CHRO)\b/i],
  ['Legal', /\b(legal\s+|lawyer|attorney|paralegal|compliance\s+officer|litigation|corporate\s+law|intellectual\s+property|contract\s+law|counsel|barrister|solicitor|law\s+firm|in-house\s+legal)\b/i],
  ['Education', /\b(education|teacher|instructor|professor|tutor|curriculum|school\s+|university|college|e-learning|training\s+coordinator|academic|teaching|learning\s+&\s+development|L&D\s+|instructional\s+design)\b/i],
  ['Construction & Real Estate', /\b(construction|real\s+estate|property\s+management|architect|general\s+contractor|builder|renovation|facilities\s+manager|HVAC|plumbing|electrical\s+contractor|site\s+superintendent|project\s+manager.*construction|estimator)\b/i],
  ['Retail & Consumer Goods', /\b(retail\s+|store\s+manager|merchandise|buyer\s+|ecommerce|e-commerce|consumer\s+goods|CPG|FMCG|fashion|apparel|inventory\s+management|category\s+management|visual\s+merchandising)\b/i],
  ['Manufacturing', /\b(manufacturing|production\s+manager|plant\s+manager|assembly|operations\s+manager|quality\s+control|quality\s+assurance|supply\s+chain\s+|lean\s+manufacturing|six\s+sigma|warehouse\s+|forklift|CNC|machinist)\b/i],
  ['Consulting', /\b(consulting|management\s+consulting|strategy\s+consulting|advisory\s+|McKinsey|Deloitte|Accenture|KPMG|Ernst\s*&\s*Young|PwC|BCG|Bain|Oliver\s+Wyman|consultant\b)\b/i],
  ['Government & Non-profit', /\b(government|municipal|federal|provincial|non-?profit|NGO|charity|public\s+sector|policy\s+analyst|regulatory\s+affairs|crown\s+corporation|social\s+services|public\s+administration)\b/i],
  ['Media & Entertainment', /\b(media\s+|entertainment|film|video\s+production|broadcasting|journalism|journalist|editor\s+|content\s+creator|streaming|podcast|animation|game\s+developer|gaming|esports)\b/i],
  ['Logistics & Supply Chain', /\b(logistics|supply\s+chain|procurement|strategic\s+sourcing|distribution\s+center|freight|transportation\s+|fleet\s+manager|customs\s+broker|import\/export|3PL|warehouse\s+manager|inventory\s+planner)\b/i],
  ['Energy & Utilities', /\b(energy\s+|oil\s+and\s+gas|petroleum|renewable\s+energy|solar|wind\s+energy|nuclear|utilities|power\s+plant|electrical\s+grid|pipeline|mining|natural\s+resources)\b/i],
  ['Hospitality & Tourism', /\b(hospitality|hotel|restaurant|food\s+service|chef|culinary|tourism|travel\s+|airline|cruise|event\s+manager|catering|bartender|front\s+desk|housekeeping|resort)\b/i],
];

export function detectIndustry(text: string): string | null {
  if (!text) return null;
  for (const [industry, re] of INDUSTRY_RULES) {
    if (re.test(text)) return industry;
  }
  return null;
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
  if (lower.includes('part-time') || lower.includes('part time') || lower.includes('parttime')) return 'Part-time';
  if (
    lower.includes('full-time') || lower.includes('full time') ||
    lower.includes('fulltime') || lower.includes('permanent') ||
    lower === 'full time' || lower === 'fulltime'
  ) return 'Full-time';
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
  /** Extra salary text from JSON-LD or scraped chip — prepended before parsing */
  salaryHint?: string;
  /** Industry string hint from JSON-LD or scraper (used instead of auto-detection) */
  industryHint?: string | null;
}): Job {
  const {
    title, company, location, description, datePostedText,
    sourceUrl, source, employmentTypeText,
    applyUrl = null, isReposted = false,
    salaryHint, industryHint,
  } = params;

  // Prepend salary hint so the parser sees explicit values first
  const salaryText = [salaryHint, description].filter(Boolean).join('\n');
  const salaryInfo = parseSalary(salaryText);
  const { years, display: expDisplay } = parseExperience(description);
  const workType = detectWorkType(`${location} ${description}`);
  const employmentType = employmentTypeText
    ? detectEmploymentType(employmentTypeText)
    : detectEmploymentType(description);
  const isFrench = detectFrench(description);
  const reposted = isReposted || detectReposted(datePostedText);

  const datePostedRaw = parseRelativeDate(datePostedText);

  // Industry: use explicit hint if provided, otherwise auto-detect from title+company+description
  const industry = industryHint !== undefined
    ? (industryHint ? detectIndustry(industryHint) ?? industryHint : null)
    : detectIndustry(`${title} ${company} ${description}`);

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
    industry,
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

  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return '1d';
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 14) return '1w';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
  if (diffDays < 60) return '1mo';
  return `${Math.floor(diffDays / 30)}mo`;
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
