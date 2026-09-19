export type TemporalActivityType =
  | 'DRIVING'
  | 'OTHER_WORK'
  | 'AVAILABILITY'
  | 'BREAK'
  | 'DAILY_REST'
  | 'WEEKLY_REST'
  | 'UNKNOWN'

export type TemporalDataSource =
  | 'TACHOGRAPH'
  | 'DISPATCHER_DECLARATION'
  | 'DRIVER_DECLARATION'
  | 'MISSION'
  | 'GOOGLE_ROUTES'
  | 'SYSTEM_DEFAULT'
  | 'SIMULATION'
  | 'UNKNOWN'

export type TemporalEvidenceKind =
  | 'ACTUAL'
  | 'DECLARED'
  | 'ESTIMATED'
  | 'UNKNOWN'

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'

export type RegulatoryDatum<T> =
  | {
      status: 'KNOWN'
      value: T
      source: TemporalDataSource
      observedAt: string
      confidence: ConfidenceLevel
    }
  | {
      status: 'UNKNOWN'
      source: 'UNKNOWN'
      reason: string
    }

export type DriverRegulatoryState = {
  driverId: string
  timeZone: string
  observedAt: string
  /**
   * Explicit end of the declaration's validity. Unlike the former implicit
   * freshness threshold, this value is entered and visible in the UI.
   */
  validUntil?: string | null
  drivingSinceValidBreakSeconds: RegulatoryDatum<number>
  dailyDrivingSeconds: RegulatoryDatum<number>
  weeklyDrivingSeconds: RegulatoryDatum<number>
  previousWeekDrivingSeconds: RegulatoryDatum<number>
  dailyExtensionsUsedThisWeek: RegulatoryDatum<number>
  reducedDailyRestsUsedSinceWeeklyRest: RegulatoryDatum<number>
  splitBreakFirstPartSeconds: RegulatoryDatum<number>
  splitDailyRestFirstPartSeconds: RegulatoryDatum<number>
  lastValidRestEndedAt: RegulatoryDatum<string>
  dutyPeriodStartedAt: RegulatoryDatum<string>
  currentIsoWeek: RegulatoryDatum<string>
  weeklyRestDueAt: RegulatoryDatum<string | null>
  weeklyRestCompensationDueSeconds: RegulatoryDatum<number>
}

export type TemporalLocation = {
  id: string
  label?: string
  latitude?: number
  longitude?: number
  positionSource?:
    | 'DRIVER_GPS'
    | 'LAST_COMPLETED_MISSION'
    | 'OPERATING_BASE'
    | 'UNKNOWN'
  observedAt?: string | null
  positionConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
  planningEffect?: 'DIRECT' | 'CONDITIONAL'
}

export type MissionTemporalStep = {
  id: string
  activityType: Exclude<TemporalActivityType, 'UNKNOWN'>
  durationSeconds: number
  source: TemporalDataSource
  evidence: TemporalEvidenceKind
  confidence: ConfidenceLevel
  from?: TemporalLocation | null
  to?: TemporalLocation | null
  notBefore?: string | null
  mustStartBy?: string | null
  mustEndBy?: string | null
  isTrailerChange?: boolean
  anomalies?: string[]
}

export type MissionTemporalPlan = {
  missionId: string
  reference?: string
  timeZone: string
  earliestStartAt: string | null
  startPosition: TemporalLocation | null
  endPosition: TemporalLocation | null
  steps: MissionTemporalStep[]
  missingData: MissingTemporalDataCode[]
  requiresReturnToBase?: boolean
}

export type PreparedPairReference = {
  rowId: string
  driverId: string
  truckId: string
  pairLocked: boolean
  assignmentOrigin: 'MANUAL' | 'AUTOMATIC' | 'ADJUSTED'
}

export type RegulatoryProfile = {
  id: string
  version: string
  legalBasis: string
  territory: string
  timeZone: string
  enabledDerogations: string[]
  maximumContinuousDrivingSeconds: number
  normalBreakSeconds: number
  splitBreakFirstPartMinimumSeconds: number
  splitBreakSecondPartMinimumSeconds: number
  normalDailyDrivingSeconds: number
  extendedDailyDrivingSeconds: number
  maximumDailyExtensionsPerWeek: number
  maximumWeeklyDrivingSeconds: number
  maximumFortnightDrivingSeconds: number
  normalDailyRestSeconds: number
  reducedDailyRestSeconds: number
  maximumReducedDailyRestsBetweenWeeklyRests: number
  splitDailyRestFirstPartMinimumSeconds: number
  splitDailyRestSecondPartMinimumSeconds: number
  normalWeeklyRestSeconds: number
  reducedWeeklyRestMinimumSeconds: number
  defaultLoadingSeconds: number
  defaultUnloadingSeconds: number
  defaultTrailerCouplingSeconds: number
  defaultTrailerUncouplingSeconds: number
}

