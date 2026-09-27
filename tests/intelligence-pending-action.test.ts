// Le jeton d'action en attente est le seul porteur autorisé des paramètres
// d'écriture de l'assistant. Ce test vérifie la primitive elle-même ; le flux
// complet est couvert par `intelligence-apply.integration.ts`.
process.env.JWT_SECRET ??= 'qa-intelligence-pending-action'

import assert from 'node:assert/strict'

import { createPendingApplyToken, verifyPendingApplyToken } from '../lib/dispatch/intelligence/pending-action'

const base = {
  userId: 'user-dispatcher',
  suggestionId: 'reassignment:0123456789abcdef:mission-1:candidate-1',
  weekStart: '2031-01-06',
  snapshotFingerprint: 'fingerprint-pending-action-0001',
  evidenceFingerprint: 'evidence-pending-action-0001',
}

// A — un jeton émis par le serveur se relit intégralement, et seulement lui.
const issued = createPendingApplyToken(base)
const payload = verifyPendingApplyToken(issued.token, base.userId)
assert.ok(payload)
assert.equal(payload.suggestionId, base.suggestionId)
assert.equal(payload.snapshotFingerprint, base.snapshotFingerprint)
assert.equal(payload.evidenceFingerprint, base.evidenceFingerprint)
assert.equal(payload.weekStart, base.weekStart)
assert.equal(payload.idempotencyKey, issued.payload.idempotencyKey)
assert.ok(payload.idempotencyKey.length >= 16, 'la clé d’idempotence est émise par le serveur')
console.log('A jeton émis puis relu intégralement: OK')

// B — le jeton ne transporte que ce qui est nécessaire : aucune organisation,
// aucune donnée métier. La frontière tenant reste celle du contexte serveur.
assert.deepEqual(Object.keys(payload).sort(), [
  'evidenceFingerprint', 'expiresAt', 'idempotencyKey', 'snapshotFingerprint', 'suggestionId', 'userId', 'weekStart',
])
console.log('B charge utile minimale, sans organisation: OK')

// C — toute altération invalide la signature.
assert.equal(verifyPendingApplyToken(`${issued.token}x`, base.userId), null)
assert.equal(verifyPendingApplyToken(issued.token.replace(/\.[^.]+$/, '.signature-forgee'), base.userId), null)
assert.equal(verifyPendingApplyToken('sans-point', base.userId), null)
assert.equal(verifyPendingApplyToken('', base.userId), null)
const [body] = issued.token.split('.')
const tamperedBody = Buffer.from(
  JSON.stringify({ ...payload, snapshotFingerprint: 'fingerprint-injectee' })
).toString('base64url')
assert.notEqual(tamperedBody, body)
assert.equal(verifyPendingApplyToken(`${tamperedBody}.${issued.token.split('.')[1]}`, base.userId), null)
console.log('C signature et charge utile non falsifiables: OK')

// D — un jeton est lié à son utilisateur et expire.
assert.equal(verifyPendingApplyToken(issued.token, 'user-autre'), null)
assert.equal(
  verifyPendingApplyToken(createPendingApplyToken({ ...base, lifetimeMs: -1 }).token, base.userId),
  null
)
assert.ok(verifyPendingApplyToken(createPendingApplyToken({ ...base, lifetimeMs: 60_000 }).token, base.userId))
console.log('D jeton lié à l utilisateur et expirable: OK')

// E — deux actions préparées pour la même suggestion portent des clés
// d'idempotence distinctes : une nouvelle confirmation ne rejoue pas l'ancienne.
assert.notEqual(createPendingApplyToken(base).payload.idempotencyKey, createPendingApplyToken(base).payload.idempotencyKey)
console.log('E chaque action en attente reçoit sa propre clé: OK')
