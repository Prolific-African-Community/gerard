import { getActiveOrganizationContext } from '../../auth/organization-context'

/**
 * Observabilité V1 de Gerard Intelligence : des journaux structurés, une ligne
 * par évènement, sans nouveau modèle de base. Le but est de pouvoir répondre à
 * « est-ce que Gerard fonctionne correctement ? » — pas de bâtir une plateforme
 * d'analyse.
 *
 * Rien de sensible n'est journalisé : jamais de jeton, de secret, ni de charge
 * utile brute d'un fournisseur.
 */
export type IntelligenceEvent =
  | 'analysis.started'
  | 'analysis.completed'
  | 'analysis.failed'
  | 'insights.completed'
  | 'simulation.requested'
  | 'simulation.completed'
  | 'simulation.failed'
  | 'confirmation.offered'
  | 'application.attempted'
  | 'application.completed'
  | 'application.refused'
  | 'application.failed'
  | 'assistant.routed'
  | 'provider.degraded'

export type IntelligenceEventFields = {
  /** Semaine analysée, au format ISO court. */
  week?: string
  suggestionId?: string
  missionId?: string
  missionIds?: string[]
  userId?: string
  /** Issue métier : APPLIED, ALREADY_APPLIED, STALE, CONFLICT, INVALID… */
  result?: string
  reason?: string
  durationMs?: number
  analyzedMissions?: number
  incompleteMissions?: number
  suggestions?: number
  insights?: number
  bySeverity?: Record<string, number>
  /** Métriques de routes de l'opération, sans aucune donnée de fournisseur. */
  routeLookups?: number
  routeCacheHits?: number
  routeProviderCalls?: number
  routeBlocked?: number
  providerSource?: string
  providerStatus?: string
  providerDurationMs?: number
  providerCalls?: number
}

const prefix = '[gerard.intelligence]'

const degradedEvents = new Set<IntelligenceEvent>([
  'analysis.failed',
  'simulation.failed',
  'application.failed',
  'provider.degraded',
])

/**
 * L'organisation vient du contexte serveur, jamais de l'appelant : un évènement
 * ne peut pas être attribué au mauvais tenant.
 */
export function logIntelligenceEvent(event: IntelligenceEvent, fields: IntelligenceEventFields = {}) {
  const organizationId = getActiveOrganizationContext()?.organizationId ?? null
  const payload: Record<string, unknown> = { event, organizationId }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) payload[key] = value
  }
  const line = `${prefix} ${JSON.stringify(payload)}`
  if (degradedEvents.has(event)) console.warn(line)
  else console.info(line)
}

/** Mesure une opération et journalise son issue, réussie ou non. */
export async function observeIntelligenceOperation<T>(
  events: { started?: IntelligenceEvent; completed: IntelligenceEvent; failed: IntelligenceEvent },
  fields: IntelligenceEventFields,
  task: () => Promise<{ value: T; completedFields?: IntelligenceEventFields }>
): Promise<T> {
  const startedAt = Date.now()
  if (events.started) logIntelligenceEvent(events.started, fields)
  try {
    const { value, completedFields } = await task()
    logIntelligenceEvent(events.completed, { ...fields, ...completedFields, durationMs: Date.now() - startedAt })
    return value
  } catch (error) {
    logIntelligenceEvent(events.failed, {
      ...fields,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : 'UNKNOWN',
    })
    throw error
  }
}
