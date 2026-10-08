import type {
  DispatchOptimizationInput,
  DispatchOptimizationResult,
  OptimizationStrategy,
  StrategyComparison,
} from '../optimization'
import type { PlanningMissionScopeSummary } from './mission-scope'

export type AutoPlanningSnapshot = {
  id: string
  fingerprint: string
  /** Empreintes courtes par catégorie de données : sert à dire ce qui a changé, jamais à décider. */
  fingerprintParts: Record<string, string>
  createdAt: string
  expiresAt: string
  freshness: 'FRESH' | 'EXPIRED'
  input: DispatchOptimizationInput
  versions: {
    pairFoundation: string
    regulatoryProfile: string
    optimizationConfiguration: string
  }
  sourceCounts: {
    pairs: number
    missions: number
    trailers: number
    transitions: number
    existingAssignments: number
  }
  missingData: string[]
  missionScope: PlanningMissionScopeSummary
}

export type SimulationRequest = {
  weekStart: string
  strategy: OptimizationStrategy
  compareStrategies: boolean
  includeExistingForced: boolean
}

export type SimulationResponse = {
  simulationId: string
  snapshotFingerprint: string
  snapshotToken: string
  createdAt: string
  expiresAt: string
  heuristicNotice: string
  selectedStrategy: OptimizationStrategy
  result: DispatchOptimizationResult
  comparison: StrategyComparison | null
  pairLabels: Record<
    string,
    { driverName: string; truckPlateNumber: string; locked: boolean }
  >
  adjustmentOptions: Record<string, ProposalAdjustmentOption[]>
  snapshotSummary: {
    sourceCounts: AutoPlanningSnapshot['sourceCounts']
    missingData: string[]
    missionScope: PlanningMissionScopeSummary
  }
  reconciliation: {
    visible: number
    included: number
    excluded: number
    confirmed: number
    conditional: number
    red: number
    manualPreserved: number
    impossible: number
    deferred: number
    unassigned: number
    candidates: number
    confirmedProposals: number
    conditionalProposals: number
    poolEquationValid: boolean
    resultEquationValid: boolean
    outcomes: Array<{
      missionId: string
      reference: string
      category:
        | 'CONFIRMED'
        | 'CONDITIONAL'
        | 'IMPOSSIBLE'
        | 'DEFERRED'
        | 'UNASSIGNED'
        | 'EXCLUDED'
      code: string
      reason: string
    }>
  }
  defaults: { strategy: 'BALANCED' }
  preparation?: {
    planningRowsCreated: number
    missionsPrepared: number
    missionsRequiringReview: number
    preparationFailures: number
  }
}

export type ProposalAdjustmentOption = {
  id: string
  missionId: string
  pairRowId: string
  driverId: string
  truckId: string
  trailerId: string | null
  driverName: string
  truckPlateNumber: string
  trailerPlateNumber: string | null
  classification: 'GREEN' | 'ORANGE'
  score: number
  possibleStartAt: string | null
  explanation: {
    summary: string
    missingData: string[]
  }
}

export type ProposalAdjustment = {
  missionId: string
  pairRowId: string
  trailerId: string | null
}

export type ApplyRequest = {
  snapshotToken: string
  snapshotFingerprint: string
  simulationId: string
  strategy: OptimizationStrategy
  selectedMissionIds: string[]
  confirmedConditionalMissionIds: string[]
  adjustments: ProposalAdjustment[]
  idempotencyKey: string
}

export type ApplyResult = {
  idempotentReplay: boolean
  applicationId: string
  appliedMissionIds: string[]
  pairRowIds: string[]
  ignoredMissionIds: string[]
  warnings: string[]
  /** Approches camion → enlèvement finalisées après l'application (absent pour un rejeu). */
  approaches?: {
    persisted: number
    unresolved: number
    routeMetrics: { lookups: number; cacheHits: number; cacheMisses: number; googleCalls: number; blockedByLimit: number }
  }
}

export type SnapshotTokenPayload = {
  simulationId: string
  fingerprint: string
  userId: string
  weekStart: string
  includeExistingForced: boolean
  /** Instant de référence figé : l'application rejoue l'instantané à cet instant, pas à l'horloge courante. */
  createdAt: string
  expiresAt: string
  /** Empreintes par catégorie, absentes des jetons émis avant ce correctif. */
  parts?: Record<string, string>
}
