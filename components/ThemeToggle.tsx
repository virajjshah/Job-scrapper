'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    // Sync state with whatever the layout script already set on <html>
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
  };

  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={
        'fixed bottom-20 right-4 z-30 w-10 h-10 rounded-full shadow-lg border ' +
        'flex items-center justify-center transition-all hover:scale-110 active:scale-95 ' +
        'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600'
      }
    >
      {dark
        ? <Sun size={18} className="text-yellow-400" />
        : <Moon size={18} className="text-gray-500" />}
    </button>
  );
}
