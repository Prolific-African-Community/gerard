/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  devIndicators: false,
  distDir: process.env.GERARD_BUILD_OUTPUT || '.next',
  transpilePackages: ['@prolific/gerard-core'],
  env: {
    // Next/Turbopack must inline the public browser key in the Custom bundle.
    // The server-only GOOGLE_MAPS_API_KEY is deliberately never exposed here.
    NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY:
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY,
  },
  assetPrefix:
    process.env.GERARD_APPLICATION_ID === 'novotralux' ||
    process.env.NEXT_PUBLIC_GERARD_APPLICATION === 'novotralux'
      ? '/novotralux-custom-assets'
      : undefined,
}
