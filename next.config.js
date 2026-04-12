/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/advancedjobsearch',
  experimental: {
    serverComponentsExternalPackages: ['playwright'],
  },
};

module.exports = nextConfig;
