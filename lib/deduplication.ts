import type { Job, SearchFilters } from '@/types/job';
import { filterByDatePostedDays } from '@/lib/scrapers/utils';

function dedupeKey(job: Job): string {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return `${normalize(job.title)}|${normalize(job.company)}|${normalize(job.location)}`;
}

function completenessScore(job: Job): number {
  let score = 0;
  if (job.salary !== null) score += 3;
  if (job.yearsExperience !== null) score += 2;
  if (job.employmentType !== null) score += 1;
  if (job.description.length > 200) score += 2;
  if (job.datePostedRaw !== null) score += 1;
  if (job.applyUrl) score += 1;
  return score;
}

export function deduplicateJobs(jobs: Job[]): Job[] {
  const map = new Map<string, Job>();

  for (const job of jobs) {
    const key = dedupeKey(job);
    const existing = map.get(key);
    if (!existing || completenessScore(job) > completenessScore(existing)) {
      map.set(key, job);
    }
  }

  return Array.from(map.values());
}

export function applyFilters(jobs: Job[], filters: SearchFilters): Job[] {
  return jobs.filter((job) => {
    // Work type
    if (filters.workType !== 'Any' && job.workType !== 'Any' && job.workType !== filters.workType) {
      return false;
    }

    // Employment type
    if (filters.employmentTypes.length > 0 && job.employmentType) {
      if (!filters.employmentTypes.includes(job.employmentType)) return false;
    }

    // Date posted (slider — 0 means any time)
    if (!filterByDatePostedDays(job.datePostedRaw, filters.datePostedDays)) return false;

    // Salary filter
    const hasSalary = job.salary !== null && (job.salary.min !== null || job.salary.max !== null);
    if (!hasSalary && !filters.showNoSalary) return false;

    if (hasSalary && job.salary) {
      const jobMin = job.salary.min ?? job.salary.max ?? 0;
      const jobMax = job.salary.max ?? job.salary.min ?? Infinity;
      if (jobMax < filters.salaryMin || jobMin > filters.salaryMax) return false;
    }

    // Experience filter
    const hasExp = job.yearsExperience !== null;
    if (!hasExp && !filters.showNoExp) return false;

    if (hasExp && job.yearsExperience !== null) {
      if (job.yearsExperience < filters.expMin) return false;
      if (filters.expMax < 15 && job.yearsExperience > filters.expMax) return false;
    }

    return true;
  });
}
