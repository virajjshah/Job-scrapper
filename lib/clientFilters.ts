import type { Job, SearchFilters } from '@/types/job';

function dateWithinDays(date: Date | string | null, maxDays: number): boolean {
  if (maxDays === 0) return true;
  // Unknown/unparseable date — show the job rather than burying it
  if (!date) return true;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return true;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24) <= maxDays;
}

export function jobMatchesFilters(job: Job, filters: SearchFilters): boolean {
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
  // No salary detected → always passes (same as null employmentType)
  const hasSalary = job.salary !== null && (job.salary.min !== null || job.salary.max !== null);
  if (hasSalary && job.salary) {
    const jobMin = job.salary.min ?? job.salary.max ?? 0;
    const jobMax = job.salary.max ?? job.salary.min ?? Infinity;
    if (jobMax < filters.salaryMin || jobMin > filters.salaryMax) return false;
  }

  // Experience — only filter when the job actually has experience data
  // No experience detected → always passes (same as null employmentType)
  const hasExp = job.yearsExperience !== null;
  if (hasExp && job.yearsExperience !== null) {
    if (job.yearsExperience < filters.expMin) return false;
    if (filters.expMax < 15 && job.yearsExperience > filters.expMax) return false;
  }

  return true;
}
