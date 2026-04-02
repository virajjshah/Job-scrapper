'use client';

import { useState, useMemo, useCallback } from 'react';
import { ExternalLink, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { Badge } from './ui/Badge';
import { clsx } from 'clsx';
import type { Job, SortField, SortDir, SortState } from '@/types/job';

interface ResultsTableProps {
  jobs: Job[];
  totalBySource: Record<string, number>;
  errors: Record<string, string | null>;
  durationMs: number;
  onExport: () => void;
  isExporting: boolean;
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
        className="font-medium text-blue-700 hover:text-blue-900 hover:underline"
      >
        {job.title}
      </a>
    ),
    className: 'min-w-[200px] max-w-[280px]',
  },
  {
    label: 'Company',
    field: 'company',
    render: (job) => <span className="text-gray-900">{job.company}</span>,
    className: 'min-w-[140px]',
  },
  {
    label: 'Location',
    field: 'location',
    render: (job) => (
      <div className="flex flex-col gap-1">
        <span className="text-sm text-gray-700">{job.location}</span>
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
        <span className={clsx('text-sm', job.hasCommission ? 'text-amber-700 font-medium' : 'text-gray-700')}>
          {job.salaryDisplay}
        </span>
        {job.salary?.isEstimated && (
          <span className="text-xs text-gray-400">~Annual est.</span>
        )}
        {job.hasCommission && job.salary?.commissionNote && (
          <Badge label={job.salary.commissionNote} variant="amber" />
        )}
      </div>
    ),
    className: 'min-w-[160px]',
  },
  {
    label: 'Yrs Exp',
    field: 'yearsExperience',
    render: (job) => (
      <span className={clsx('text-sm', !job.yearsExperience && job.yearsExperience !== 0 ? 'text-gray-400 italic' : 'text-gray-700')}>
        {job.yearsExperienceDisplay}
      </span>
    ),
    className: 'min-w-[100px]',
  },
  {
    label: 'Type',
    field: 'employmentType',
    render: (job) => (
      <span className="text-sm text-gray-700">{job.employmentType ?? <span className="text-gray-400 italic">—</span>}</span>
    ),
    className: 'min-w-[100px]',
  },
  {
    label: 'Posted',
    field: 'datePostedRaw',
    render: (job) => <span className="text-sm text-gray-600 whitespace-nowrap">{job.datePosted}</span>,
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
        href={job.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 hover:border-blue-400 rounded px-2 py-1 transition-colors"
      >
        View <ExternalLink size={11} />
      </a>
    ),
    className: 'min-w-[70px]',
  },
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
    default: return '';
  }
}

function SortIcon({ field, sort }: { field: SortField | null; sort: SortState }) {
  if (!field || sort.field !== field) return <ChevronsUpDown size={13} className="text-gray-400 opacity-60" />;
  return sort.dir === 'asc'
    ? <ChevronUp size={13} className="text-blue-500" />
    : <ChevronDown size={13} className="text-blue-500" />;
}

export function ResultsTable({ jobs, totalBySource, errors, durationMs, onExport, isExporting }: ResultsTableProps) {
  const [sort, setSort] = useState<SortState>({ field: 'datePostedRaw', dir: 'desc' });
  const [hideDuplicates] = useState(true); // Duplicates are already removed server-side; toggle is UX only
  const [filter, setFilter] = useState('');

  const handleSort = useCallback((field: SortField | null) => {
    if (!field) return;
    setSort((prev) =>
      prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' }
    );
  }, []);

  const displayed = useMemo(() => {
    let list = [...jobs];

    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.company.toLowerCase().includes(q) ||
          j.location.toLowerCase().includes(q) ||
          j.salaryDisplay.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      const av = getSortValue(a, sort.field);
      const bv = getSortValue(b, sort.field);
      if (av === bv) return 0;
      if (av === null || av === -1) return 1;
      if (bv === null || bv === -1) return -1;
      const cmp = av < bv ? -1 : 1;
      return sort.dir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [jobs, filter, sort]);

  const sourceCount = Object.entries(totalBySource)
    .filter(([, n]) => n > 0)
    .map(([src, n]) => `${n} from ${src}`)
    .join(', ');

  const errorMessages = Object.entries(errors).filter(([, msg]) => msg !== null);

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{displayed.length} jobs found</span>
            {sourceCount && <span className="ml-1 text-gray-400">({sourceCount})</span>}
            {durationMs > 0 && (
              <span className="ml-2 text-xs text-gray-400">in {(durationMs / 1000).toFixed(1)}s</span>
            )}
          </p>
        </div>

        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter results…"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
        />

        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={hideDuplicates} readOnly className="rounded border-gray-300 text-blue-600" />
          Hide duplicates
        </label>

        <button
          onClick={onExport}
          disabled={isExporting || jobs.length === 0}
          className={clsx(
            'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors',
            isExporting || jobs.length === 0
              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700 text-white border-green-600 shadow-sm'
          )}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.56 3H4.44C3.09 3 2 4.09 2 5.44v13.12C2 19.91 3.09 21 4.44 21h15.12C20.91 21 22 19.91 22 18.56V5.44C22 4.09 20.91 3 19.56 3zM9 17H6v-2h3v2zm0-4H6v-2h3v2zm0-4H6V7h3v2zm4 8h-3v-2h3v2zm0-4h-3v-2h3v2zm0-4h-3V7h3v2zm5 8h-4v-2h4v2zm0-4h-4v-2h4v2zm0-4h-4V7h4v2z" />
          </svg>
          {isExporting ? 'Exporting…' : 'Export to Google Sheets'}
        </button>
      </div>

      {/* Error banners */}
      {errorMessages.map(([src, msg]) => (
        <div key={src} className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2">
          <strong>{src} unavailable:</strong> {msg}
        </div>
      ))}

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-gray-200 shadow-sm">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              {COLUMNS.map((col) => (
                <th
                  key={col.label}
                  onClick={() => handleSort(col.field)}
                  className={clsx(
                    'px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap',
                    col.field ? 'cursor-pointer hover:bg-gray-100 select-none' : '',
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
          <tbody className="divide-y divide-gray-100">
            {displayed.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-gray-400 text-sm">
                  No jobs found. Try adjusting your search criteria.
                </td>
              </tr>
            ) : (
              displayed.map((job) => (
                <tr
                  key={job.id}
                  className={clsx(
                    'hover:bg-gray-50 transition-colors',
                    job.hasCommission ? 'bg-amber-50 hover:bg-amber-100' : ''
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
    </div>
  );
}
