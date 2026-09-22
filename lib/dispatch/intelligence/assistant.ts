import { routeAssistantIntent } from './intent-router'
import { classifyIntentWithConfiguredModel } from './llm-router'
import { explainSuggestion, getMissionContext, getPlanningSuggestions, getPlanningSummary, getResourceAvailability, resolveMissionReference, simulateSuggestion } from './facade'
import type { GerardAssistantContext, GerardAssistantIntentResult, GerardAssistantReply } from './types'
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

function reply(intent: GerardAssistantIntentResult, context: GerardAssistantContext | null, answer: string, routing: Routing): GerardAssistantReply {
  return { answer, intent: intent.intent, data: context, actions: context?.availableActions ?? [], warnings: context?.warnings ?? [], routing }
}

export function describeSuggestion(suggestion: GerardSuggestion) {
  return `${suggestion.proposedState.driverName} remplacerait ${suggestion.currentState.driverName} sur ${suggestion.currentState.missionReference}. Gain estimé : ${Math.max(0, -suggestion.impact.emptyKm.delta).toFixed(1)} km à vide et ${Math.max(0, suggestion.impact.estimatedMargin.delta ?? 0).toFixed(2)} € de marge. Confiance ${suggestion.confidence === 'HIGH' ? 'haute' : 'moyenne'}.`
}

export async function answerAssistantQuestion(input: { message: string; weekStart: Date; conversationContext?: { missionReference?: string; suggestionId?: string } }): Promise<GerardAssistantReply> {
  let intent = routeAssistantIntent(input.message)
  let routing: Routing = { source: 'ROUTER', providerCalls: 0, providerDurationMs: null }
  if (intent.intent === 'UNKNOWN' && !intent.requestsMutation) {
    const classified = await classifyIntentWithConfiguredModel(input.message, input.conversationContext)
    routing = { source: classified.intent ? 'OPENAI' : 'FALLBACK', providerCalls: 1, providerDurationMs: classified.durationMs }
    if (classified.intent) intent = classified.intent
    if (classified.status !== 'SUCCESS') console.warn(`[GerardAssistant] providerStatus=${classified.status} providerMs=${classified.durationMs}`)
  }
  const explicitMissionReference = intent.missionReference
  if (!intent.missionReference && !/\bdemain\b/i.test(input.message)) intent.missionReference = input.conversationContext?.missionReference
  intent.suggestionId ??= input.conversationContext?.suggestionId
  console.info(`[GerardAssistant] intent=${intent.intent} source=${routing.source} providerMs=${routing.providerDurationMs ?? 0}`)
  if (intent.requestsMutation) return reply(intent, null, "Je peux vérifier et simuler cette proposition, mais l’application depuis l’assistant n’est pas activée pour le moment.", routing)

  if (intent.missionReference) {
    const resolution = await resolveMissionReference(input.weekStart, intent.missionReference)
    if (resolution.status === 'AMBIGUOUS') return reply(intent, null, `Plusieurs missions correspondent : ${resolution.references.join(', ')}. Précise la référence complète.`, routing)
    if (resolution.status === 'FOUND') intent.missionReference = resolution.references[0]
    else if (explicitMissionReference) return reply(intent, null, `Mission ${explicitMissionReference} introuvable.`, routing)
  }

  if (intent.intent === 'PLANNING_SUMMARY') {
    const context = await getPlanningSummary(input.weekStart)
    const suggestions = numberFact(context, 'Suggestions applicables')
    return reply(intent, context, `${numberFact(context, 'Missions analysées')} missions analysées, ${numberFact(context, 'Baselines valides')} baselines valides et ${numberFact(context, 'Alternatives valides')} alternatives valides. ${suggestions ? `${suggestions} amélioration(s) significative(s) et applicable(s) détectée(s).` : "Gerard n’a détecté aucune amélioration significative et applicable avec les règles et données actuellement disponibles."}`, routing)
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
    const result = await simulateSuggestion(input.weekStart, intent.suggestionId)
    if (result.status === 'STALE') return reply(intent, null, 'Il n’y a actuellement aucune suggestion valide à simuler. Relance l’analyse après un changement du planning.', routing)
    const context = await getPlanningSummary(input.weekStart)
    return reply(intent, { ...context, suggestions: [result.suggestion!] }, `Suggestion toujours valide pour ${result.suggestion!.currentState.missionReference}. Aucune donnée n’a été modifiée.`, routing)
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
