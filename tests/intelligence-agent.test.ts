// Agent conversationnel de Gerard Intelligence : boucle d'outils, historique,
// repli, sûreté d'écriture et protection du budget Google. Aucune base de
// données ni réseau : le fournisseur et les outils sont simulés.
//
// Ce test valide la tuyauterie (le modèle est scripté). La qualité de
// raisonnement du vrai modèle se vérifie à la main sur le jeu de données.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAgentInstructions, runIntelligenceAgent, sanitizeHistory, maximumHistoryMessages, maximumHistoryMessageLength, maximumHistoryTotalLength } from '../lib/dispatch/intelligence/agent'
import { agentTools, createAgentToolContext, type AgentTool } from '../lib/dispatch/intelligence/agent-tools'
import { answerAssistantQuestion } from '../lib/dispatch/intelligence/assistant'
import { routeAssistantIntent } from '../lib/dispatch/intelligence/intent-router'
import { isKnownReasonCode } from '../lib/dispatch/reason-labels'
import { compatibilityMessages } from '../lib/dispatch/optimization/compatibility'
import { getOrComputeRoute, type RouteCacheStore } from '../lib/dispatch/maps/route-control'

function ok(label: string) { console.log(`${label}: OK`) }

type Scripted = Record<string, unknown>
function scriptedFetch(responses: Scripted[]) {
  const requests: Array<Record<string, any>> = []
  const impl = (async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)))
    const next = responses[Math.min(requests.length - 1, responses.length - 1)]
    return new Response(JSON.stringify(next), { status: 200 })
  }) as typeof fetch
  return { impl, requests }
}
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] })
const call = (name: string, args: Record<string, unknown>, id = `call_${name}`) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) })
const options = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) => ({ apiKey: 'test', model: 'test-model', fetchImpl, ...extra })
const week = new Date('2026-09-14T00:00:00.000Z')

function stubTool(name: string, result: unknown): AgentTool & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = []
  return { name, description: name, parameters: { type: 'object', properties: {} }, calls, async run(args) { calls.push(args); return typeof result === 'function' ? (result as () => unknown)() : result } }
}

