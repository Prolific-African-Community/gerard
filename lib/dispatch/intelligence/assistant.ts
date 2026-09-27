import { routeAssistantIntent } from './intent-router'
import { classifyIntentWithConfiguredModel } from './llm-router'
import { explainSuggestion, getMissionContext, getPlanningInsights, getPlanningSuggestions, getPlanningSummary, getResourceAvailability, resolveMissionReference, simulateSuggestion } from './facade'
import { buildPendingApplyAction, verifyPendingApplyToken } from './pending-action'
import type { GerardAssistantAction, GerardAssistantApplicationOutcome, GerardAssistantConfirmation, GerardAssistantContext, GerardAssistantIntentResult, GerardAssistantReply } from './types'
import { SuggestionApplicationError, applyPlanningSuggestion } from '../suggestions/application'
import { formatDateParam } from '../date-utils'
import type { GerardSuggestion } from '../suggestions/types'

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

const confidenceLabels = { HIGH: 'haute', MEDIUM: 'moyenne' } as const

/**
 * L'explication dérive du score réellement calculé : elle nomme la composante
 * qui a emporté la décision, puis les autres contributions. Aucun récit n'est
 * reconstruit à partir des seuls chiffres d'impact.
 */
export function describeSuggestion(suggestion: GerardSuggestion) {
  const breakdown = suggestion.scoreBreakdown
  const opening = `${suggestion.proposedState.driverName} remplacerait ${suggestion.currentState.driverName} sur ${suggestion.currentState.missionReference}.`
  if (!breakdown) {
    return `${opening} Gain estimé : ${Math.max(0, -suggestion.impact.emptyKm.delta).toFixed(1)} km à vide et ${Math.max(0, suggestion.impact.estimatedMargin.delta ?? 0).toFixed(2)} € de marge. Confiance ${confidenceLabels[suggestion.confidence]}.`
  }
  const byCode = new Map(breakdown.components.map((component) => [component.code, component]))
  const primary = breakdown.primaryReason ? byCode.get(breakdown.primaryReason) : null
  const secondary = breakdown.components
    .filter((component) => component.code !== breakdown.primaryReason && component.code !== 'UNCERTAINTY' && component.contribution > 0)
    .sort((left, right) => right.contribution - left.contribution)[0]
  // Le détail de la composante économique dit déjà d'où viennent les chiffres :
  // on ne répète la mise en garde que si elle n'a pas déjà été formulée.
  const marginShown = primary?.code === 'MARGIN' || secondary?.code === 'MARGIN'
  const economics = breakdown.economicBasis === 'UNAVAILABLE'
    ? 'La comparaison économique n’est pas disponible.'
    : marginShown
      ? null
      : 'Les données économiques sont estimées à partir des paramètres de coût par défaut.'
  return [
    opening,
    primary ? `Principalement parce qu’elle agit sur : ${primary.label.toLocaleLowerCase('fr-FR')}. ${primary.detail}` : 'Aucune composante ne ressort nettement.',
    secondary ? secondary.detail : null,
    economics,
    `Confiance des données : ${confidenceLabels[suggestion.confidence]}.`,
  ].filter(Boolean).join(' ')
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

export async function answerAssistantQuestion(input: {
  message: string
  weekStart: Date
  userId?: string
  /** Vrai uniquement si l'appelant a été contrôlé sur la permission d'affectation. */
  canApply?: boolean
  conversationContext?: { missionReference?: string; suggestionId?: string }
  confirmation?: GerardAssistantConfirmation
}): Promise<GerardAssistantReply> {
  const deterministicRouting: Routing = { source: 'ROUTER', providerCalls: 0, providerDurationMs: null, providerStatus: null }
  // Une confirmation structurée ne passe pas par l'interprétation du message :
  // elle est vérifiée, puis exécutée ou refusée.
  if (input.confirmation) {
    return applyConfirmedSuggestion({ confirmation: input.confirmation, userId: input.userId, canApply: input.canApply, routing: deterministicRouting })
  }
  let intent = routeAssistantIntent(input.message)
  let routing: Routing = deterministicRouting
  if (intent.intent === 'UNKNOWN' && !intent.requestsMutation) {
    const classified = await classifyIntentWithConfiguredModel(input.message, input.conversationContext)
    routing = { source: classified.intent ? 'OPENAI' : 'FALLBACK', providerCalls: 1, providerDurationMs: classified.durationMs, providerStatus: classified.status }
    if (classified.intent) intent = classified.intent
    if (classified.status !== 'SUCCESS') console.warn(`[GerardAssistant] providerStatus=${classified.status} providerMs=${classified.durationMs}`)
  }
  const explicitMissionReference = intent.missionReference
  if (!intent.missionReference && !/\bdemain\b/i.test(input.message)) intent.missionReference = input.conversationContext?.missionReference
  intent.suggestionId ??= input.conversationContext?.suggestionId
  console.info(`[GerardAssistant] intent=${intent.intent} source=${routing.source} providerMs=${routing.providerDurationMs ?? 0}`)
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
  return reply(intent, null, 'Je n’ai pas identifié la demande avec suffisamment de précision. Indique une semaine, une mission ou une ressource à vérifier.', routing)
}
