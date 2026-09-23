/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  devIndicators: false,
  distDir: process.env.GERARD_BUILD_OUTPUT || '.next',
  transpilePackages: ['@prolific/gerard-core'],
  assetPrefix:
    process.env.GERARD_APPLICATION_ID === 'novotralux' ||
    process.env.NEXT_PUBLIC_GERARD_APPLICATION === 'novotralux'
      ? '/novotralux-custom-assets'
      : undefined,
}
