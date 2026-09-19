import type {
  DriverRegulatoryState,
  MissionTemporalEvaluation,
  MissionTemporalPlan,
  PreparedPairReference,
  RegulatoryProfile,
  TemporalLocation,
} from '../regulatory'
import type { ResourceOccupation } from '../resource-availability'

export type OptimizationStrategy =
  | 'MAX_PROFITABILITY'
  | 'BALANCED'
  | 'MAX_COVERAGE'

export type OptimizationConfidence = 'HIGH' | 'MEDIUM' | 'LOW'
export type OptimizationDataSource =
  | 'DISPATCH'
  | 'GOOGLE_ROUTES'
  | 'DECLARED'
  | 'ESTIMATED'
  | 'UNKNOWN'

export type CompatibilityCode =
  | 'COMPATIBLE'
  | 'COMPATIBLE_WITH_CONDITION'
  | 'DRIVER_UNAVAILABLE'
  | 'TRUCK_UNAVAILABLE'
  | 'TRAILER_UNAVAILABLE'
  | 'TRUCK_TYPE_MISMATCH'
  | 'TRAILER_TYPE_MISMATCH'
  | 'TRAILER_CARGO_MISMATCH'
  | 'COUPLING_TYPE_MISMATCH'
  | 'INSUFFICIENT_CAPACITY'
  | 'RESOURCE_TIME_CONFLICT'
  | 'DRIVER_TIME_CONFLICT'
  | 'TRUCK_TIME_CONFLICT'
  | 'TRAILER_TIME_CONFLICT'
  | 'REQUIRED_TRAILER_MISSING'
  | 'TRAILER_POSITION_UNKNOWN'
  | 'MISSION_REQUIREMENTS_UNKNOWN'
  | 'REGULATORY_STATE_UNKNOWN'
  | 'POSITION_UNCERTAIN'
  | 'TEMPORALLY_INFEASIBLE'
  | 'REGULATORILY_INFEASIBLE'
  | 'MISSING_ROUTE'
  | 'FORCED_PAIR_MISMATCH'

export type CompatibilityStatus =
  | 'COMPATIBLE'
  | 'INCOMPATIBLE'
  | 'INDETERMINATE'
  | 'CONDITIONAL'

export type OptimizationPair = {
  pair: PreparedPairReference
  driverName: string
  driverStatus: string
  truckPlateNumber: string
  truckStatus: string
  usualTruckId: string | null
  exceptionalReplacement: boolean
  availableAt: string
  initialPosition: TemporalLocation | null
  regulatoryState: DriverRegulatoryState
  truckType?: string | null
  truckCapacity?: number | null
  couplingType?: string | null
  restrictions: string[]
}

export type OptimizationMission = {
  id: string
  reference: string
  status: string
  priority: number
  createdAt?: string
  reportable: boolean
  nonReportable?: boolean
  temporalPlan: MissionTemporalPlan
  pickup: TemporalLocation | null
  delivery: TemporalLocation | null
  loadedDistanceMeters: number | null
  revenueAmount: number | null
  currency: string
  requiredTruckType?: string | null
  requiredTrailerType?: string | null
  requiredCapacity?: number | null
  requiredCargoType?: string | null
  requiredCouplingType?: string | null
  requiredTrailerId?: string | null
  forcedPairRowId?: string | null
  dependencies: string[]
  missingData: string[]
  confidence: OptimizationConfidence
}

export type OptimizationTrailer = {
  id: string
  plateNumber: string
  status: string
  type: string
  capacity?: number | null
  compatibleCargoTypes?: string[] | null
  couplingType?: string | null
  position: TemporalLocation | null
  availableAt: string
  attachedTruckId?: string | null
  forcedMissionId?: string | null
  restrictions: string[]
}

export type RouteTransition = {
  key: string
  from: TemporalLocation
  to: TemporalLocation
  distanceMeters: number
  durationSeconds: number
  source: OptimizationDataSource
  confidence: OptimizationConfidence
  reason:
    | 'INITIAL_APPROACH'
    | 'MISSION_TRANSITION'
    | 'TRAILER_PICKUP'
    | 'RETURN_TO_BASE'
    | 'BASE_TO_PICKUP'
  empty: boolean
}

export type OptimizationCostParameters = {
  currency: string
  costPerKm?: number | null
  defaultHourlyCost?: number | null
  waitingCostPerHour?: number | null
  trailerChangeCost?: number | null
  returnToBaseCost?: number | null
  deferPenalty?: number | null
}

export type OptimizationLimits = {
  maximumCandidates: number
  maximumIterations: number
  maximumDurationMs: number
  maximumAlternativesPerMission: number
}

export type StrategyWeights = {
  revenue: number
  estimatedMargin: number
  coverage: number
  priority: number
  emptyKm: number
  workBalance: number
  returnToBase: number
  trailerChange: number
  lowConfidence: number
  habitualTruck: number
}

export type OptimizationConfiguration = {
  id: string
  version: string
  limits: OptimizationLimits
  weights: Record<OptimizationStrategy, StrategyWeights>
}

