import assert from 'node:assert/strict'
import { createPlatformConfigurationRequest, verifyPlatformConfigurationRequest } from '../lib/platform/configuration-channel'

process.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET = 'run-9c1-test-only-channel-secret'

const base = { application: 'novotralux', organizationId: 'org-novotralux', action: 'updateBranding' as const, payload: { accentColor: '#123456' } }
const signed = createPlatformConfigurationRequest({ ...base, timestamp: Math.floor(Date.now() / 1000) })
assert.equal(verifyPlatformConfigurationRequest(signed.request, signed.signature, 'novotralux', 'org-novotralux').ok, true, 'valid request accepted')
assert.equal(verifyPlatformConfigurationRequest(signed.request, signed.signature, 'other', 'org-novotralux').ok, false, 'wrong instance rejected')
assert.equal(verifyPlatformConfigurationRequest(signed.request, `${signed.signature.slice(0, -2)}00`, 'novotralux', 'org-novotralux').ok, false, 'invalid signature rejected')
const expired = createPlatformConfigurationRequest({ ...base, timestamp: Math.floor(Date.now() / 1000) - 301, nonce: 'expired-nonce-123456' })
assert.equal(verifyPlatformConfigurationRequest(expired.request, expired.signature, 'novotralux', 'org-novotralux').ok, false, 'expired request rejected')
const replay = createPlatformConfigurationRequest({ ...base, nonce: 'replay-nonce-123456' })
assert.equal(verifyPlatformConfigurationRequest(replay.request, replay.signature, 'novotralux', 'org-novotralux').ok, true, 'first nonce accepted')
assert.equal(verifyPlatformConfigurationRequest(replay.request, replay.signature, 'novotralux', 'org-novotralux').ok, false, 'replay rejected')
console.log('Platform-to-Custom signing, expiry, instance binding and replay protection: OK')
