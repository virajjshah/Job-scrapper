import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Job Scraper — Toronto/GTA',
  description: 'Search LinkedIn, Indeed & Glassdoor jobs in the Toronto/GTA area. Filter by salary, experience, work type, and more.',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔍</text></svg>",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
