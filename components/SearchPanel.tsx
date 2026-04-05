'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import { DualSlider } from './ui/DualSlider';
import { clsx } from 'clsx';
import type { SearchFilters, WorkType, EmploymentType } from '@/types/job';
import { INDUSTRIES, DEFAULT_FILTERS } from '@/types/job';

interface SearchPanelProps {
  onSearch: (filters: SearchFilters) => void;
  isLoading: boolean;
}

const WORK_TYPES: WorkType[] = ['Any', 'Remote', 'Hybrid', 'On-site'];
const EMP_TYPES: EmploymentType[] = ['Full-time', 'Part-time', 'Contract'];

function formatSalary(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`;
  return `$${v}`;
}

function formatExp(v: number): string {
  return `${v} yr${v === 1 ? '' : 's'}`;
}

function formatDateDays(v: number): string {
  if (v === 0) return 'Any time';
  if (v === 1) return '24h';
  if (v % 7 === 0) return `${v / 7}w`;
  return `${v}d`;
}

const labelCls = 'block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1';
const inputCls =
  'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm ' +
  'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ' +
  'placeholder-gray-400 dark:placeholder-gray-500 ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500';

export function SearchPanel({ onSearch, isLoading }: SearchPanelProps) {
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [showIndustryDD, setShowIndustryDD] = useState(false);
  const industryRef = useRef<HTMLDivElement>(null);
  const [newUrl, setNewUrl] = useState('');

  // Close industry dropdown on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (industryRef.current && !industryRef.current.contains(e.target as Node)) {
        setShowIndustryDD(false);
      }
    }
    if (showIndustryDD) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showIndustryDD]);

  const update = useCallback(<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleEmpType = useCallback((type: EmploymentType) => {
    setFilters((prev) => ({
      ...prev,
      employmentTypes: prev.employmentTypes.includes(type)
        ? prev.employmentTypes.filter((t) => t !== type)
        : [...prev.employmentTypes, type],
    }));
  }, []);

  const toggleIndustry = useCallback((industry: string) => {
    setFilters((prev) => ({
      ...prev,
      industries: prev.industries.includes(industry)
        ? prev.industries.filter((i) => i !== industry)
        : [...prev.industries, industry],
    }));
  }, []);

  const addCustomUrl = useCallback(() => {
    const trimmed = newUrl.trim();
    if (!trimmed || filters.customUrls.length >= 5) return;
    try {
      new URL(trimmed);
      setFilters((prev) => ({ ...prev, customUrls: [...prev.customUrls, trimmed] }));
      setNewUrl('');
    } catch {
      // invalid URL
    }
  }, [newUrl, filters.customUrls.length]);

  const removeCustomUrl = useCallback((idx: number) => {
    setFilters((prev) => ({
      ...prev,
      customUrls: prev.customUrls.filter((_, i) => i !== idx),
    }));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(filters);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 h-full overflow-y-auto pr-1">
      {/* Keywords */}
      <div>
        <label className={labelCls}>Job Title / Keywords</label>
        <input
          type="text"
          value={filters.keywords}
          onChange={(e) => update('keywords', e.target.value)}
          placeholder="e.g. Marketing Manager, Data Analyst"
          className={inputCls}
          required
        />
      </div>

      {/* Location */}
      <div>
        <label className={labelCls}>Location</label>
        <input
          type="text"
          value={filters.location}
          onChange={(e) => update('location', e.target.value)}
          placeholder="Toronto, ON"
          className={inputCls}
        />
      </div>

      {/* Work Type */}
      <div>
        <label className={labelCls}>Work Type</label>
        <div className="flex gap-1 flex-wrap">
          {WORK_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => update('workType', type)}
              className={clsx(
                'px-3 py-1 text-xs rounded-full border font-medium transition-colors',
                filters.workType === type
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400'
              )}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Date Posted */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Date Posted</label>
          <span
            className={clsx(
              'text-xs font-semibold px-2 py-0.5 rounded-full',
              filters.datePostedDays === 0
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
            )}
          >
            {formatDateDays(filters.datePostedDays)}
          </span>
        </div>
        <div className="flex gap-1 mb-2 flex-wrap">
          {[0, 1, 2, 3, 7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => update('datePostedDays', d)}
              className={clsx(
                'px-2 py-0.5 text-xs rounded border transition-colors',
                filters.datePostedDays === d
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-blue-400'
              )}
            >
              {d === 0 ? 'Any' : d === 1 ? '24h' : d === 2 ? '48h' : d === 3 ? '72h' : d === 7 ? '1w' : d === 14 ? '2w' : '30d'}
            </button>
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={30}
          step={1}
          value={filters.datePostedDays}
          onChange={(e) => update('datePostedDays', Number(e.target.value))}
          aria-label="Max days since posted"
          className="w-full h-1.5 appearance-none bg-gray-200 dark:bg-gray-700 rounded-full cursor-pointer accent-blue-600"
        />
        <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          <span>Any time</span>
          <span>30 days</span>
        </div>
      </div>

      {/* Employment Type */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Employment Type</label>
        <div className="flex flex-col gap-1.5">
          {EMP_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={filters.employmentTypes.includes(type)}
                onChange={() => toggleEmpType(type)}
                className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              {type}
            </label>
          ))}
        </div>
      </div>

      {/* Advanced toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
      >
        {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        {showAdvanced ? 'Hide' : 'Show'} advanced filters
      </button>

      {showAdvanced && (
        <>
          {/* Salary Range */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Salary Range (Annual CAD)
            </label>
            <DualSlider
              label="Salary"
              min={0}
              max={300000}
              step={5000}
              value={[filters.salaryMin, filters.salaryMax]}
              onChange={([min, max]) => setFilters((p) => ({ ...p, salaryMin: min, salaryMax: max }))}
              formatLabel={formatSalary}
            />
            <div className="flex gap-2 mt-2">
              <div className="flex-1">
                <label className="text-xs text-gray-500 dark:text-gray-400">Min</label>
                <input
                  type="number"
                  value={filters.salaryMin}
                  onChange={(e) => update('salaryMin', Math.max(0, Number(e.target.value)))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  min={0} max={300000} step={1000}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 dark:text-gray-400">Max</label>
                <input
                  type="number"
                  value={filters.salaryMax}
                  onChange={(e) => update('salaryMax', Math.min(300000, Number(e.target.value)))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  min={0} max={300000} step={1000}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 mt-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={filters.showNoSalary}
                onChange={(e) => update('showNoSalary', e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              Show jobs with no salary listed
            </label>
          </div>

          {/* Experience Range */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Years of Experience Required
            </label>
            <DualSlider
              label="Experience"
              min={0}
              max={15}
              step={1}
              value={[filters.expMin, filters.expMax]}
              onChange={([min, max]) => setFilters((p) => ({ ...p, expMin: min, expMax: max }))}
              formatLabel={formatExp}
            />
            <label className="flex items-center gap-2 mt-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={filters.showNoExp}
                onChange={(e) => update('showNoExp', e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              Show jobs with no experience listed
            </label>
          </div>

          {/* Industry */}
          <div ref={industryRef} className="relative">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Industry / Sector</label>
            <button
              type="button"
              onClick={() => setShowIndustryDD((v) => !v)}
              className={clsx(
                'w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg border transition-colors',
                'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600',
                'text-gray-700 dark:text-gray-300 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
              )}
            >
              <span>
                {filters.industries.length === 0
                  ? 'All industries'
                  : `${filters.industries.length} selected`}
              </span>
              {showIndustryDD ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showIndustryDD && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                {filters.industries.length > 0 && (
                  <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-700">
                    <button
                      type="button"
                      onClick={() => setFilters((p) => ({ ...p, industries: [] }))}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Clear all
                    </button>
                  </div>
                )}
                {INDUSTRIES.map((ind) => (
                  <label
                    key={ind}
                    className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm text-gray-700 dark:text-gray-300"
                  >
                    <input
                      type="checkbox"
                      checked={filters.industries.includes(ind)}
                      onChange={() => toggleIndustry(ind)}
                      className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 shrink-0"
                    />
                    {ind}
                  </label>
                ))}
              </div>
            )}

            {filters.industries.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {filters.industries.map((ind) => (
                  <span
                    key={ind}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 rounded-full"
                  >
                    {ind}
                    <button
                      type="button"
                      onClick={() => toggleIndustry(ind)}
                      className="hover:text-blue-900 dark:hover:text-blue-200"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Custom Career Pages */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
              Custom Career Pages{' '}
              <span className="font-normal text-gray-500 dark:text-gray-400">({filters.customUrls.length}/5)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://company.com/careers"
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomUrl())}
              />
              <button
                type="button"
                onClick={addCustomUrl}
                disabled={filters.customUrls.length >= 5}
                className="px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 transition-colors"
              >
                <Plus size={14} />
              </button>
            </div>
            {filters.customUrls.map((url, i) => (
              <div key={i} className="flex items-center gap-2 mt-1.5 bg-gray-50 dark:bg-gray-800 rounded px-2 py-1">
                <span className="text-xs text-gray-600 dark:text-gray-400 flex-1 truncate">{url}</span>
                <button
                  type="button"
                  onClick={() => removeCustomUrl(i)}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isLoading || !filters.keywords.trim()}
        className={clsx(
          'w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-semibold text-sm transition-all',
          isLoading || !filters.keywords.trim()
            ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-500 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow-md'
        )}
      >
        <Search size={16} />
        {isLoading ? 'Searching…' : 'Search Jobs'}
      </button>
    </form>
  );
}
