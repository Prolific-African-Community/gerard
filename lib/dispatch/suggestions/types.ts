import type {
  CompatibilityCode,
  OptimizationConfidence,
  OptimizationDataSource,
} from '../optimization'

export type GerardSuggestionType = 'REASSIGNMENT_EFFICIENCY'
export type GerardSuggestionSeverity = 'INFO' | 'WARNING' | 'CRITICAL'
export type GerardSuggestionConfidence = Exclude<
  OptimizationConfidence,
  'LOW'
>
export type GerardSuggestionAction = 'VIEW_REASON' | 'SIMULATE' | 'APPLY'

export type GerardSuggestionState = {
  candidateId: string
  missionId: string
  missionReference: string
  pairRowId: string
  driverId: string
  driverName: string
  truckId: string
  truckPlateNumber: string
  trailerId: string | null
  trailerPlateNumber: string | null
  possibleStartAt: string | null
  completedAt: string | null
  score: number
  emptyKm: number
  estimatedCost: number | null
  estimatedMargin: number | null
  currency: string
  approachDistanceMeters: number
  approachDurationSeconds: number
  approachProvider: string | null
  trailerTransitions: Array<{ reason: string; from: string; to: string }>
}

export type GerardSuggestion = {
  id: string
  version: string
  type: GerardSuggestionType
  severity: GerardSuggestionSeverity
  weekStart: string
  snapshotFingerprint: string
  title: string
  summary: string
  reason: string
  currentState: GerardSuggestionState
  proposedState: GerardSuggestionState
  impact: {
    emptyKm: {
      current: number
      proposed: number
      delta: number
    }
    estimatedCost: {
      current: number | null
      proposed: number | null
      delta: number | null
      currency: string
    }
    estimatedMargin: {
      current: number | null
      proposed: number | null
      delta: number | null
      currency: string
    }
    timeMinutes: {
      current: number | null
      proposed: number | null
      delta: number | null
    }
  }
  confidence: GerardSuggestionConfidence
  evidence: {
    candidateIds: string[]
    routeKeys: string[]
    routeSources: OptimizationDataSource[]
    compatibilityCodes: CompatibilityCode[]
    scoreFactors: Array<{
      code: string
      currentValue: number | null
      proposedValue: number | null
      delta: number | null
    }>
    assumptions: string[]
    missingData: string[]
  }
  affectedMissionIds: string[]
  affectedResources: {
    pairRowIds: string[]
    driverIds: string[]
    truckIds: string[]
    trailerIds: string[]
  }
  applicability: {
    canSimulate: true
    canApply: true
    blockingCodes: string[]
    requiresExplicitConfirmation: true
  }
  availableActions: GerardSuggestionAction[]
}

export type SuggestionMutationPlan = {
  suggestionId: string
  weekStart: string
  snapshotFingerprint: string
  missionId: string
  currentAssignment: {
    assignmentId: string
    updatedAt: string
    pairRowId: string
    driverId: string
    truckId: string
    trailerId: string | null
  }
  proposedAssignment: {
    pairRowId: string
    driverId: string
    truckId: string
    trailerId: string | null
    scheduledDate: string
    plannedEndAt: string
    approachDistanceMeters: number
    approachDurationSeconds: number
    approachProvider: string | null
    trailerTransitions: Array<{ reason: string; from: string; to: string }>
  }
}
