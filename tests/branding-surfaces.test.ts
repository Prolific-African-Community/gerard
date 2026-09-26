import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { novotraluxBranding } from '../apps/novotralux/branding'
import { resolveRuntimeBranding } from '../lib/runtime/branding-registry'
import {
  BRAND_ASSET_MAX_BYTES,
  brandAssetBlobPath,
  brandAssetExtension,
  isBrandAssetKind,
  validateBrandAsset,
} from '../lib/tenant/brand-assets'
import { DEFAULT_BRANDING, resolveBranding } from '../lib/tenant/branding'

const root = path.resolve(process.cwd())
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

// ─── A. Fallback: an organization without branding renders the Gerard identity ───────────────────────────
const empty = resolveBranding(null)
assert.deepEqual(empty, DEFAULT_BRANDING, 'no branding at all falls back to Gerard')
assert.equal(resolveBranding({ displayName: 'Transport X' }).logoUrl, DEFAULT_BRANDING.logoUrl, 'no logoUrl keeps the Gerard logo')
assert.equal(resolveBranding({ logoUrl: '   ' }).logoUrl, DEFAULT_BRANDING.logoUrl, 'a blank logoUrl is not a logo')
assert.equal(resolveBranding({ displayName: 'Transport X' }).applicationTitle, 'Transport X', 'the title follows the organization name')

// ─── B. A custom organization renders its own logo, whatever its name ───────────────────────────────────
const custom = resolveBranding({ displayName: 'Transport X', logoUrl: '/logo-transport-x.png', accentColor: '#123456', applicationTitle: 'Transport X Dispatch' })
assert.equal(custom.logoUrl, '/logo-transport-x.png')
assert.equal(custom.accentColor, '#123456')
assert.equal(custom.applicationTitle, 'Transport X Dispatch')
assert.equal(resolveBranding({ logoUrl: 'https://cdn.example.com/logo.svg' }).logoUrl, 'https://cdn.example.com/logo.svg', 'an uploaded or external URL is used as-is')

// ─── C. Favicon precedence: faviconUrl → logoUrl → Gerard default ───────────────────────────────────────
assert.equal(resolveBranding({ faviconUrl: '/fav.ico', logoUrl: '/logo.png' }).faviconUrl, '/fav.ico', 'the configured favicon wins')
assert.equal(resolveBranding({ logoUrl: '/logo.png' }).faviconUrl, '/logo.png', 'without a favicon the logo is used')
assert.equal(resolveBranding({}).faviconUrl, DEFAULT_BRANDING.faviconUrl, 'without either, the Gerard favicon is used')
assert.equal(resolveBranding({ faviconUrl: '  ', logoUrl: '/logo.png' }).faviconUrl, '/logo.png', 'a blank favicon falls through to the logo')

// The tab title and icon are rendered through next/head from the branding state: an imperative DOM mutation
// would be reverted by Next, and a page-level hardcoded icon would win over the tenant's.
const provider = read('components/branding/BrandingProvider.tsx')
assert.match(provider, /<link rel="icon" href=\{branding\.faviconUrl\} \/>/, 'the icon is rendered from branding')
assert.match(provider, /<title>\{branding\.applicationTitle\}<\/title>/, 'the title is rendered from branding')
const appShell = read('pages/_app.tsx')
assert.doesNotMatch(appShell, /rel="icon"/, '_app must not declare a hardcoded favicon')
assert.doesNotMatch(appShell, /<title>/, '_app must not declare a hardcoded title')

// ─── D. Upload validation ───────────────────────────────────────────────────────────────────────────────
for (const mimeType of ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon']) {
  assert.equal(validateBrandAsset({ mimetype: mimeType, size: 2048 }), null, `${mimeType} is accepted`)
  assert.ok(brandAssetExtension(mimeType), `${mimeType} has an extension`)
}
for (const mimeType of ['application/pdf', 'text/html', 'application/octet-stream', 'image/gif', null, undefined, '']) {
  assert.equal(validateBrandAsset({ mimetype: mimeType, size: 2048 }), 'BRAND_ASSET_TYPE_UNSUPPORTED', `${mimeType} is rejected`)
}
assert.equal(validateBrandAsset({ mimetype: 'image/png', size: BRAND_ASSET_MAX_BYTES + 1 }), 'BRAND_ASSET_TOO_LARGE')
assert.equal(validateBrandAsset({ mimetype: 'image/png', size: BRAND_ASSET_MAX_BYTES }), null, 'exactly at the limit is accepted')
assert.equal(validateBrandAsset({ mimetype: 'image/png', size: 0 }), 'BRAND_ASSET_EMPTY')
assert.ok(isBrandAssetKind('logo') && isBrandAssetKind('favicon') && !isBrandAssetKind('avatar'))

