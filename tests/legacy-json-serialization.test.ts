import assert from 'node:assert/strict'
import { serializeLegacyJsonValue } from '../lib/legacy-migration/executor'

const cases: Array<[string, unknown, string | null, unknown]> = [
  ['A object', { name: 'Acme' }, '{"name":"Acme"}', { name: 'Acme' }],
  ['B array', ['a', 'b'], '["a","b"]', ['a', 'b']],
  ['C nested object', { contacts: [{ type: 'email', active: true }] }, '{"contacts":[{"type":"email","active":true}]}', { contacts: [{ type: 'email', active: true }] }],
  ['D null', null, null, null],
  ['E serialized JSON string', '{"ready":true}', '{"ready":true}', { ready: true }],
  ['F plain string', 'plain text', '"plain text"', 'plain text'],
  ['G boolean', true, 'true', true],
  ['H number', 42, '42', 42],
  ['I PostgreSQL parsed value', { billing: { vat: 17 }, emails: ['billing@example.test'] }, '{"billing":{"vat":17},"emails":["billing@example.test"]}', { billing: { vat: 17 }, emails: ['billing@example.test'] }],
]

for (const [name, input, expectedSerialized, expectedParsed] of cases) {
  const serialized = serializeLegacyJsonValue(input)
  assert.equal(serialized, expectedSerialized, name)
  assert.deepEqual(serialized === null ? null : JSON.parse(serialized), expectedParsed, `${name} round-trip`)
}

const alreadySerialized = '[{"domain":"example.test"}]'
assert.equal(serializeLegacyJsonValue(alreadySerialized), alreadySerialized, 'J valid JSON must not be double-stringified')

const clientProfile = {
  emailDomains: ['example.test'],
  contactEmails: ['ops@example.test'],
  contactPhones: [],
  billingInfo: { currency: 'EUR' },
  defaultRequirements: { straps: true },
  defaultContacts: { dispatcher: 'Operations' },
  parserHints: { aliases: ['ACME'] },
}
for (const value of Object.values(clientProfile)) assert.doesNotThrow(() => JSON.parse(serializeLegacyJsonValue(value)!))

console.log('A-J legacy JSON serialization and ClientProfile fixture: OK')
