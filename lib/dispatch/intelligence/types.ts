import type { GerardSuggestion } from '../suggestions/types'

export type GerardAssistantIntent =
  | 'PLANNING_SUMMARY'
  | 'MISSION_CONTEXT'
  | 'MISSION_ALTERNATIVES'
  | 'RESOURCE_EXPLANATION'
  | 'PLANNING_SUGGESTIONS'
  | 'SUGGESTION_EXPLANATION'
  | 'SIMULATE_SUGGESTION'
  | 'UNKNOWN'

export type GerardAssistantFact = {
  label: string
  value: string | number | boolean | null
  source: string
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW'
}

export type GerardAssistantAction = {
  type: 'SIMULATE'
  label: string
  suggestionId: string
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
  routing: {
    source: 'ROUTER' | 'OPENAI' | 'FALLBACK'
    providerCalls: 0 | 1
    providerDurationMs: number | null
  }
}
