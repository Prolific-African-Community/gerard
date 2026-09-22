import assert from 'node:assert/strict'
import { DEFAULT_BRANDING, normalizeAccentColor, normalizeBrandAssetUrl, resolveBranding } from '../lib/tenant/branding'
import { assertDomainSessionCoherence, normalizeHostname, normalizePathPrefix } from '../lib/tenant/request-resolution'

assert.deepEqual(resolveBranding(null), DEFAULT_BRANDING, 'A: fallback Gerard')
assert.equal(resolveBranding({ displayName: 'QA Transport' }).displayName, 'QA Transport', 'B: custom display name')
assert.equal(resolveBranding({ accentColor: '#2255AA' }).accentColor, '#2255AA', 'C: custom accent')
assert.equal(resolveBranding({ logoUrl: '/qa-logo.png' }).logoUrl, '/qa-logo.png', 'D: custom logo')
assert.equal(normalizeAccentColor('#c8ff00'), '#C8FF00')
assert.equal(normalizeAccentColor('lime'), null)
assert.equal(normalizeBrandAssetUrl('http://unsafe.test/logo.png'), undefined)
assert.equal(normalizeHostname('QA-GERARD.LOCAL:3000'), 'qa-gerard.local', 'G/H: hostname normalized')
assert.equal(normalizePathPrefix('/dispatch/'), '/dispatch')
assert.equal(normalizePathPrefix('../dispatch'), null)
assert.doesNotThrow(() => assertDomainSessionCoherence({ hostname: 'qa.test', pathname: '/', source: 'host', organizationId: 'B', domainId: 'D', status: 'resolved' }, 'B'), 'E: known domain')
assert.throws(() => assertDomainSessionCoherence({ hostname: 'unknown.test', pathname: '/', source: 'host', organizationId: null, domainId: null, status: 'unknown' }, 'A'), /UNKNOWN_ORGANIZATION_DOMAIN/, 'F: unknown domain')
assert.throws(() => assertDomainSessionCoherence({ hostname: 'b.test', pathname: '/', source: 'host', organizationId: 'B', domainId: 'D', status: 'resolved' }, 'A'), /DOMAIN_ORGANIZATION_MISMATCH/, 'I: session/domain mismatch')
assert.doesNotThrow(() => assertDomainSessionCoherence({ hostname: 'localhost', pathname: '/', source: 'host', organizationId: null, domainId: null, status: 'local' }, 'A'), 'local fallback')

console.log('White-label tenant foundation tests passed.')
