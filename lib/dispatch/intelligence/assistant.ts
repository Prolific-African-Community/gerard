import { routeAssistantIntent } from './intent-router'
import { runIntelligenceAgent, type AgentHistoryMessage, type AgentStatus } from './agent'
import { withRouteOperation } from '../maps/route-control'
import { withPlanningAnalysisMemo } from '../suggestions/planning-service'
import { classifyIntentWithConfiguredModel } from './llm-router'
import { explainSuggestion, getMissionContext, getPlanningInsights, getPlanningSuggestions, getPlanningSummary, getResourceAvailability, resolveMissionReference, simulateSuggestion } from './facade'
import { buildPendingApplyAction, verifyPendingApplyToken } from './pending-action'
import { logIntelligenceEvent } from './observability'
import type { GerardAssistantAction, GerardAssistantApplicationOutcome, GerardAssistantConfirmation, GerardAssistantContext, GerardAssistantIntentResult, GerardAssistantReply } from './types'
import { SuggestionApplicationError, applyPlanningSuggestion } from '../suggestions/application'
import { formatDateParam } from '../date-utils'
import type { GerardSuggestion } from '../suggestions/types'
import { describeSuggestion } from './describe-suggestion'

export { describeSuggestion }

function numberFact(context: GerardAssistantContext, label: string) {
  return Number(context.facts.find((item) => item.label === label)?.value ?? 0)
}

function formatMission(context: GerardAssistantContext) {
  const value = (label: string) => context.facts.find((item) => item.label === label)?.value
  const resources = [value('Chauffeur'), value('Camion'), value('Remorque')].filter(Boolean).join(' · ')
  return `${value('Mission')} — ${value('Origine') ?? 'origine inconnue'} → ${value('Destination') ?? 'destination inconnue'}. ${resources ? `Affectation actuelle : ${resources}.` : 'Cette mission n’est pas affectée.'} ${numberFact(context, 'Alternatives valides')} alternative(s) valide(s) détectée(s).`
}

type Routing = GerardAssistantReply['routing']

function reply(
  intent: GerardAssistantIntentResult,
  context: GerardAssistantContext | null,
  answer: string,
  routing: Routing,
  options: { actions?: GerardAssistantAction[]; application?: GerardAssistantApplicationOutcome } = {}
): GerardAssistantReply {
  return {
    answer,
    intent: intent.intent,
    data: context,
    actions: options.actions ?? context?.availableActions ?? [],
    warnings: context?.warnings ?? [],
    application: options.application ?? null,
    routing,
  }
}


/**
 * Prépare une action d'application confirmable. Rien n'est écrit ici : le
 * serveur émet la clé d'idempotence et signe la suggestion, l'empreinte et la
 * semaine. Sans permission d'affectation, aucune action n'est proposée.
 */
function pendingApplyActions(input: {
  suggestion: GerardSuggestion
  weekStart: Date
  userId?: string
  canApply?: boolean
}): GerardAssistantAction[] {
  if (!input.userId || !input.canApply) return []
  return [buildPendingApplyAction({
    userId: input.userId,
    weekStart: formatDateParam(input.weekStart),
    suggestionId: input.suggestion.id,
    snapshotFingerprint: input.suggestion.snapshotFingerprint,
    evidenceFingerprint: input.suggestion.evidenceFingerprint,
    missionReference: input.suggestion.currentState.missionReference,
    summary: describeSuggestion(input.suggestion),
  })]
}

/**
 * Exécute l'unique chemin d'écriture légitime, après confirmation structurée.
 * Les paramètres d'application proviennent du jeton signé, jamais du corps de
 * la requête ni d'une sortie de modèle.
 */
