'use client';

import { clsx } from 'clsx';
import type { JobSource, WorkType } from '@/types/job';

interface BadgeProps {
  label: string;
  variant?: 'source' | 'workType' | 'default' | 'amber';
  source?: JobSource;
  workType?: WorkType;
}

const SOURCE_STYLES: Record<string, string> = {
  LinkedIn: 'bg-[#0077B5] text-white',
  Custom: 'bg-gray-600 text-white',
};

const WORK_TYPE_STYLES: Record<string, string> = {
  Remote: 'bg-green-100 text-green-800 border border-green-200',
  Hybrid: 'bg-blue-100 text-blue-800 border border-blue-200',
  'On-site': 'bg-orange-100 text-orange-800 border border-orange-200',
  Any: 'bg-gray-100 text-gray-700 border border-gray-200',
};

export function Badge({ label, variant = 'default', source, workType }: BadgeProps) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap';

  if (variant === 'source' && source) {
    return <span className={clsx(base, SOURCE_STYLES[source] ?? 'bg-gray-500 text-white')}>{label}</span>;
  }

  if (variant === 'workType' && workType) {
    return <span className={clsx(base, WORK_TYPE_STYLES[workType] ?? 'bg-gray-100 text-gray-700')}>{label}</span>;
  }

  if (variant === 'amber') {
    return <span className={clsx(base, 'bg-amber-100 text-amber-800 border border-amber-200')}>{label}</span>;
  }

  return <span className={clsx(base, 'bg-gray-100 text-gray-700')}>{label}</span>;
}