export type DispatchOptimizationInput = {
  executionSeed: string
  period: { startsAt: string; endsAt: string }
  timeZone: string
  strategy: OptimizationStrategy
  pairs: OptimizationPair[]
  missions: OptimizationMission[]
  trailers: OptimizationTrailer[]
  transitions: RouteTransition[]
  resourceOccupations?: ResourceOccupation[]
  unavailableResourceIds: string[]
  costs: OptimizationCostParameters
  profile: RegulatoryProfile
  configuration: OptimizationConfiguration
}

export type CompatibilityEvaluation = {
  status: CompatibilityStatus
  codes: CompatibilityCode[]
  messages: string[]
  missingData: string[]
}

export type CostBreakdown = {
  revenueKnown: number | null
  knownCost: number | null
  estimatedCost: number | null
  estimatedMargin: number | null
  emptyDistanceKm: number
  approachDurationHours: number
  approachCost: number | null
  waitingHours: number
  waitingCost: number | null
  trailerChangeCost: number | null
  returnToBaseCost: number | null
  currency: string
  assumptions: string[]
}

export type ScoreFactor = {
  code: string
  value: number
  weightedValue: number
  explanation: string
}

export type OptimizationCandidate = {
  id: string
  pair: OptimizationPair
  mission: OptimizationMission
  trailer: OptimizationTrailer | null
  transitions: RouteTransition[]
  compatibility: CompatibilityEvaluation
  temporalEvaluation: MissionTemporalEvaluation | null
  cost: CostBreakdown
  score: number
  factors: ScoreFactor[]
  confidence: OptimizationConfidence
  requiresReturnToBase: boolean
  trailerChange: boolean
}

export type ProposedMission = {
  missionId: string
  reference: string
  trailerId: string | null
  trailerPlateNumber?: string | null
  trailerChange: boolean
  temporalEvaluation: MissionTemporalEvaluation | null
  transitions: RouteTransition[]
  loadedDistanceMeters: number | null
  cost: CostBreakdown
  score: number
  confidence: OptimizationConfidence
  explanation: OptimizationExplanation
}

export type OptimizationExplanation = {
  positives: string[]
  penalties: string[]
  satisfiedConstraints: string[]
  eliminatedAlternatives: CompatibilityCode[]
  assumptions: string[]
  missingData: string[]
  alternatives: Array<{ pairRowId: string; score: number; reason: string }>
  summary: string
}

export type PairProposal = {
  pair: PreparedPairReference
  locked: boolean
  missions: ProposedMission[]
  timeline: MissionTemporalEvaluation['timeline']
  finalPosition: TemporalLocation | null
  finalRegulatoryState: DriverRegulatoryState | null
  nextAvailableAt: string
  revenueKnown: number
  knownCost: number | null
  estimatedCost: number | null
  estimatedMargin: number | null
  score: number
  confidence: OptimizationConfidence
}

export type UnassignedCategory =
  | 'INFEASIBLE'
  | 'INDETERMINATE'
  | 'DEFERRED'
  | 'LOWER_PRIORITY'
  | 'NO_COMPATIBLE_PAIR'
  | 'NO_COMPATIBLE_TRAILER'
  | 'TIME_WINDOW_IMPOSSIBLE'
  | 'REGULATORY_LIMIT'
  | 'MISSING_REQUIRED_DATA'
  | 'COMPUTATION_LIMIT_REACHED'

export type UnassignedMission = {
  missionId: string
  reference: string
  category: UnassignedCategory
  codes: Array<CompatibilityCode | string>
  missingData: string[]
  message: string
}

export type OptimizationMetrics = {
  assignedMissions: number
  confirmedMissions: number
  conditionalMissions: number
  unassignedMissions: number
  revenueCovered: number
  estimatedMargin: number | null
  loadedKilometers: number
  emptyKilometers: number
  drivingSeconds: number
  otherWorkSeconds: number
  returnsToBase: number
  trailerChanges: number
  workloadImbalance: number
  candidatesGenerated: number
  candidatesEliminated: number
  sequencesEvaluated: number
}

export type DispatchOptimizationResult = {
  executionId: string
  strategy: OptimizationStrategy
  configurationVersion: string
  period: DispatchOptimizationInput['period']
  status: 'COMPLETE' | 'PARTIAL' | 'INDETERMINATE'
  score: number
  metrics: OptimizationMetrics
  confirmedProposals: PairProposal[]
  conditionalProposals: PairProposal[]
  impossibleMissions: UnassignedMission[]
  deferredMissions: UnassignedMission[]
  unassignedMissions: UnassignedMission[]
  unusedPairRowIds: string[]
  unusedTrailerIds: string[]
  trailerFinalStates: Array<{
    trailerId: string
    position: TemporalLocation | null
    availableAt: string
    attachedTruckId: string | null
  }>
  alerts: string[]
  missingData: string[]
  computationLimitReached: boolean
  computationDurationMs: number
}

export type StrategyComparison = {
  results: Record<OptimizationStrategy, DispatchOptimizationResult>
  metrics: Record<OptimizationStrategy, OptimizationMetrics>
}
