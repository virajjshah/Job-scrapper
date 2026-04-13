'use client';

import { useState, useMemo, useCallback } from 'react';
import { ExternalLink, ChevronUp, ChevronDown, ChevronsUpDown, Download } from 'lucide-react';
import { Badge } from './ui/Badge';
import { clsx } from 'clsx';
import type { Job, SortField, SortDir, SortState, SearchFilters } from '@/types/job';
import { jobMatchesFilters } from '@/lib/clientFilters';

interface ResultsTableProps {
  jobs: Job[];
  totalBySource: Record<string, number>;
  totalDeduped: number;
  errors: Record<string, string | null>;
  durationMs: number;
  filters: SearchFilters;
  onExport: () => void;
}

type ColDef = {
  label: string;
  field: SortField | null;
  render: (job: Job) => React.ReactNode;
  className?: string;
};

const COLUMNS: ColDef[] = [
  {
    label: 'Job Title',
    field: 'title',
    render: (job) => (
      <a
        href={job.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 hover:underline"
      >
        {job.title}
      </a>
    ),
    className: 'min-w-[200px] max-w-[280px]',
  },
  {
    label: 'Company',
    field: 'company',
    render: (job) => <span className="text-gray-900 dark:text-gray-200">{job.company}</span>,
    className: 'min-w-[140px]',
  },
  {
    label: 'Location',
    field: 'location',
    render: (job) => (
      <div className="flex flex-col gap-1">
        <span className="text-sm text-gray-700 dark:text-gray-300">{job.location}</span>
        {job.workType !== 'Any' && (
          <Badge label={job.workType} variant="workType" workType={job.workType} />
        )}
      </div>
    ),
    className: 'min-w-[160px]',
  },
  {
    label: 'Salary',
    field: 'salary',
    render: (job) => (
      <div className="flex flex-col gap-1">
        <span className={clsx('text-sm', job.hasCommission ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-gray-700 dark:text-gray-300')}>
          {job.salaryDisplay}
        </span>
        {job.salary?.isEstimated && (
          <span className="text-xs text-gray-400">~Annual est.</span>
        )}
      </div>
    ),
    className: 'min-w-[160px]',
  },
  {
    label: 'Yrs Exp',
    field: 'yearsExperience',
    render: (job) => (
      <span className={clsx('text-sm', !job.yearsExperience && job.yearsExperience !== 0 ? 'text-gray-400 dark:text-gray-600 italic' : 'text-gray-900 dark:text-gray-200')}>
        {job.yearsExperienceDisplay}
      </span>
    ),
    className: 'min-w-[100px]',
  },
  {
    label: 'Type',
    field: 'employmentType',
    render: (job) => {
      if (!job.employmentType) return <span className="text-gray-400 dark:text-gray-600 italic text-sm">—</span>;
      const cls =
        job.employmentType === 'Full-time' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' :
        job.employmentType === 'Part-time' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800' :
        'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800';
      return <span className={clsx('inline-block text-xs font-medium rounded px-1.5 py-0.5 border', cls)}>{job.employmentType}</span>;
    },
    className: 'min-w-[100px]',
  },
  {
    label: 'Posted',
    field: 'datePostedRaw',
    render: (job) => <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{job.datePosted}</span>,
    className: 'min-w-[100px]',
  },
  {
    label: 'Source',
    field: 'source',
    render: (job) => <Badge label={job.source} variant="source" source={job.source} />,
    className: 'min-w-[90px]',
  },
  {
    label: 'Link',
    field: null,
    render: (job) => (
      <a
        href={job.applyUrl ?? job.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium border border-blue-200 dark:border-blue-800 hover:border-blue-400 dark:hover:border-blue-600 rounded px-2 py-1 transition-colors"
      >
        {job.applyUrl ? 'Apply' : 'View'} <ExternalLink size={11} />
      </a>
    ),
    className: 'min-w-[70px]',
  },
];

const SORT_OPTIONS: { label: string; field: SortField; dir: SortDir }[] = [
  { label: 'Newest first', field: 'datePostedRaw', dir: 'desc' },
  { label: 'Oldest first', field: 'datePostedRaw', dir: 'asc' },
  { label: 'Title A–Z', field: 'title', dir: 'asc' },
  { label: 'Company A–Z', field: 'company', dir: 'asc' },
  { label: 'Salary: High–Low', field: 'salary', dir: 'desc' },
  { label: 'Salary: Low–High', field: 'salary', dir: 'asc' },
  { label: 'Exp: High–Low', field: 'yearsExperience', dir: 'desc' },
  { label: 'Exp: Low–High', field: 'yearsExperience', dir: 'asc' },
];

function getSortValue(job: Job, field: SortField): string | number | null {
  switch (field) {
    case 'title': return job.title.toLowerCase();
    case 'company': return job.company.toLowerCase();
    case 'location': return job.location.toLowerCase();
    case 'salary': return job.salary?.min ?? job.salary?.max ?? -1;
    case 'yearsExperience': return job.yearsExperience ?? -1;
    case 'employmentType': return job.employmentType?.toLowerCase() ?? '';
    case 'datePostedRaw': {
      const d = job.datePostedRaw;
      if (!d) return 0;
      const ts = d instanceof Date ? d.getTime() : new Date(d).getTime();
      return isNaN(ts) ? 0 : ts;
    }
    case 'source': return job.source.toLowerCase();
    case 'isReposted': return job.isReposted ? 1 : 0;
    default: return '';
  }
}

function SortIcon({ field, sort }: { field: SortField | null; sort: SortState }) {
  if (!field || sort.field !== field) return <ChevronsUpDown size={13} className="text-gray-400 opacity-60" />;
  return sort.dir === 'asc'
    ? <ChevronUp size={13} className="text-blue-500" />
    : <ChevronDown size={13} className="text-blue-500" />;
}

function MobileJobCard({ job }: { job: Job }) {
  return (
    <div className={clsx(
      'bg-white dark:bg-gray-900 rounded-xl border shadow-sm p-4',
      job.hasCommission
        ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/10'
        : 'border-gray-200 dark:border-gray-700'
    )}>
      {/* Top row: title + source badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <a
            href={job.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-blue-700 dark:text-blue-400 hover:underline leading-snug line-clamp-2 text-base"
          >
            {job.title}
          </a>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-0.5">{job.company}</p>
        </div>
        <Badge label={job.source} variant="source" source={job.source} />
      </div>

      {/* Location + work type */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span className="text-xs text-gray-500 dark:text-gray-400">{job.location}</span>
        {job.workType !== 'Any' && (
          <Badge label={job.workType} variant="workType" workType={job.workType} />
        )}
      </div>

      {/* Meta row: salary, type, exp */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        <span className={clsx(
          'text-sm font-medium',
          job.hasCommission ? 'text-amber-700 dark:text-amber-400' : 'text-gray-700 dark:text-gray-300'
        )}>
          {job.salaryDisplay}
        </span>
        {job.employmentType && (
          <span className={clsx(
            'text-xs font-medium rounded px-1.5 py-0.5 border self-center',
            job.employmentType === 'Full-time' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' :
            job.employmentType === 'Part-time' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800' :
            'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800'
          )}>
            {job.employmentType}
          </span>
        )}
        {(job.yearsExperience !== null || job.yearsExperience === 0) && (
          <span className="text-xs text-gray-500 dark:text-gray-400 self-center">
            {job.yearsExperienceDisplay}
          </span>
        )}
      </div>

      {/* Bottom row: posted, apply button */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
        <span className="text-xs text-gray-400 dark:text-gray-500">{job.datePosted}</span>
        <a
          href={job.applyUrl ?? job.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {job.applyUrl ? 'Apply' : 'View'} <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

export function ResultsTable({ jobs, totalBySource, totalDeduped, errors, durationMs, filters, onExport }: ResultsTableProps) {
  const [sort, setSort] = useState<SortState>({ field: 'datePostedRaw', dir: 'desc' });
  const [filter, setFilter] = useState('');

  const handleSort = useCallback((field: SortField | null) => {
    if (!field) return;
    setSort((prev) =>
      prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' }
    );
  }, []);

  const handleMobileSort = useCallback((value: string) => {
    const opt = SORT_OPTIONS[Number(value)];
    if (opt) setSort({ field: opt.field, dir: opt.dir });
  }, []);

  const sortFn = useCallback((a: Job, b: Job) => {
    const av = getSortValue(a, sort.field);
    const bv = getSortValue(b, sort.field);
    if (av === bv) return 0;
    if (av === null || av === -1) return 1;
    if (bv === null || bv === -1) return -1;
    const cmp = av < bv ? -1 : 1;
    return sort.dir === 'asc' ? cmp : -cmp;
  }, [sort]);

  const { visibleJobs, hiddenJobs } = useMemo(() => {
    let list = [...jobs];

    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.company.toLowerCase().includes(q) ||
          j.location.toLowerCase().includes(q) ||
          j.salaryDisplay.toLowerCase().includes(q) ||
          (j.industry ?? '').toLowerCase().includes(q)
      );
    }

    const matching = list.filter((j) => jobMatchesFilters(j, filters));
    const hidden = list.filter((j) => !jobMatchesFilters(j, filters));

    matching.sort(sortFn);
    hidden.sort(sortFn);

    return { visibleJobs: matching, hiddenJobs: hidden };
  }, [jobs, filter, filters, sortFn]);

  const sourceCount = Object.entries(totalBySource)
    .filter(([, n]) => n > 0)
    .map(([src, n]) => `${n} from ${src}`)
    .join(', ');

  const errorMessages = Object.entries(errors).filter(([, msg]) => msg !== null);

  const currentSortIndex = SORT_OPTIONS.findIndex(
    (o) => o.field === sort.field && o.dir === sort.dir
  );

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Toolbar */}
      <div className="flex flex-col gap-2">
        {/* Job count */}
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-snug">
          <span className="font-semibold text-gray-900 dark:text-gray-100">{visibleJobs.length} jobs</span>
          {hiddenJobs.length > 0 && (
            <span className="text-gray-400 dark:text-gray-500"> · {hiddenJobs.length} shown below as potential matches</span>
          )}
          {sourceCount && <span className="ml-1 text-gray-400 dark:text-gray-500">· {sourceCount}</span>}
          {durationMs > 0 && (
            <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">in {(durationMs / 1000).toFixed(1)}s</span>
          )}
        </p>

        {/* Controls: filter input + mobile sort + export */}
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter results…"
            className="flex-1 min-w-0 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {/* Mobile sort dropdown */}
          <select
            value={currentSortIndex >= 0 ? currentSortIndex : 0}
            onChange={(e) => handleMobileSort(e.target.value)}
            className="md:hidden flex-shrink-0 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Sort jobs"
          >
            {SORT_OPTIONS.map((opt, i) => (
              <option key={i} value={i}>{opt.label}</option>
            ))}
          </select>

          {/* Export button */}
          <button
            onClick={onExport}
            disabled={jobs.length === 0}
            className={clsx(
              'flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
              jobs.length === 0
                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-700 active:bg-green-800 text-white border-green-600 shadow-sm'
            )}
            aria-label="Export CSV"
          >
            <Download size={15} />
            <span className="hidden sm:inline">Export CSV</span>
            <span className="sm:hidden">CSV</span>
          </button>
        </div>
      </div>

      {/* Error banners */}
      {errorMessages.map(([src, msg]) => (
        <div key={src} className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2">
          <strong>{src} unavailable:</strong> {msg}
        </div>
      ))}

      {/* Mobile: job cards */}
      <div className="md:hidden flex flex-col gap-3">
        {visibleJobs.length === 0 ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500 text-sm">
            {jobs.length > 0
              ? 'No jobs match your filters. Try broadening your keyword search.'
              : 'No jobs found. Tap Filters to search.'}
          </div>
        ) : (
          visibleJobs.map((job) => <MobileJobCard key={job.id} job={job} />)
        )}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block flex-1 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
              {COLUMNS.map((col) => (
                <th
                  key={col.label}
                  onClick={() => handleSort(col.field)}
                  className={clsx(
                    'px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap',
                    col.field ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none' : '',
                    col.className
                  )}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    <SortIcon field={col.field} sort={sort} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {visibleJobs.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                  {jobs.length > 0
                    ? 'No jobs match your filters. Try broadening your keyword search or loosening other filters.'
                    : 'No jobs found. Try adjusting your search criteria.'}
                </td>
              </tr>
            ) : (
              visibleJobs.map((job) => (
                <tr
                  key={job.id}
                  className={clsx(
                    'hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors',
                    job.hasCommission
                      ? 'bg-amber-50 dark:bg-amber-900/10 hover:bg-amber-100 dark:hover:bg-amber-900/20'
                      : 'dark:bg-gray-900'
                  )}
                >
                  {COLUMNS.map((col) => (
                    <td key={col.label} className={clsx('px-4 py-3 align-top', col.className)}>
                      {col.render(job)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Potential Filtered Matches — dimmed, shown on both mobile and desktop */}
      {hiddenJobs.length > 0 && (
        <div style={{ opacity: 0.66 }}>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide px-1 mb-2">
            Potential Filtered Matches ({hiddenJobs.length})
          </p>
          {/* Mobile cards */}
          <div className="md:hidden flex flex-col gap-3">
            {hiddenJobs.map((job) => <MobileJobCard key={job.id} job={job} />)}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
            <table className="min-w-full text-sm border-collapse">
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {hiddenJobs.map((job) => (
                  <tr
                    key={job.id}
                    className={clsx(
                      'hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors',
                      job.hasCommission
                        ? 'bg-amber-50 dark:bg-amber-900/10 hover:bg-amber-100 dark:hover:bg-amber-900/20'
                        : 'dark:bg-gray-900'
                    )}
                  >
                    {COLUMNS.map((col) => (
                      <td key={col.label} className={clsx('px-4 py-3 align-top', col.className)}>
                        {col.render(job)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