// The stored path is generated, so a hostile filename or organization id cannot escape the prefix.
const blobPath = brandAssetBlobPath('org-example', 'logo', 'image/png', new Date(1700000000000))
assert.equal(blobPath, 'organizations/org-example/branding/logo-1700000000000.png')
const hostile = brandAssetBlobPath('../../etc', 'favicon', 'image/svg+xml')
assert.doesNotMatch(hostile, /\.\./, 'no dot segment survives')
assert.match(hostile, /^organizations\/[a-zA-Z0-9_-]+\/branding\/favicon-\d+\.svg$/, 'the organization id is sanitized, with no traversal segment')
assert.throws(() => brandAssetBlobPath('org-example', 'logo', 'application/pdf'), /BRAND_ASSET_TYPE_UNSUPPORTED/)

// The Blob token is read server-side only and never returned to the client.
const uploadRoute = read('pages/api/admin/organization/branding-asset.ts')
assert.match(uploadRoute, /process\.env\.BLOB_READ_WRITE_TOKEN/, 'the route reads the token server-side')
assert.match(uploadRoute, /BRAND_ASSET_STORAGE_UNAVAILABLE/, 'a missing token is reported as unavailable, not a crash')
assert.doesNotMatch(uploadRoute, /json\([^)]*token/, 'the token is never serialized to the client')
assert.match(uploadRoute, /requireOrganizationAdmin/, 'the upload is restricted to organization administrators')
const adminPage = read('pages/admin.tsx')
assert.doesNotMatch(adminPage, /BLOB_READ_WRITE_TOKEN/, 'the client bundle never references the Blob token')

// ─── E. No client name is hardcoded in the shared UI ────────────────────────────────────────────────────
const sharedSurfaces = [
  'pages/_app.tsx', 'pages/login.tsx', 'pages/change-password.tsx', 'pages/driver.tsx', 'pages/admin.tsx',
  'components/site/SiteHeader.tsx', 'components/branding/BrandingProvider.tsx', 'components/branding/OrganizationLogo.tsx',
  'lib/tenant/branding.ts', 'lib/tenant/brand-assets.ts',
]
for (const file of sharedSurfaces) {
  const source = read(file)
  assert.doesNotMatch(source, /novotralux/i, `${file} must not mention a client`)
  // Only the centralized Gerard fallback may name a Gerard asset.
  if (file !== 'lib/tenant/branding.ts') {
    assert.doesNotMatch(source, /logo[-_]gerard|logo_gerard_texte/i, `${file} must not hardcode a Gerard logo asset`)
  }
}
// The shared header and the login page render the organization logo component, not an <img> of their own.
for (const file of ['components/site/SiteHeader.tsx', 'pages/login.tsx', 'pages/change-password.tsx', 'pages/driver.tsx']) {
  assert.match(read(file), /<OrganizationLogo/, `${file} renders the organization logo`)
}

// The Custom instance fallback ships repository assets rather than an external host, and stays overridable.
assert.equal(resolveRuntimeBranding('novotralux'), novotraluxBranding)
assert.equal(resolveRuntimeBranding('gerard-standard'), DEFAULT_BRANDING)
assert.equal(resolveRuntimeBranding('unknown-application'), DEFAULT_BRANDING, 'an unknown application falls back to Gerard')
for (const asset of [novotraluxBranding.logoUrl, novotraluxBranding.faviconUrl]) {
  assert.match(asset, /^\//, 'Custom fallback assets are served by this repository')
  readFileSync(path.join(root, 'public', asset.replace(/^\//, '')))
}

console.log('Branding surfaces: fallback, custom logo, favicon precedence, upload validation and no client hardcoding: OK')
