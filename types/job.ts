export type JobSource = 'LinkedIn' | 'Custom';
export type WorkType = 'Remote' | 'Hybrid' | 'On-site' | 'Any';
export type EmploymentType = 'Full-time' | 'Part-time' | 'Contract';

export interface SalaryInfo {
  min: number | null;
  max: number | null;
  currency: string;
  period: 'annual' | 'hourly' | 'monthly';
  isEstimated: boolean;
  hasCommission: boolean;
  commissionNote: string | null;
  raw: string;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  workType: WorkType;
  salary: SalaryInfo | null;
  salaryDisplay: string;
  yearsExperience: number | null;
  yearsExperienceDisplay: string;
  employmentType: EmploymentType | null;
  datePosted: string;
  datePostedRaw: Date | string | null;
  source: JobSource;
  sourceUrl: string;
  /** Direct external apply / careers page URL (may differ from sourceUrl on LinkedIn) */
  applyUrl: string | null;
  description: string;
  hasCommission: boolean;
  isLanguageFrench: boolean;
  isReposted: boolean;
  industry: string | null;
}

export interface SearchFilters {
  keywords: string;
  location: string;
  workType: WorkType;
  industries: string[];
  /** 0 = any time, otherwise max age in days (e.g. 2 = posted within last 48 h) */
  datePostedDays: number;
  employmentTypes: EmploymentType[];
  salaryMin: number;
  salaryMax: number;
  showNoSalary: boolean;
  expMin: number;
  expMax: number;
  showNoExp: boolean;
  customUrls: string[];
}

export interface ScrapeResult {
  jobs: Job[];
  errors: Record<JobSource | string, string | null>;
  totalBySource: Record<JobSource | string, number>;
  /** Unique jobs after deduplication, before filters — shows how many filters hid */
  totalDeduped: number;
  durationMs: number;
}

export type SortField = keyof Pick<
  Job,
  'title' | 'company' | 'location' | 'yearsExperience' | 'employmentType' | 'datePostedRaw' | 'source' | 'isReposted'
> | 'salary';

export type SortDir = 'asc' | 'desc';

export interface SortState {
  field: SortField;
  dir: SortDir;
}

export const INDUSTRIES = [
  'Technology',
  'Finance & Banking',
  'Healthcare',
  'Marketing & Advertising',
  'Engineering',
  'Sales',
  'Human Resources',
  'Legal',
  'Education',
  'Construction & Real Estate',
  'Retail & Consumer Goods',
  'Manufacturing',
  'Consulting',
  'Government & Non-profit',
  'Media & Entertainment',
  'Logistics & Supply Chain',
  'Energy & Utilities',
  'Hospitality & Tourism',
  'Other',
] as const;

export const DEFAULT_FILTERS: SearchFilters = {
  keywords: '',
  location: 'Toronto, ON',
  workType: 'Any',
  industries: [],
  datePostedDays: 1,
  employmentTypes: [],
  salaryMin: 0,
  salaryMax: 300000,
  showNoSalary: true,
  expMin: 0,
  expMax: 15,
  showNoExp: true,
  customUrls: [],
};
