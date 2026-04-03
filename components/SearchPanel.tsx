'use client';

import { useState, useCallback } from 'react';
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

/** Convert slider value (0–30) to human label */
function formatDateDays(v: number): string {
  if (v === 0) return 'Any time';
  if (v === 1) return '24 hrs';
  if (v % 7 === 0) return `${v / 7} wk${v / 7 > 1 ? 's' : ''}`;
  return `${v} days`;
}

export function SearchPanel({ onSearch, isLoading }: SearchPanelProps) {
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [newUrl, setNewUrl] = useState('');

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
        <label className="block text-sm font-semibold text-gray-700 mb-1">Job Title / Keywords</label>
        <input
          type="text"
          value={filters.keywords}
          onChange={(e) => update('keywords', e.target.value)}
          placeholder="e.g. Marketing Manager, Data Analyst"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
      </div>

      {/* Location */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Location</label>
        <input
          type="text"
          value={filters.location}
          onChange={(e) => update('location', e.target.value)}
          placeholder="Toronto, ON"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Work Type */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Work Type</label>
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
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
              )}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Date Posted — custom slider */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-gray-700">Date Posted</label>
          <span
            className={clsx(
              'text-xs font-semibold px-2 py-0.5 rounded-full',
              filters.datePostedDays === 0
                ? 'bg-gray-100 text-gray-500'
                : 'bg-blue-100 text-blue-700'
            )}
          >
            {formatDateDays(filters.datePostedDays)}
          </span>
        </div>
        {/* Quick presets */}
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
                  : 'bg-white text-gray-500 border-gray-300 hover:border-blue-400'
              )}
            >
              {d === 0 ? 'Any' : d === 1 ? '24h' : d === 2 ? '48h' : d === 3 ? '72h' : d === 7 ? '1wk' : d === 14 ? '2wk' : '30d'}
            </button>
          ))}
        </div>
        {/* Fine-grain slider: 0–30 days */}
        <input
          type="range"
          min={0}
          max={30}
          step={1}
          value={filters.datePostedDays}
          onChange={(e) => update('datePostedDays', Number(e.target.value))}
          aria-label="Max days since posted"
          className="w-full h-1.5 appearance-none bg-gray-200 rounded-full cursor-pointer accent-blue-600"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-0.5">
          <span>Any time</span>
          <span>30 days</span>
        </div>
      </div>

      {/* Employment Type */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Employment Type</label>
        <div className="flex flex-col gap-1.5">
          {EMP_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input
                type="checkbox"
                checked={filters.employmentTypes.includes(type)}
                onChange={() => toggleEmpType(type)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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
        className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
      >
        {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        {showAdvanced ? 'Hide' : 'Show'} advanced filters
      </button>

      {showAdvanced && (
        <>
          {/* Salary Range */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
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
                <label className="text-xs text-gray-500">Min</label>
                <input
                  type="number"
                  value={filters.salaryMin}
                  onChange={(e) => update('salaryMin', Math.max(0, Number(e.target.value)))}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  min={0} max={300000} step={1000}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500">Max</label>
                <input
                  type="number"
                  value={filters.salaryMax}
                  onChange={(e) => update('salaryMax', Math.min(300000, Number(e.target.value)))}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  min={0} max={300000} step={1000}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 mt-2 cursor-pointer text-sm text-gray-700">
              <input
                type="checkbox"
                checked={filters.showNoSalary}
                onChange={(e) => update('showNoSalary', e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Show jobs with no salary listed
            </label>
          </div>

          {/* Experience Range */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
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
            <label className="flex items-center gap-2 mt-2 cursor-pointer text-sm text-gray-700">
              <input
                type="checkbox"
                checked={filters.showNoExp}
                onChange={(e) => update('showNoExp', e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Show jobs with no experience listed
            </label>
          </div>

          {/* Industry */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Industry / Sector</label>
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
              {INDUSTRIES.map((ind) => (
                <button
                  key={ind}
                  type="button"
                  onClick={() => toggleIndustry(ind)}
                  className={clsx(
                    'px-2 py-0.5 text-xs rounded-full border transition-colors',
                    filters.industries.includes(ind)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                  )}
                >
                  {ind}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Career Pages */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Custom Career Pages{' '}
              <span className="font-normal text-gray-500">({filters.customUrls.length}/5)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://company.com/careers"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomUrl())}
              />
              <button
                type="button"
                onClick={addCustomUrl}
                disabled={filters.customUrls.length >= 5}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg border border-gray-300 disabled:opacity-50 transition-colors"
              >
                <Plus size={14} />
              </button>
            </div>
            {filters.customUrls.map((url, i) => (
              <div key={i} className="flex items-center gap-2 mt-1.5 bg-gray-50 rounded px-2 py-1">
                <span className="text-xs text-gray-600 flex-1 truncate">{url}</span>
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
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow-md'
        )}
      >
        <Search size={16} />
        {isLoading ? 'Searching…' : 'Search Jobs'}
      </button>
    </form>
  );
}
