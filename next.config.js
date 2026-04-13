/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/advancedjobsearch',
  env: {
    NEXT_PUBLIC_BASE_PATH: '/advancedjobsearch',
  },
  experimental: {
    serverComponentsExternalPackages: ['playwright'],
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/advancedjobsearch',
        permanent: false,
        basePath: false,
      },
    ];
  },
};

module.exports = nextConfig;
