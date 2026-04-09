'use client';

import { Search } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="w-20 h-20 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center">
        <Search size={36} className="text-blue-400 dark:text-blue-500" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">Ready to find your next role</h2>
        <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-sm">
          Tap the search bar below (or use the left panel on desktop), set your preferences, and hit{' '}
          <strong>Search Jobs</strong>.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center mt-2">
        {['Toronto/GTA focused', 'Deduplication built-in', 'Salary & experience parsing', 'Google Sheets export'].map(
          (feature) => (
            <span key={feature} className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs rounded-full">
              {feature}
            </span>
          )
        )}
      </div>
    </div>
  );
}
