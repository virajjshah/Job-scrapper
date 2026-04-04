import type { Metadata } from 'next';
import { Gabarito } from 'next/font/google';
import './globals.css';

const gabarito = Gabarito({
  subsets: ['latin'],
  variable: '--font-gabarito',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Job Scraper — Toronto/GTA',
  description: 'Search LinkedIn, Indeed & Glassdoor jobs in the Toronto/GTA area. Filter by salary, experience, work type, and more.',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔍</text></svg>",
  },
};

// Inline script applied before React hydrates to avoid flash-of-wrong-theme
const themeScript = `
try {
  var t = localStorage.getItem('theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch(e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={gabarito.variable}>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 antialiased font-gabarito">
        {children}
      </body>
    </html>
  );
}
