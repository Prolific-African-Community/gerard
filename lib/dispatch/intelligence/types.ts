import type { GerardSuggestion } from '../suggestions/types'

export type GerardAssistantIntent =
  | 'PLANNING_SUMMARY'
  | 'MISSION_CONTEXT'
  | 'MISSION_ALTERNATIVES'
  | 'RESOURCE_EXPLANATION'
  | 'PLANNING_SUGGESTIONS'
  | 'SUGGESTION_EXPLANATION'
  | 'SIMULATE_SUGGESTION'
  | 'APPLY_SUGGESTION'
  | 'UNKNOWN'

export type GerardAssistantFact = {
  label: string
  value: string | number | boolean | null
  source: string
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW'
}

export type GerardAssistantSimulateAction = {
  type: 'SIMULATE'
  label: string
  suggestionId: string
}

/**
 * Action d'application en attente. Les champs lisibles servent uniquement à
 * l'affichage : seule la confirmation explicite renvoyée avec `token` autorise
 * une écriture, et le serveur relit les valeurs dans le jeton signé.
 */
export type GerardAssistantConfirmApplyAction = {
  type: 'CONFIRM_APPLY'
  label: string
  suggestionId: string
  missionReference: string
  snapshotFingerprint: string
  idempotencyKey: string
  summary: string
  token: string
}

export type GerardAssistantAction =
  | GerardAssistantSimulateAction
  | GerardAssistantConfirmApplyAction

export type GerardAssistantConfirmation = { token: string }

export type GerardAssistantApplicationOutcome = {
  status: 'APPLIED' | 'ALREADY_APPLIED' | 'STALE' | 'CONFLICT' | 'INVALID' | 'FORBIDDEN'
  missionId?: string
  assignmentId?: string
  applicationId?: string
}

export type GerardAssistantContext = {
  weekStart: string
  missionIds: string[]
  driverIds: string[]
  truckIds: string[]
  trailerIds: string[]
  facts: GerardAssistantFact[]
  warnings: string[]
  availableActions: GerardAssistantAction[]
  suggestions?: GerardSuggestion[]
  details?: Record<string, unknown>
}

export type GerardAssistantIntentResult = {
  intent: GerardAssistantIntent
  missionReference?: string
  driverName?: string
  truckPlate?: string
  trailerPlate?: string
  suggestionId?: string
  requestsMutation?: boolean
}

export type GerardAssistantReply = {
  answer: string
  intent: GerardAssistantIntent
  data: GerardAssistantContext | null
  actions: GerardAssistantAction[]
  warnings: string[]
  application: GerardAssistantApplicationOutcome | null
  routing: {
    source: 'ROUTER' | 'OPENAI' | 'FALLBACK'
    providerCalls: 0 | 1
    providerDurationMs: number | null
    /**
     * Statut brut du fournisseur, pour distinguer une panne de provider d'un
     * repli déterministe volontaire. `null` quand aucun appel n'a eu lieu.
     */
    providerStatus:
      | 'SUCCESS'
      | 'UNCONFIGURED'
      | 'HTTP_ERROR'
      | 'INVALID_OUTPUT'
      | 'TIMEOUT'
      | 'PROVIDER_ERROR'
      | null
  }
}
