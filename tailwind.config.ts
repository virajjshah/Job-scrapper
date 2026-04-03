import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        linkedin: '#0077B5',
        indeed: '#2164F3',
        glassdoor: '#0CAA41',
        gray: {
          950: '#0a0f1a',
        },
      },
    },
  },
  plugins: [],
}
export default config
