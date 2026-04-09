'use client';

export function LoadingSpinner({ message = 'Scraping jobs…' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-gray-200 dark:border-gray-700" />
        <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-gray-700 dark:text-gray-200 font-semibold text-base">{message}</p>
        <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
          Searching LinkedIn — this may take 1–2 minutes
        </p>
        <p className="text-gray-300 dark:text-gray-600 text-xs mt-3 italic">
          Results are scraped using AI. Salary, experience, and repost data may not always be accurate.
        </p>
      </div>
      <div className="flex gap-3 mt-2">
        <span
          className="px-3 py-1 rounded-full text-xs font-medium text-white animate-pulse"
          style={{ backgroundColor: '#0077B5' }}
        >
          LinkedIn
        </span>
      </div>
    </div>
  );
}
