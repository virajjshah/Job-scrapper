import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-4">
      <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">Page not found</h2>
      <p className="text-gray-500 dark:text-gray-400">The page you are looking for does not exist.</p>
      <Link
        href="/"
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
      >
        Go home
      </Link>
    </div>
  );
}
