/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/advancedjobsearch',
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