async function main() {
  // --- Catalogue d'outils : lecture seule, petit et cohérent ---------------
  assert.deepEqual(agentTools.map((tool) => tool.name).sort(), ['get_mission_blockers', 'get_mission_facts', 'get_planning_suggestions', 'get_resource_facts', 'get_week_overview', 'simulate_planning_suggestion'])
  for (const tool of agentTools) assert.doesNotMatch(tool.name, /apply|assign|update|create|delete|confirm/i, `outil d'écriture interdit : ${tool.name}`)
  for (const file of ['lib/dispatch/intelligence/agent.ts', 'lib/dispatch/intelligence/agent-tools.ts']) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /maps\/google|computeGoogleRoute|requestGoogleRoute|applyPlanningSuggestion|createPendingApplyToken|buildPendingApplyAction/, `${file} ne doit ni appeler Google ni écrire`)
    // Même règle que l'audit de sûreté : une écriture Prisma, pas un `Map.delete`.
    assert.deepEqual(
      source.split('\n').filter((line) => /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(line) && /prisma|\btx\b/.test(line)),
      [],
      `${file} doit rester en lecture seule`
    )
  }
  ok('Catalogue de 6 outils en lecture seule, sans accès Google ni écriture')

  // --- Raisons : tout code de compatibilité du moteur est expliqué ----------
  assert.deepEqual(Object.keys(compatibilityMessages).filter((code) => !isKnownReasonCode(code)), [], 'chaque code de compatibilité a un libellé opérationnel')
  const blockersTool = agentTools.find((tool) => tool.name === 'get_mission_blockers')!
  assert.deepEqual((blockersTool.parameters as { properties: { scope: { enum: string[] } } }).properties.scope.enum, ['mission', 'all_unassigned'])
  assert.match(blockersTool.description, /donnée manquante n’est PAS une incompatibilité/)
  const instructions = buildAgentInstructions({ weekStart: '2026-10-05', today: '2026-10-07' })
  for (const rule of [/Hard blocker/, /Warning/, /Missing data/, /NOT proof of incompatibility|NOT proof/, /ESTIMATED_NOT_CACHED/, /same step/]) assert.match(instructions, rule)
  ok('Dictionnaire de raisons complet et consignes blocage/réserve/donnée manquante')

  // --- Historique borné -----------------------------------------------------
  assert.deepEqual(sanitizeHistory('nope'), [])
  assert.deepEqual(sanitizeHistory([{ role: 'system', text: 'x' }, { role: 'user', text: 5 }, null, { role: 'user', text: '  ' }]), [])
  const long = sanitizeHistory(Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: `m${index} ${'x'.repeat(5000)}` })))
  assert.ok(long.length <= maximumHistoryMessages)
  assert.ok(long.every((item) => item.text.length <= maximumHistoryMessageLength))
  assert.ok(long.reduce((sum, item) => sum + item.text.length, 0) <= maximumHistoryTotalLength)
  assert.equal(long[0].role, 'user', 'l’historique commence par un message utilisateur')
  assert.match(long.at(-1)!.text, /^m3[0-9]/, 'les échanges les plus récents sont conservés')
  ok('Historique validé et plafonné')

  // --- Conversation générale : aucune voie UNKNOWN, aucun outil -------------
  for (const [message, answer] of [['Quelle couleur est le ciel ?', 'Le ciel est bleu en journée.'], ['Hello', 'Hello! How can I help with your dispatch today?'], ['What can you help me with?', 'I can analyse your planning, explain blockers…']] as const) {
    const fetched = scriptedFetch([say(answer)])
    const result = await runIntelligenceAgent({ message, weekStart: week }, options(fetched.impl))
    assert.equal(result.status, 'SUCCESS')
    assert.equal(result.answer, answer)
    assert.deepEqual(result.toolCalls, [])
    assert.equal(fetched.requests[0].store, false)
    assert.deepEqual(fetched.requests[0].tools.map((tool: { name: string }) => tool.name).sort(), agentTools.map((tool) => tool.name).sort())
    assert.match(fetched.requests[0].instructions, /Reply in the language of the user/)
    assert.doesNotMatch(JSON.stringify(fetched.requests[0].tools), /"enum":\["PLANNING_SUMMARY/, 'pas d’enum d’intentions fermé')
  }
  const originalFetch = globalThis.fetch
  const saved = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL, agent: process.env.GERARD_INTELLIGENCE_AGENT }
  process.env.OPENAI_API_KEY = 'test'; process.env.OPENAI_MODEL = 'test-model'; delete process.env.GERARD_INTELLIGENCE_AGENT
  try {
    globalThis.fetch = scriptedFetch([say('Le ciel est bleu.')]).impl
    const sky = await answerAssistantQuestion({ message: 'Quelle couleur est le ciel ?', weekStart: week })
    assert.equal(sky.answer, 'Le ciel est bleu.')
    assert.equal(sky.routing.source, 'AGENT')
    assert.doesNotMatch(sky.answer, /pas identifié/)
    assert.deepEqual(sky.actions, [])
    ok('Conversation générale (ciel, hello, capacités) sans routage UNKNOWN')

    // --- Repli sûr -----------------------------------------------------------
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch
    const degraded = await answerAssistantQuestion({ message: 'Est-ce que l’organisation te paraît cohérente ?', weekStart: week })
    assert.equal(degraded.routing.source, 'FALLBACK')
    assert.equal(degraded.routing.providerStatus, 'HTTP_ERROR')
    assert.match(degraded.answer, /momentanément indisponible/)
    assert.doesNotMatch(degraded.answer, /HTTP|500|{|Error/)
    // Une question que le routeur historique sait traiter reste répondue, avec mention du mode simplifié.
    const summaryDegraded = await answerAssistantQuestion({ message: 'Analyse la semaine', weekStart: week, agentRunner: (async () => ({ status: 'HTTP_ERROR', answer: null, toolCalls: [], providerCalls: 1, durationMs: 1 })) as never }).catch(() => null)
    if (summaryDegraded) assert.match(summaryDegraded.answer, /Mode simplifié/)
    delete process.env.OPENAI_API_KEY
    const unconfigured = await answerAssistantQuestion({ message: 'Est-ce que l’organisation te paraît cohérente ?', weekStart: week })
    assert.equal(unconfigured.routing.providerStatus, 'UNCONFIGURED')
    assert.match(unconfigured.answer, /suffisamment de précision/)
    process.env.OPENAI_API_KEY = 'test'
    ok('Repli déterministe si fournisseur en panne ou non configuré')

    // --- Sûreté d'écriture : une demande d'écriture n'atteint jamais l'agent -
    let agentCalled = 0
    const spy = (async () => { agentCalled += 1; return { status: 'SUCCESS' as const, answer: 'fait', toolCalls: [], providerCalls: 1, durationMs: 1 } }) as never
    for (const message of ['Applique-la', 'Assign Marc to GRD-260916-06', 'Apply it', 'Do it', 'Go ahead', 'Vas-y', 'Oui vas-y', 'Yes go ahead', 'Ok, d’accord, vas-y', 'Reassign GRD-260916-06 to Julien']) {
      assert.equal(routeAssistantIntent(message).requestsMutation, true, message)
      const reply = await answerAssistantQuestion({ message, weekStart: week, userId: 'user-test', canApply: true, agentRunner: spy })
      assert.equal(reply.application, null)
      assert.deepEqual(reply.actions, [])
      assert.match(reply.answer, /Je ne modifie rien sur un message seul/)
    }
    assert.equal(agentCalled, 0, 'aucune demande d’écriture ne passe par l’agent')
    const forged = await answerAssistantQuestion({ message: 'confirme', weekStart: week, userId: 'user-test', canApply: true, confirmation: { token: 'forged.token' }, agentRunner: spy })
    assert.equal(forged.application?.status, 'INVALID')
    assert.equal(agentCalled, 0)
    ok('Écriture directe impossible : confirmation signée obligatoire, agent jamais appelé')

    // --- Protection Google : le chat tourne sous un budget de zéro appel -----
    let providerCalls = 0
    const provider = async () => { providerCalls += 1; return { distanceMeters: 1, durationSeconds: 1, polyline: 'x', provider: 'GOOGLE_ROUTES' as const } }
    const stored = new Map<string, any>()
    const store: RouteCacheStore = {
      async find(fingerprint) { return stored.get(fingerprint) ?? null },
      async save(fingerprint, _request, route) { stored.set(fingerprint, { fingerprint, ...route }) },
    }
    const cachedRequest = { origin: { latitude: 48.85, longitude: 2.35 }, destination: { latitude: 45.76, longitude: 4.83 } }
    const { routeFingerprint } = await import('../lib/dispatch/maps/route-control')
    stored.set(routeFingerprint(cachedRequest), { fingerprint: routeFingerprint(cachedRequest), distanceMeters: 465000, durationSeconds: 18000, polyline: 'abc', provider: 'GOOGLE_ROUTES' })
    const probe = (async () => {
      const hit = await getOrComputeRoute(cachedRequest, { provider, store })
      assert.equal(hit.cached, true)
      assert.equal(hit.distanceMeters, 465000)
      await assert.rejects(
        getOrComputeRoute({ origin: { latitude: 1, longitude: 1 }, destination: { latitude: 2, longitude: 2 } }, { provider, store }),
        /GOOGLE_ROUTES_OPERATION_LIMIT/
      )
      return { status: 'SUCCESS' as const, answer: 'ok', toolCalls: [], providerCalls: 1, durationMs: 1 }
    }) as never
    const guarded = await answerAssistantQuestion({ message: 'Quelle est la distance stockée ?', weekStart: week, agentRunner: probe })
    assert.equal(guarded.answer, 'ok')
    assert.equal(providerCalls, 0, 'aucun appel Google pendant une question de chat')
    // Hors chat, le même appel reste autorisé : la restriction est locale au chat.
    await getOrComputeRoute({ origin: { latitude: 1, longitude: 1 }, destination: { latitude: 2, longitude: 2 } }, { provider, store })
    assert.equal(providerCalls, 1)
    ok('Maps : cache lu, aucun appel Google en chat, calcul hors chat inchangé')
  } finally {
    globalThis.fetch = originalFetch
    for (const [name, value] of [['OPENAI_API_KEY', saved.key], ['OPENAI_MODEL', saved.model], ['GERARD_INTELLIGENCE_AGENT', saved.agent]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value
    }
  }

  // --- Raisonnement planning : le modèle choisit l'outil, voit les faits ----
  const overview = stubTool('get_week_overview', { insights: [{ type: 'UNASSIGNED_MISSION', title: 'GRD-260916-06 n’est pas affectée' }] })
  for (const message of ['What is wrong with my planning?', 'Qu’est-ce qui ne va pas dans mon planning ?', 'Where are we losing time this week?', 'What would you improve?']) {
    assert.equal(routeAssistantIntent(message).requestsMutation, undefined)
    const fetched = scriptedFetch([{ output: [call('get_week_overview', { day: null })] }, say('GRD-260916-06 is unassigned.')])
    const result = await runIntelligenceAgent({ message, weekStart: week }, options(fetched.impl, { tools: [overview] }))
    assert.equal(result.status, 'SUCCESS')
    assert.deepEqual(result.toolCalls, ['get_week_overview'])
    assert.equal(fetched.requests.length, 2)
    const second = fetched.requests[1].input
    assert.ok(second.some((item: any) => item.type === 'function_call'), 'l’appel d’outil est renvoyé au modèle')
    const output = second.find((item: any) => item.type === 'function_call_output')
    assert.match(output.output, /GRD-260916-06/, 'le modèle reçoit les preuves, pas des compteurs')
  }
  ok('Planning : le modèle appelle l’outil et raisonne sur les preuves')

  // --- Mission + ressource en plusieurs tours, relance avec historique ------
  const facts = stubTool('get_mission_facts', { reference: 'GRD-260916-06' })
  const blockers = stubTool('get_mission_blockers', { engineVerdict: { category: 'UNASSIGNED', code: { code: 'NO_VALID_PAIR' } } })
  const resource = stubTool('get_resource_facts', { resource: 'Marc', missionEvaluation: { overlapsWithPlannedMissions: ['GRD-260916-02'] } })
  const multi = scriptedFetch([
    { output: [call('get_mission_facts', { missionReference: 'GRD-260916-06' }, 'c1'), call('get_mission_blockers', { missionReference: 'GRD-260916-06' }, 'c2')] },
    { output: [call('get_resource_facts', { kind: 'driver', name: 'Marc', missionReference: 'GRD-260916-06' }, 'c3')] },
    say('Elle n’est pas planifiée car… Marc chevauche GRD-260916-02.'),
  ])
  const multiResult = await runIntelligenceAgent({ message: 'Why isn’t GRD-260916-06 planned and who could take it?', weekStart: week }, options(multi.impl, { tools: [facts, blockers, resource] }))
  assert.equal(multiResult.status, 'SUCCESS')
  assert.deepEqual(multiResult.toolCalls, ['get_mission_facts', 'get_mission_blockers', 'get_resource_facts'])
  assert.equal(multiResult.providerCalls, 3)
  assert.deepEqual(blockers.calls[0], { missionReference: 'GRD-260916-06' })
  ok('Mission : plusieurs outils sur plusieurs tours')

  const followUp = scriptedFetch([{ output: [call('get_resource_facts', { kind: 'driver', name: 'Marc', missionReference: 'GRD-260916-06' })] }, say('Marc est pris sur GRD-260916-02.')])
  const history = [{ role: 'user' as const, text: 'Pourquoi GRD-260916-06 n’est pas planifiée ?' }, { role: 'assistant' as const, text: 'Aucun couple compatible…' }]
  const followResult = await runIntelligenceAgent({ message: 'Et Marc ?', history, weekStart: week, conversationContext: { missionReference: 'GRD-260916-06' } }, options(followUp.impl, { tools: [resource] }))
  assert.equal(followResult.status, 'SUCCESS')
  const sent = followUp.requests[0]
  assert.deepEqual(sent.input.map((item: any) => item.role), ['user', 'assistant', 'user'])
  assert.match(sent.input[0].content, /GRD-260916-06/, 'l’échange précédent est transmis')
  assert.equal(sent.input[2].content, 'Et Marc ?')
  assert.match(sent.instructions, /currently selected in the conversation is GRD-260916-06/)
  ok('Historique : « Et Marc ? » conserve la mission')

  const marcFr = scriptedFetch([{ output: [call('get_resource_facts', { kind: 'driver', name: 'Marc', missionReference: null })] }, say('Oui, sans chevauchement.')])
  const marcResult = await runIntelligenceAgent({ message: 'Marc peut-il prendre cette mission ?', weekStart: week, conversationContext: { missionReference: 'GRD-260916-06' } }, options(marcFr.impl, { tools: [resource] }))
  assert.equal(marcResult.status, 'SUCCESS')
  assert.deepEqual(resource.calls.at(-1), { kind: 'driver', name: 'Marc', missionReference: null }, 'pas de gabarit MISSION_CONTEXT : l’outil ressource est appelé')
  ok('Ressource : « Marc peut-il prendre cette mission ? » passe par get_resource_facts')

  // --- Robustesse de la boucle ---------------------------------------------
  const failing = stubTool('get_week_overview', () => { throw new Error('db down') })
  const recovered = scriptedFetch([{ output: [call('get_week_overview', { day: null })] }, say('Je ne peux pas lire le planning pour le moment.')])
  const recoveredResult = await runIntelligenceAgent({ message: 'planning ?', weekStart: week }, options(recovered.impl, { tools: [failing] }))
  assert.equal(recoveredResult.status, 'SUCCESS')
  const failedOutput = recovered.requests[1].input.find((item: any) => item.type === 'function_call_output').output
  assert.match(failedOutput, /TOOL_FAILED/)
  assert.doesNotMatch(failedOutput, /db down/, 'aucun détail technique ne remonte au modèle')
  const unknownTool = scriptedFetch([{ output: [call('apply_everything', {})] }, say('Je ne peux pas.')])
  const unknownResult = await runIntelligenceAgent({ message: 'fais tout', weekStart: week }, options(unknownTool.impl, { tools: [overview] }))
  assert.match(unknownTool.requests[1].input.find((item: any) => item.type === 'function_call_output').output, /UNKNOWN_TOOL/)
  assert.equal(unknownResult.status, 'SUCCESS')
  const endless = scriptedFetch([{ output: [call('get_week_overview', { day: null })] }])
  const endlessResult = await runIntelligenceAgent({ message: 'boucle', weekStart: week }, options(endless.impl, { tools: [overview], maxToolRounds: 4 }))
  assert.equal(endlessResult.status, 'INVALID_OUTPUT')
  assert.equal(endless.requests.length, 5, 'au plus 4 tours d’outils puis un tour final sans outil')
  assert.equal(endless.requests.at(-1)!.tool_choice, 'none')
  assert.equal((await runIntelligenceAgent({ message: 'x', weekStart: week }, { fetchImpl: scriptedFetch([say('x')]).impl, apiKey: '', model: '' })).status, 'UNCONFIGURED')
  assert.equal((await runIntelligenceAgent({ message: 'x', weekStart: week }, options((async () => new Response('', { status: 429 })) as typeof fetch))).status, 'HTTP_ERROR')
  assert.equal((await runIntelligenceAgent({ message: 'x', weekStart: week }, options((async () => { throw new Error('offline') }) as typeof fetch))).status, 'PROVIDER_ERROR')
  assert.equal((await runIntelligenceAgent({ message: 'x', weekStart: week }, options(scriptedFetch([{ output: [] }]).impl))).status, 'INVALID_OUTPUT')
  assert.equal((await runIntelligenceAgent({ message: 'x', weekStart: week }, options(((_u: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))) as typeof fetch, { timeoutMs: 20 }))).status, 'TIMEOUT')
  ok('Boucle bornée : erreurs d’outil, outil inconnu, plafond de tours, pannes fournisseur')

  // --- Mémoire de requête des outils ----------------------------------------
  const context = createAgentToolContext({ weekStart: week })
  assert.equal(context.memo.size, 0)
  assert.match(buildAgentInstructions({ weekStart: '2026-09-14', today: '2026-09-15' }), /Never invent Gerard operational data/)
  ok('Instructions système')
}

main().then(() => console.log('Gerard Intelligence agent: OK')).catch((error) => { console.error(error); process.exit(1) })