async function applyConfirmedSuggestion(input: {
  confirmation: GerardAssistantConfirmation
  userId?: string
  canApply?: boolean
  routing: Routing
}): Promise<GerardAssistantReply> {
  const intent: GerardAssistantIntentResult = { intent: 'APPLY_SUGGESTION', requestsMutation: true }
  if (!input.userId || !input.canApply) {
    return reply(intent, null, 'Appliquer une suggestion demande la permission d’affectation du dispatch.', input.routing, { application: { status: 'FORBIDDEN' } })
  }
  const pending = verifyPendingApplyToken(input.confirmation.token, input.userId)
  if (!pending) {
    return reply(intent, null, 'Cette confirmation n’est plus valide. Relance la simulation de la suggestion avant de l’appliquer.', input.routing, { application: { status: 'INVALID' } })
  }
  try {
    const result = await applyPlanningSuggestion({
      userId: input.userId,
      suggestionId: pending.suggestionId,
      weekStart: pending.weekStart,
      snapshotFingerprint: pending.snapshotFingerprint,
      evidenceFingerprint: pending.evidenceFingerprint,
      idempotencyKey: pending.idempotencyKey,
    })
    return reply(
      intent,
      null,
      result.status === 'ALREADY_APPLIED'
        ? 'Cette suggestion était déjà appliquée : rien n’a été modifié une seconde fois.'
        : 'Suggestion appliquée. Le planning est à jour et l’opération est tracée.',
      input.routing,
      {
        application: {
          status: result.status === 'ALREADY_APPLIED' ? 'ALREADY_APPLIED' : 'APPLIED',
          missionId: result.missionId,
          assignmentId: result.assignmentId,
          applicationId: result.applicationId,
        },
      }
    )
  } catch (error) {
    if (!(error instanceof SuggestionApplicationError)) throw error
    return reply(
      intent,
      null,
      error.status === 'STALE'
        ? 'Le planning a changé depuis la simulation. Relance l’analyse avant d’appliquer : je n’ai rien modifié.'
        : error.status === 'CONFLICT'
          ? `Application refusée : ${error.message} Rien n’a été modifié.`
          : `Application refusée : ${error.message}`,
      input.routing,
      { application: { status: error.status } }
    )
  }
}

type AssistantQuestionInput = {
  message: string
  weekStart: Date
  userId?: string
  /** Vrai uniquement si l'appelant a été contrôlé sur la permission d'affectation. */
  canApply?: boolean
  conversationContext?: { missionReference?: string; suggestionId?: string }
  /** Derniers échanges du chat, déjà bornés côté API ; sert uniquement à l'agent. */
  history?: AgentHistoryMessage[]
  confirmation?: GerardAssistantConfirmation
  /** Point d'injection des tests : remplace l'appel réel à l'agent. */
  agentRunner?: typeof runIntelligenceAgent
}

function agentEnabled() {
  return process.env.GERARD_INTELLIGENCE_AGENT?.trim().toLowerCase() !== 'off'
}

export async function answerAssistantQuestion(input: AssistantQuestionInput): Promise<GerardAssistantReply> {
  const deterministicRouting: Routing = { source: 'ROUTER', providerCalls: 0, providerDurationMs: null, providerStatus: null }
  // Une confirmation structurée ne passe pas par l'interprétation du message :
  // elle est vérifiée, puis exécutée ou refusée. Elle seule peut reconstruire
  // un instantané avec ses propres routes.
  if (input.confirmation) {
    return applyConfirmedSuggestion({ confirmation: input.confirmation, userId: input.userId, canApply: input.canApply, routing: deterministicRouting })
  }
  // Toute lecture du chat s'exécute avec un budget Google de zéro appel : les
  // routes viennent du cache ou sont estimées, jamais calculées pour répondre à
  // une question. L'analyse hebdomadaire n'est calculée qu'une fois par requête.
  const state = { agentFailed: false }
  const result = await withRouteOperation('Gerard chat (cache uniquement)', () => withPlanningAnalysisMemo(() => answerReadOnlyQuestion(input, deterministicRouting, state)), { maxCalls: 0 })
  // Repli après une panne de l'agent : la réponse déterministe reste utile mais plus pauvre ;
  // l'utilisateur doit le savoir plutôt que la prendre pour un diagnostic complet.
  if (!state.agentFailed || result.routing.source === 'AGENT' || /momentanément indisponible/.test(result.answer)) return result
  return { ...result, answer: `${result.answer}

(Mode simplifié : l’assistant conversationnel est momentanément indisponible.)` }
}

