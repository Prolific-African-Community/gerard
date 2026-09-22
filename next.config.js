/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  devIndicators: false,
  distDir: process.env.GERARD_BUILD_OUTPUT || '.next',
  transpilePackages: ['@prolific/gerard-core'],
}
