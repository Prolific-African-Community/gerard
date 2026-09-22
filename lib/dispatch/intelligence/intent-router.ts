import type { GerardAssistantIntentResult } from './types'

const missionPattern = /\b(?:GRD|QA)[-_][A-Z0-9-]+\b/i

function normalize(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeMissionReference(value: string | undefined) {
  if (!value) return undefined
  const normalized = value.trim().toUpperCase()
  if (/^\d{6}-\d{2}$/.test(normalized)) return `GRD-${normalized}`
  if (/^\d{1,2}$/.test(normalized)) return normalized.padStart(2, '0')
  return /^(?:GRD|QA)[-_][A-Z0-9-]+$/.test(normalized) ? normalized : undefined
}

export function routeAssistantIntent(message: string): GerardAssistantIntentResult {
  const clean = normalize(message)
  const lower = clean.toLocaleLowerCase('fr-FR')
  const missionReference = clean.match(missionPattern)?.[0]?.toUpperCase()

  if (/^(?:(?:ok|d'accord|oui)[,\s]+)?(?:(?:peux[- ]tu|merci de|je veux que tu)\s+)?(?:applique|appliquer|affecte|affecter|déplace|deplace|change|modifie|modifier|crée|cree)\b/.test(lower)) {
    return { intent: 'UNKNOWN', missionReference, requestsMutation: true }
  }
  if (/\b(simule|simuler|simulation|toujours valide|revalide|revérifie|reverifie)\b/.test(lower)) {
    return { intent: 'SIMULATE_SUGGESTION', missionReference }
  }
  if (/\b(explique|pourquoi)\b.*\b(suggestion|proposition)\b/.test(lower)) {
    return { intent: 'SUGGESTION_EXPLANATION', missionReference }
  }
  const whyDriver = clean.match(/pourquoi\s+pas\s+(.+?)\s+(?:sur|pour)\s+(?:la\s+mission\s+)?((?:GRD|QA)[-_][A-Z0-9-]+)/i)
  if (whyDriver) {
    const resource = whyDriver[1].trim()
    const truck = resource.match(/^(?:le\s+)?camion\s+(.+)$/i)
    const trailer = resource.match(/^(?:la\s+)?remorque\s+(.+)$/i)
    return {
      intent: 'RESOURCE_EXPLANATION',
      ...(truck ? { truckPlate: truck[1].trim().toUpperCase() } : trailer ? { trailerPlate: trailer[1].trim().toUpperCase() } : { driverName: resource }),
      missionReference: whyDriver[2].toUpperCase(),
    }
  }
  if (missionReference && /\b(alternative|remplacer|autre chauffeur|autre camion|autre remorque)\b/.test(lower)) {
    return { intent: 'MISSION_ALTERNATIVES', missionReference }
  }
  if (missionReference || /\b(cette mission|mission sélectionnée|mission selectionnee)\b/.test(lower)) {
    return { intent: 'MISSION_CONTEXT', missionReference }
  }
  if (/\b(suggestion|optimis\w*|kilomètres? à vide|kilometres? a vide|changerais|amélior\w*|amelior\w*)\b/.test(lower)) {
    return { intent: 'PLANNING_SUGGESTIONS' }
  }
  if (/\b(analyse|planning|semaine|conflit|risque)\b/.test(lower)) {
    return { intent: 'PLANNING_SUMMARY' }
  }
  return { intent: 'UNKNOWN' }
}

const allowedIntents = new Set([
  'PLANNING_SUMMARY', 'MISSION_CONTEXT', 'MISSION_ALTERNATIVES',
  'RESOURCE_EXPLANATION', 'PLANNING_SUGGESTIONS',
  'SUGGESTION_EXPLANATION', 'SIMULATE_SUGGESTION', 'UNKNOWN',
])

export function parseModelIntent(value: unknown): GerardAssistantIntentResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const allowedKeys = new Set(['intent', 'missionReference', 'driverName', 'truckPlate', 'trailerPlate', 'suggestionId', 'requestsMutation'])
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return null
  if (typeof record.intent !== 'string' || !allowedIntents.has(record.intent)) return null
  if (typeof record.requestsMutation !== 'boolean') return null
  for (const key of ['missionReference', 'driverName', 'truckPlate', 'trailerPlate', 'suggestionId']) {
    if (record[key] !== null && typeof record[key] !== 'string') return null
  }
  const text = (key: string) => typeof record[key] === 'string' ? String(record[key]).trim() || undefined : undefined
  return {
    intent: record.intent as GerardAssistantIntentResult['intent'],
    missionReference: normalizeMissionReference(text('missionReference')),
    driverName: text('driverName'),
    truckPlate: text('truckPlate'),
    trailerPlate: text('trailerPlate'),
    suggestionId: text('suggestionId'),
    requestsMutation: record.requestsMutation === true,
  }
}