async function answerReadOnlyQuestion(input: AssistantQuestionInput, deterministicRouting: Routing, state: { agentFailed: boolean }): Promise<GerardAssistantReply> {
  let intent = routeAssistantIntent(input.message)
  let routing: Routing = deterministicRouting
  let agentFailure: { status: AgentStatus; providerCalls: number; durationMs: number } | null = null
  // Le routeur déterministe ne garde la main que sur les demandes d'écriture,
  // qui passent par la confirmation signée. Toute autre question va d'abord à
  // l'agent conversationnel, qui n'a que des outils en lecture seule.
  if (!intent.requestsMutation && agentEnabled()) {
    const agent = await (input.agentRunner ?? runIntelligenceAgent)({
      message: input.message,
      history: input.history,
      weekStart: input.weekStart,
      conversationContext: input.conversationContext,
    })
    const agentRouting: Routing = { source: 'AGENT', providerCalls: agent.providerCalls, providerDurationMs: agent.durationMs, providerStatus: agent.status, toolCalls: agent.toolCalls }
    if (agent.status === 'SUCCESS' && agent.answer) {
      logIntelligenceEvent('assistant.routed', {
        week: formatDateParam(input.weekStart),
        userId: input.userId,
        result: 'CONVERSATION',
        providerSource: 'AGENT',
        providerStatus: agent.status,
        providerCalls: agent.providerCalls,
        providerDurationMs: agent.durationMs,
      })
      return reply({ intent: 'CONVERSATION' }, null, agent.answer, agentRouting, { actions: [] })
    }
    if (agent.status !== 'UNCONFIGURED') {
      state.agentFailed = true
      agentFailure = { status: agent.status, providerCalls: agent.providerCalls, durationMs: agent.durationMs }
      logIntelligenceEvent('provider.degraded', { userId: input.userId, providerStatus: agent.status, providerDurationMs: agent.durationMs })
    }
  }
  if (intent.intent === 'UNKNOWN' && !intent.requestsMutation) {
    if (agentFailure) {
      // Le fournisseur vient d'échouer : inutile de le rappeler pour classer l'intention.
      routing = { source: 'FALLBACK', providerCalls: agentFailure.providerCalls, providerDurationMs: agentFailure.durationMs, providerStatus: agentFailure.status }
    } else {
      const classified = await classifyIntentWithConfiguredModel(input.message, input.conversationContext)
      routing = { source: classified.intent ? 'OPENAI' : 'FALLBACK', providerCalls: 1, providerDurationMs: classified.durationMs, providerStatus: classified.status }
      if (classified.intent) intent = classified.intent
      if (classified.status !== 'SUCCESS') {
        logIntelligenceEvent('provider.degraded', {
          userId: input.userId,
          providerStatus: classified.status,
          providerDurationMs: classified.durationMs,
        })
      }
    }
  }
  const explicitMissionReference = intent.missionReference
  if (!intent.missionReference && !/\bdemain\b/i.test(input.message)) intent.missionReference = input.conversationContext?.missionReference
  intent.suggestionId ??= input.conversationContext?.suggestionId
  // Le routage déterministe et le repli fournisseur restent distinguables : le
  // message de l'utilisateur, lui, n'est jamais journalisé.
  logIntelligenceEvent('assistant.routed', {
    week: formatDateParam(input.weekStart),
    userId: input.userId,
    result: intent.intent,
    providerSource: routing.source,
    providerStatus: routing.providerStatus ?? undefined,
    providerCalls: routing.providerCalls,
    providerDurationMs: routing.providerDurationMs ?? undefined,
  })
  // Un message libre ne vaut jamais confirmation. Au mieux il fait réapparaître
  // l'action confirmable de la suggestion déjà désignée dans la conversation.
  if (intent.requestsMutation) {
    intent.intent = 'APPLY_SUGGESTION'
    if (!intent.suggestionId) {
      return reply(intent, null, 'Je ne modifie rien sur un message seul. Demande d’abord une analyse, puis simule la suggestion à appliquer.', routing)
    }
    const pending = await simulateSuggestion(input.weekStart, intent.suggestionId)
    if (pending.status !== 'VALID' || !pending.suggestion) {
      return reply(intent, null, 'Cette suggestion n’est plus valide. Relance l’analyse du planning avant d’appliquer quoi que ce soit.', routing)
    }
    const actions = pendingApplyActions({ suggestion: pending.suggestion, weekStart: input.weekStart, userId: input.userId, canApply: input.canApply })
    if (!actions.length) {
      return reply(intent, null, 'Appliquer une suggestion demande la permission d’affectation du dispatch. Je peux seulement expliquer et simuler.', routing, { application: { status: 'FORBIDDEN' } })
    }
    const context = await getPlanningSummary(input.weekStart)
    return reply(intent, { ...context, suggestions: [pending.suggestion] }, `Je ne modifie rien sur un message seul. Vérification à jour : ${describeSuggestion(pending.suggestion)} Confirme explicitement l’action pour l’appliquer.`, routing, { actions })
  }

  if (intent.missionReference) {
    const resolution = await resolveMissionReference(input.weekStart, intent.missionReference)
    if (resolution.status === 'AMBIGUOUS') return reply(intent, null, `Plusieurs missions correspondent : ${resolution.references.join(', ')}. Précise la référence complète.`, routing)
    if (resolution.status === 'FOUND') intent.missionReference = resolution.references[0]
    else if (explicitMissionReference) return reply(intent, null, `Mission ${explicitMissionReference} introuvable.`, routing)
  }

  if (intent.intent === 'PLANNING_SUMMARY') {
    // Le résumé s'appuie sur les mêmes faits que la surface proactive : le
    // nombre de points à vérifier vient du même calcul déterministe.
    const [context, insights] = await Promise.all([
      getPlanningSummary(input.weekStart),
      getPlanningInsights(input.weekStart),
    ])
    const suggestions = numberFact(context, 'Suggestions applicables')
    const attention = insights.bySeverity.CRITICAL + insights.bySeverity.ATTENTION
    return reply(intent, context, `${numberFact(context, 'Missions analysées')} missions analysées, ${numberFact(context, 'Baselines valides')} baselines valides et ${numberFact(context, 'Alternatives valides')} alternatives valides. ${suggestions ? `${suggestions} amélioration(s) significative(s) et applicable(s) détectée(s).` : "Gerard n’a détecté aucune amélioration significative et applicable avec les règles et données actuellement disponibles."}${attention ? ` ${attention} point(s) demandent aussi ton attention sur cette semaine.` : ''}`, routing)
  }
  if (intent.intent === 'PLANNING_SUGGESTIONS') {
    const context = await getPlanningSuggestions(input.weekStart)
    if (!context.suggestions?.length) return reply(intent, context, "Gerard n’a détecté aucune amélioration significative et applicable avec les règles et données actuellement disponibles.", routing)
    return reply(intent, context, `${context.suggestions.length} suggestion(s) applicable(s) détectée(s). La meilleure concerne ${context.suggestions[0].currentState.missionReference}.`, routing)
  }
  if (intent.intent === 'MISSION_CONTEXT' || intent.intent === 'MISSION_ALTERNATIVES') {
    if (!intent.missionReference) return reply(intent, null, 'Quelle référence de mission veux-tu analyser ?', routing)
    const context = await getMissionContext(input.weekStart, intent.missionReference)
    if (!context) return reply(intent, null, `Mission ${intent.missionReference} introuvable.`, routing)
    if (/\b(co[uû]te|co[uû]t|prix|combien)\b/i.test(input.message)) {
      const value = (label: string) => context.facts.find((item) => item.label === label)?.value
      const estimatedCost = value('Coût opérationnel estimé')
      const price = value('Prix client enregistré')
      const answer = estimatedCost === null || typeof estimatedCost === 'undefined'
        ? `Gerard ne dispose pas d’un coût opérationnel exploitable pour ${intent.missionReference}. Le prix client enregistré est ${typeof price === 'number' ? `${price.toFixed(2)} €` : 'indisponible'}.`
        : `Le coût opérationnel disponible pour ${intent.missionReference} est une estimation de ${Number(estimatedCost).toFixed(2)} €. Le prix client enregistré est ${typeof price === 'number' ? `${price.toFixed(2)} €` : 'indisponible'}.`
      return reply(intent, context, answer, routing)
    }
    return reply(intent, context, formatMission(context), routing)
  }
  if (intent.intent === 'RESOURCE_EXPLANATION') {
    if (!intent.missionReference || (!intent.driverName && !intent.truckPlate && !intent.trailerPlate)) return reply(intent, null, /\bdemain\b/i.test(input.message) ? 'Indique la mission ou le créneau exact à vérifier. Gerard ne déduit pas une disponibilité à partir de ta formulation.' : 'Indique la mission et la ressource à vérifier.', routing)
    const context = await getResourceAvailability({ weekStart: input.weekStart, missionReference: intent.missionReference, driverName: intent.driverName, truckPlate: intent.truckPlate, trailerPlate: intent.trailerPlate })
    if (!context) return reply(intent, null, `Mission ${intent.missionReference} introuvable ou non affectée.`, routing)
    if (context.details?.resolution === 'AMBIGUOUS' || context.details?.resolution === 'NOT_FOUND') return reply(intent, context, context.warnings.at(-1) ?? 'La ressource est ambiguë.', routing)
    const conflicts = numberFact(context, 'Conflits détectés')
    return reply(intent, context, conflicts ? `${context.warnings.at(-1)} Cette réaffectation n’est donc pas validée par Gerard.` : `Aucun chevauchement n’est détecté pour ${intent.driverName ?? intent.truckPlate ?? intent.trailerPlate}, mais Gerard ne proposera cette réaffectation que si toutes les autres contraintes et les seuils économiques sont aussi validés.`, routing)
  }
  if (intent.intent === 'SIMULATE_SUGGESTION') {
    const result = await simulateSuggestion(input.weekStart, intent.suggestionId ?? '')
    if (result.status === 'UNDESIGNATED') return reply(intent, null, 'Indique la suggestion à simuler : ouvre-la depuis l’analyse du planning ou précise sa mission.', routing)
    if (result.status === 'STALE' || !result.suggestion) return reply(intent, null, 'Cette suggestion n’est plus valide. Relance l’analyse après un changement du planning.', routing)
    const context = await getPlanningSummary(input.weekStart)
    const actions = pendingApplyActions({ suggestion: result.suggestion, weekStart: input.weekStart, userId: input.userId, canApply: input.canApply })
    return reply(
      intent,
      { ...context, suggestions: [result.suggestion] },
      `Suggestion toujours valide pour ${result.suggestion.currentState.missionReference}. ${describeSuggestion(result.suggestion)} Aucune donnée n’a été modifiée.`,
      routing,
      { actions }
    )
  }
  if (intent.intent === 'SUGGESTION_EXPLANATION') {
    if (!intent.suggestionId) return reply(intent, null, 'Ouvre une suggestion Gerard ou indique laquelle expliquer.', routing)
    const suggestion = await explainSuggestion(input.weekStart, intent.suggestionId)
    if (!suggestion) return reply(intent, null, 'Cette suggestion est périmée ou introuvable. Relance l’analyse du planning.', routing)
    const context = await getPlanningSummary(input.weekStart)
    return reply(intent, { ...context, suggestions: [suggestion] }, describeSuggestion(suggestion), routing)
  }
  if (agentFailure) return reply(intent, null, 'Je n’arrive pas à analyser ta question pour le moment : l’assistant est momentanément indisponible. Réessaie dans un instant, ou demande-moi directement une mission, une ressource ou le planning de la semaine.', routing)
  return reply(intent, null, 'Je n’ai pas identifié la demande avec suffisamment de précision. Indique une semaine, une mission ou une ressource à vérifier.', routing)
}
