import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import { answerAssistantQuestion, describeSuggestion } from '../lib/dispatch/intelligence/assistant'
import { parseModelIntent, routeAssistantIntent } from '../lib/dispatch/intelligence/intent-router'
import { simulateSuggestion } from '../lib/dispatch/intelligence/facade'
import { classifyIntentWithConfiguredModel, routeIntentWithConfiguredModel } from '../lib/dispatch/intelligence/llm-router'
import assistantHandler from '../pages/api/dispatch/intelligence/assistant'
import { runWithOrganization } from '../lib/auth/organization-context'

const weekStart = new Date(2026, 8, 14)
// Integration assertions must never consume a paid route quota.
process.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION = '0'

function ok(label: string) { console.log(`${label}: OK`) }

async function mutationFingerprint() {
  const [assignments, events, applications] = await Promise.all([
    prisma.missionAssignment.findMany({ orderBy: { id: 'asc' }, select: { id: true, updatedAt: true, driverId: true, truckId: true, trailerId: true, planningRowId: true } }),
    prisma.missionEvent.count(),
    prisma.dispatchOptimizationApplication.count(),
  ])
  return JSON.stringify({ assignments, events, applications })
}

async function main() {
  assert.equal(routeAssistantIntent('Analyse mon planning de cette semaine').intent, 'PLANNING_SUMMARY')
  assert.equal(routeAssistantIntent('Analyse GRD-260916-06').intent, 'MISSION_CONTEXT')
  assert.deepEqual(routeAssistantIntent('Pourquoi pas Julien sur GRD-260916-06 ?'), { intent: 'RESOURCE_EXPLANATION', driverName: 'Julien', missionReference: 'GRD-260916-06' })
  assert.equal(routeAssistantIntent('Pourquoi pas le camion AB-274-XD sur GRD-260916-06 ?').truckPlate, 'AB-274-XD')
  assert.equal(routeAssistantIntent('Pourquoi pas la remorque PL-663-NT sur GRD-260916-06 ?').trailerPlate, 'PL-663-NT')
  assert.equal(routeAssistantIntent('Tu vois quelque chose à optimiser ?').intent, 'PLANNING_SUGGESTIONS')
  assert.equal(routeAssistantIntent('Applique-la').requestsMutation, true)
  assert.equal(routeAssistantIntent('OK applique-la.').requestsMutation, true)
  assert.equal(routeAssistantIntent('Pourquoi Julien est refusé sans modifier le planning ?').requestsMutation, undefined)
  assert.equal(parseModelIntent({ intent: 'INVALID' }), null)
  assert.equal(parseModelIntent('not-json'), null)
  assert.equal(await routeIntentWithConfiguredModel('question', { apiKey: 'test', model: 'test', fetchImpl: async () => { throw new Error('provider down') } }), null)
  assert.equal(await routeIntentWithConfiguredModel('question', { apiKey: 'test', model: 'test', fetchImpl: async () => new Response('{invalid', { status: 200 }) }), null)
  const validModel = await classifyIntentWithConfiguredModel('phrase indirecte', {}, { apiKey: 'test', model: 'test', fetchImpl: async () => new Response(JSON.stringify({ output_text: JSON.stringify({ intent: 'PLANNING_SUMMARY', missionReference: null, driverName: null, truckPlate: null, trailerPlate: null, suggestionId: null, requestsMutation: false }) }), { status: 200 }) })
  assert.equal(validModel.status, 'SUCCESS')
  assert.equal(validModel.intent?.intent, 'PLANNING_SUMMARY')
  const invalidModel = await classifyIntentWithConfiguredModel('phrase indirecte', {}, { apiKey: 'test', model: 'test', fetchImpl: async () => new Response(JSON.stringify({ output_text: '{bad json' }), { status: 200 }) })
  assert.equal(invalidModel.status, 'INVALID_OUTPUT')
  const timeoutModel = await classifyIntentWithConfiguredModel('phrase indirecte', {}, { apiKey: 'test', model: 'test', timeoutMs: 5, fetchImpl: async (_url, init) => await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))) ) })
  assert.equal(timeoutModel.status, 'TIMEOUT')
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.OPENAI_API_KEY
  const originalModel = process.env.OPENAI_MODEL
  process.env.OPENAI_API_KEY = 'test'
  process.env.OPENAI_MODEL = 'test'
  globalThis.fetch = async () => new Response(JSON.stringify({ output_text: '{bad json' }), { status: 200 })
  const safeFallback = await answerAssistantQuestion({ message: 'Est-ce que l’organisation te paraît cohérente ?', weekStart })
  globalThis.fetch = originalFetch
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = originalApiKey
  if (originalModel === undefined) delete process.env.OPENAI_MODEL
  else process.env.OPENAI_MODEL = originalModel
  assert.equal(safeFallback.routing.source, 'FALLBACK')
  assert.match(safeFallback.answer, /suffisamment de précision/)
  ok('Routeur, ambiguïté et sortie modèle invalide')

  const before = await mutationFingerprint()
  const summary = await answerAssistantQuestion({ message: 'Analyse mon planning de cette semaine', weekStart })
  assert.equal(summary.intent, 'PLANNING_SUMMARY')
  assert.deepEqual(summary.routing, { source: 'ROUTER', providerCalls: 0, providerDurationMs: null })
  // Les routes Google restent une dépendance d'intégration : leurs erreurs
  // transitoires doivent être visibles dans les compteurs, pas rendre ce test
  // fonctionnel du routeur dépendant du réseau.
  assert.match(summary.answer, /11 missions analysées, \d+ baselines valides et \d+ alternatives valides/)
  assert.match(summary.answer, /aucune amélioration significative et applicable/)
  ok('A résumé planning réel')

  const mission = await answerAssistantQuestion({ message: 'Analyse GRD-260916-06', weekStart })
  assert.equal(mission.intent, 'MISSION_CONTEXT')
  assert.match(mission.answer, /GRD-260916-06/)
  assert.ok(mission.data?.driverIds.length)
  ok('B mission existante')

  const unknown = await answerAssistantQuestion({ message: 'Analyse GRD-DOES-NOT-EXIST', weekStart })
  assert.match(unknown.answer, /introuvable/)
  ok('C mission inexistante')

  const rejected = await answerAssistantQuestion({ message: 'Pourquoi pas Julien sur GRD-260916-06 ?', weekStart })
  assert.equal(rejected.intent, 'RESOURCE_EXPLANATION')
  assert.match(rejected.answer, /déjà affecté|déjà utilisée|déjà occupé/)
  assert.ok(rejected.warnings.some((item) => item.includes('GRD-260916-07')))
  ok('D chauffeur rejeté par conflit réel')

  const suggestions = await answerAssistantQuestion({ message: 'Tu vois quelque chose à optimiser ?', weekStart })
  assert.equal(suggestions.data?.suggestions?.length, 0)
  assert.match(suggestions.answer, /aucune amélioration significative/)
  ok('E zéro suggestion')

  const fixture = { currentState: { driverName: 'Karim', missionReference: 'GRD-X' }, proposedState: { driverName: 'Julien' }, impact: { emptyKm: { delta: -62 }, estimatedMargin: { delta: 48 } }, confidence: 'MEDIUM' } as any
  assert.match(describeSuggestion(fixture), /62\.0 km à vide et 48\.00 € de marge/)
  ok('F explication suggestion structurée')

  const stale = await simulateSuggestion(weekStart)
  assert.equal(stale.status, 'STALE')
  const simulateReply = await answerAssistantQuestion({ message: 'Simule la meilleure suggestion', weekStart })
  assert.match(simulateReply.answer, /aucune suggestion valide à simuler/)
  ok('G/H simulation sans suggestion et stale')

  const ambiguous = await answerAssistantQuestion({ message: 'Pourquoi pas M sur GRD-260916-06 ?', weekStart })
  assert.ok(ambiguous.answer.includes('ambigu'))
  ok('I ressource inconnue ou ambiguë')

  const contextual = await answerAssistantQuestion({ message: 'Pourquoi cette mission est affectée ici ?', weekStart, conversationContext: { missionReference: 'GRD-260916-06' } })
  assert.match(contextual.answer, /GRD-260916-06/)
  ok('G contexte mission repris')

  const contradicted = await answerAssistantQuestion({ message: 'Je suis sûr qu’il n’y a aucun conflit dans le planning.', weekStart })
  assert.match(contradicted.answer, /11 missions analysées/)
  ok('H affirmation utilisateur vérifiée par Gerard')

  const estimated = await answerAssistantQuestion({ message: 'Combien coûte cette mission exactement ?', weekStart, conversationContext: { missionReference: 'GRD-260916-06' } })
  assert.match(estimated.answer, /estimation/)
  ok('Anti-hallucination coût estimé')

  const mutation = await answerAssistantQuestion({ message: 'Applique-la', weekStart })
  assert.match(mutation.answer, /application depuis l’assistant n’est pas activée/)
  assert.deepEqual(mutation.routing, { source: 'ROUTER', providerCalls: 0, providerDurationMs: null })
  ok('J tentative application refusée')

  let statusCode = 200
  let payload: unknown
  const req = { method: 'POST', body: { message: 'Analyse mon planning', weekStart: '2026-09-14' }, headers: {} } as any
  const res = { status(code: number) { statusCode = code; return this }, json(value: unknown) { payload = value; return this } } as any
  await assistantHandler(req, res)
  assert.equal(statusCode, 401)
  assert.deepEqual(payload, { error: 'Authentification requise' })
  ok('K route sans auth')

  assert.equal(await mutationFingerprint(), before)
  ok('L aucune mutation DB')
}

prisma.organizationUser.findFirst({
  where: { organization: { slug: 'gerard', status: 'ACTIVE' } },
  include: { user: true },
}).then((membership) => {
  if (!membership) {
    console.log('Gerard dataset-specific Intelligence integration: SKIPPED')
    return
  }
  return runWithOrganization({
    organizationId: membership.organizationId,
    organizationRole: membership.role,
    platformRole: membership.user.platformRole,
    userId: membership.userId,
  }, main)
}).finally(() => prisma.$disconnect())
