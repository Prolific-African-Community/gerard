// Couverture du bloc de confirmation du chat (T4).
//
// Le projet n'a pas de DOM de test. L'interaction du panneau vit donc dans une
// machine d'états pure, pilotée ici transition par transition, et le rendu du
// bloc est vérifié par `react-dom/server`. Ce que le test prouve : une requête
// ne part que sur une transition qui en produit une, et une seule transition
// porte une confirmation.
process.env.JWT_SECRET ??= 'qa-intelligence-chat-confirmation'

import assert from 'node:assert/strict'
// @ts-expect-error -- le projet n'installe pas @types/react-dom : un seul import suffit ici.
import { renderToStaticMarkup } from 'react-dom/server'

import {
  applicationSettled,
  applyRequested,
  cancelRequested,
  confirmApplyActionOf,
  confirmRequested,
  confirmationMessage,
  questionAsked,
} from '../lib/dispatch/intelligence/assistant-interaction'
import { AssistantApplyConfirmation } from '../components/dispatch/intelligence/GerardAssistantPanel'
import { buildPendingApplyAction } from '../lib/dispatch/intelligence/pending-action'
import type { GerardAssistantReply } from '../lib/dispatch/intelligence/types'

const weekStart = '2032-03-01'
const conversationContext = { missionReference: 'QA-CHAT-01', suggestionId: 'reassignment:abc:mission-1:candidate-1' }
const action = buildPendingApplyAction({
  userId: 'user-dispatcher',
  weekStart,
  suggestionId: conversationContext.suggestionId,
  snapshotFingerprint: 'fingerprint-chat-confirmation',
  evidenceFingerprint: 'evidence-chat-confirmation',
  missionReference: 'QA-CHAT-01',
  summary: 'Julien remplacerait Karim sur QA-CHAT-01. Gain estimé : 62.0 km à vide.',
})

const reply = {
  answer: 'Suggestion toujours valide.',
  intent: 'SIMULATE_SUGGESTION',
  data: null,
  actions: [{ type: 'SIMULATE', label: 'Simuler QA-CHAT-01', suggestionId: conversationContext.suggestionId }, action],
  warnings: [],
  application: null,
  routing: { source: 'ROUTER', providerCalls: 0, providerDurationMs: null, providerStatus: null },
} as GerardAssistantReply

// A — une réponse de simulation expose bien l'action d'application.
const found = confirmApplyActionOf(reply)
assert.ok(found)
assert.equal(found.type, 'CONFIRM_APPLY')
assert.equal(found.token, action.token)
console.log('A la réponse de simulation porte une action d application: OK')

// B — cliquer « Appliquer » ouvre la confirmation sans rien envoyer.
const opened = applyRequested(action)
assert.equal(opened.request, null, 'ouvrir la confirmation ne doit envoyer aucune requête')
assert.equal(opened.pending, action)
assert.equal(opened.refreshPlanning, false)
console.log('B ouvrir la confirmation n envoie aucune requête: OK')

// C — le bloc de confirmation nomme la mission et n'offre que deux issues.
const markup = renderToStaticMarkup(
  <AssistantApplyConfirmation action={action} onCancel={() => {}} onConfirm={() => {}} />
)
// La question est désormais portée par les deux boutons ; le texte nomme la
// mission et annonce clairement qu'une confirmation est attendue.
assert.match(markup, /Confirmation requise/)
assert.match(markup, /Cette action modifiera l’affectation de QA-CHAT-01\./)
assert.match(markup, /aria-label="Confirmer l’application"/)
assert.match(markup, />Annuler</)
assert.match(markup, />Confirmer</)
assert.equal(markup.match(/<button/g)?.length, 2, 'le bloc n’expose qu’Annuler et Confirmer')
assert.match(
  renderToStaticMarkup(<AssistantApplyConfirmation action={action} loading onCancel={() => {}} onConfirm={() => {}} />),
  /disabled=""/,
  'la confirmation est verrouillée pendant l’application'
)
console.log('C le bloc de confirmation nomme la mission et n offre que deux issues: OK')

// D — « Annuler » referme sans rien envoyer.
const cancelled = cancelRequested()
assert.equal(cancelled.request, null)
assert.equal(cancelled.pending, null)
console.log('D annuler ne déclenche aucune requête: OK')

// E — seule la confirmation explicite porte le jeton.
const confirmed = confirmRequested({ pending: action, weekStart, conversationContext })
assert.ok(confirmed.request)
assert.deepEqual(confirmed.request.confirmation, { token: action.token })
assert.equal(confirmed.request.message, confirmationMessage)
assert.equal(confirmed.request.weekStart, weekStart)
assert.equal(confirmed.request.conversationContext.suggestionId, action.suggestionId)
assert.equal(confirmed.pending, action, 'l’action reste en attente tant que le serveur n’a pas répondu')
console.log('E seule la confirmation explicite porte le jeton: OK')

// F — aucune autre transition ne peut porter une confirmation.
for (const transition of [
  questionAsked({ message: 'Applique-la', weekStart, conversationContext, pending: action }),
  questionAsked({ message: 'Vas-y', weekStart, conversationContext, pending: action }),
  questionAsked({ message: 'Simule cette proposition', weekStart, conversationContext, pending: null, suggestionId: action.suggestionId }),
  applyRequested(action),
  cancelRequested(),
  confirmRequested({ pending: null, weekStart, conversationContext }),
]) {
  assert.equal(transition.request?.confirmation, undefined, 'seule confirmRequested porte une confirmation')
  assert.equal(transition.refreshPlanning, false)
}
console.log('F aucune autre transition ne porte de confirmation: OK')

// G — après réponse, l'action en attente est consommée ; le planning n'est relu
// que si une application a réellement eu lieu.
for (const [status, refresh] of [
  ['APPLIED', true],
  ['ALREADY_APPLIED', true],
  ['STALE', false],
  ['CONFLICT', false],
  ['INVALID', false],
  ['FORBIDDEN', false],
] as const) {
  const settled = applicationSettled({ status })
  assert.equal(settled.pending, null, `l’action doit être consommée après ${status}`)
  assert.equal(settled.request, null)
  assert.equal(settled.refreshPlanning, refresh, `rafraîchissement inattendu pour ${status}`)
}
assert.equal(applicationSettled(null).pending, null)
assert.equal(applicationSettled(null).refreshPlanning, false)
console.log('G l action en attente est consommée, le planning relu seulement après écriture: OK')
