'use client';

export function LoadingSpinner({ message = 'Scraping jobs\u2026' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      {/* 3D coin-flip animation — logo only, no back face */}
      <div className="coin-scene">
        <div className="coin">
          <div className="coin-face">
            <img
              src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/logo.svg`}
              alt="Career Katalyst"
              className="w-full h-full object-contain"
              draggable={false}
            />
          </div>
        </div>
      </div>

      <div className="text-center">
        <p className="text-gray-700 dark:text-gray-200 font-semibold text-base">{message}</p>
        <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
          Searching LinkedIn. This may take up to a minute.
        </p>
        <p className="text-gray-400 dark:text-gray-500 text-sm mt-3 italic">
          Results are scraped live. Salary, experience, and repost data may not always be accurate.
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