export type MissingTemporalDataCode =
  | 'MISSING_DRIVER_STATE'
  | 'MISSING_TACHOGRAPH_HISTORY'
  | 'MISSING_ROUTE_DURATION'
  | 'MISSING_POSITION'
  | 'MISSING_MISSION_TIME'
  | 'MISSING_WEEKLY_REST_STATE'

export type RegulatoryDecisionCode =
  | 'FEASIBLE'
  | 'FEASIBLE_WITH_BREAK'
  | 'FEASIBLE_WITH_DAILY_EXTENSION'
  | 'FEASIBLE_AFTER_DAILY_REST'
  | 'REQUIRES_NEXT_DAY'
  | 'DRIVING_LIMIT_EXCEEDED'
  | 'WEEKLY_LIMIT_EXCEEDED'
  | 'FORTNIGHT_LIMIT_EXCEEDED'
  | 'INSUFFICIENT_DAILY_REST'
  | 'TOO_MANY_REDUCED_DAILY_RESTS'
  | 'MISSION_TIME_WINDOW_MISSED'
  | 'OVERLAPPING_ACTIVITY'
  | 'INCOHERENT_START_POSITION'
  | 'STALE_DRIVER_STATE'
  | 'MISSING_DRIVER_STATE'
  | 'MISSING_TACHOGRAPH_HISTORY'
  | 'MISSING_ROUTE_DURATION'
  | 'MISSING_POSITION'
  | 'MISSING_MISSION_TIME'
  | 'MISSING_WEEKLY_REST_STATE'
  | 'INVALID_SPLIT_BREAK'
  | 'INVALID_TIMELINE'

export type TimelineSegment = {
  id: string
  missionId: string
  stepId: string
  activityType: TemporalActivityType
  startedAt: string
  endedAt: string
  durationSeconds: number
  source: TemporalDataSource
  evidence: TemporalEvidenceKind
  confidence: ConfidenceLevel
  from?: TemporalLocation | null
  to?: TemporalLocation | null
  anomalies: RegulatoryDecisionCode[]
}

export type RegulatoryCounters = {
  drivingSinceValidBreakSeconds: number
  dailyDrivingSeconds: number
  weeklyDrivingSeconds: number
  previousWeekDrivingSeconds: number
  fortnightDrivingSeconds: number
  dailyExtensionsUsedThisWeek: number
  reducedDailyRestsUsedSinceWeeklyRest: number
  splitBreakFirstPartSeconds: number
  splitDailyRestFirstPartSeconds: number
  dutyPeriodStartedAt: string
  currentIsoWeek: string
  weeklyRestCompensationDueSeconds: number
}

export type MissionEvaluationStatus =
  | 'FEASIBLE'
  | 'IMPOSSIBLE'
  | 'INDETERMINATE'

export type MissionTemporalEvaluation = {
  missionId: string
  pair: PreparedPairReference
  status: MissionEvaluationStatus
  primaryDecision: RegulatoryDecisionCode
  decisions: RegulatoryDecisionCode[]
  messages: string[]
  timeline: TimelineSegment[]
  possibleStartAt: string | null
  arrivalAt: string | null
  completedAt: string | null
  nextAvailableAt: string | null
  consumedDrivingSeconds: number
  consumedOtherWorkSeconds: number
  insertedBreakSeconds: number
  insertedDailyRestSeconds: number
  insertedWeeklyRestSeconds: number
  usedDailyExtension: boolean
  missingData: MissingTemporalDataCode[]
  countersAfter: RegulatoryCounters | null
  stateAfter: DriverRegulatoryState | null
}

export type SequenceTemporalEvaluation = {
  status: MissionEvaluationStatus
  evaluations: MissionTemporalEvaluation[]
  finalState: DriverRegulatoryState | null
  decisions: RegulatoryDecisionCode[]
}

export type EvaluationOptions = {
  allowReducedDailyRest?: boolean
}
