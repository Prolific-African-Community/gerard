// Audit final de sûreté de Gerard Intelligence.
//
// Il ne remplace pas les tests de comportement : il verrouille la forme de la
// surface, pour qu'une écriture métier ne puisse pas réapparaître ailleurs que
// sur le chemin confirmé.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const writeOperations = /\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(/

function sourcesIn(directory: string) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
}

const intelligenceSources = [
  ...sourcesIn('lib/dispatch/intelligence'),
  ...sourcesIn('pages/api/dispatch/intelligence'),
  ...sourcesIn('lib/dispatch/suggestions'),
]

// A — une seule porte d'écriture métier dans tout le périmètre Intelligence.
const writers = intelligenceSources.filter((file) => {
  const source = readFileSync(file, 'utf8')
  return source
    .split('\n')
    // Les condensés (`createHash(...).update(...)`) ne sont pas des écritures.
    .filter((line) => !/createHash|createHmac|\.digest\(/.test(line))
    .some((line) => writeOperations.test(line) && /prisma|\btx\b/.test(line))
})
assert.deepEqual(
  writers,
  [path.join('lib/dispatch/suggestions', 'application.ts')],
  `l’écriture métier doit rester confinée à application.ts, trouvée aussi dans : ${writers.join(', ')}`
)
console.log('A une seule porte d écriture métier dans tout le périmètre: OK')

// B — la surface proactive et la façade ne contiennent aucune écriture.
for (const file of [
  'lib/dispatch/intelligence/insights.ts',
  'lib/dispatch/intelligence/facade.ts',
  'lib/dispatch/intelligence/assistant-interaction.ts',
  'pages/api/dispatch/intelligence/insights.ts',
  'pages/api/dispatch/intelligence/analyze.ts',
  'pages/api/dispatch/intelligence/simulate.ts',
]) {
  const source = readFileSync(file, 'utf8')
  const offending = source
    .split('\n')
    .filter((line) => !/createHash|createHmac|\.digest\(/.test(line))
    .filter((line) => writeOperations.test(line) && /prisma|\btx\b/.test(line))
  assert.deepEqual(offending, [], `${file} doit rester en lecture seule`)
}
console.log('B insights, façade et routes de lecture sans écriture: OK')

// C — l'application n'est appelée que depuis le chemin confirmé.
const callers = [...sourcesIn('lib/dispatch/intelligence'), ...sourcesIn('pages/api/dispatch/intelligence')]
  .filter((file) => /applyPlanningSuggestion\s*\(/.test(readFileSync(file, 'utf8')))
  .map((file) => path.basename(file))
  .sort()
assert.deepEqual(
  callers,
  ['apply.ts', 'assistant.ts'],
  `seuls la route d’application et la confirmation de l’assistant peuvent appliquer, trouvés : ${callers.join(', ')}`
)
console.log('C application appelée uniquement depuis les deux chemins confirmés: OK')

// D — les deux appelants passent par un jeton signé, jamais par le corps brut.
for (const file of ['pages/api/dispatch/intelligence/apply.ts', 'lib/dispatch/intelligence/assistant.ts']) {
  const source = readFileSync(file, 'utf8')
  assert.match(source, /verifyPendingApplyToken/, `${file} doit vérifier un jeton signé`)
  assert.match(source, /suggestionId: pending\.suggestionId/, `${file} doit lire la suggestion dans le jeton`)
  assert.match(source, /snapshotFingerprint: pending\.snapshotFingerprint/, `${file} doit lire l’empreinte dans le jeton`)
  assert.match(source, /evidenceFingerprint: pending\.evidenceFingerprint/, `${file} doit lire l’empreinte de preuve dans le jeton`)
  assert.match(source, /idempotencyKey: pending\.idempotencyKey/, `${file} doit lire la clé dans le jeton`)
}
console.log('D les deux chemins lisent leurs paramètres dans le jeton signé: OK')

// E — l'application exige la permission d'affectation, la lecture ne suffit pas.
const applyRoute = readFileSync('pages/api/dispatch/intelligence/apply.ts', 'utf8')
assert.match(applyRoute, /requirePermission\(req, res, permissions\.dispatchAssign\)/)
const assistantRoute = readFileSync('pages/api/dispatch/intelligence/assistant.ts', 'utf8')
assert.match(assistantRoute, /if \(confirmation\) \{[\s\S]*permissions\.dispatchAssign/)
console.log('E l application exige dispatch.assign sur les deux routes: OK')

// F — toute route métier Intelligence reste sous le contexte tenant.
for (const file of sourcesIn('pages/api/dispatch/intelligence')) {
  assert.match(readFileSync(file, 'utf8'), /export default withTenantApiRoute\(handler\)/, `${file} doit rester scoppée au tenant`)
}
console.log('F toutes les routes Intelligence restent scoppées au tenant: OK')

// G — aucune journalisation ne transporte de jeton, de clé ou de secret.
const observability = readFileSync('lib/dispatch/intelligence/observability.ts', 'utf8')
assert.ok(!/token|idempotencyKey|secret|apiKey/i.test(observability.replace(/^.*jeton.*$/gm, '')),
  'le journal ne doit jamais accepter de champ sensible')
assert.match(observability, /getActiveOrganizationContext/, 'l’organisation vient du contexte serveur')
console.log('G le journal n expose aucun champ sensible: OK')
