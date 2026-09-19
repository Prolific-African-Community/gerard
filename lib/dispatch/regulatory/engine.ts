import {
  regulatoryDecisionMessages,
  euRoadFreightProfileV1,
} from './profile'
import {
  addSeconds,
  differenceInSeconds,
  findNextIsoWeekBoundary,
  getIsoWeekKey,
  getLocalDateKey,
  parseInstant,
} from './time'
import type {
  DriverRegulatoryState,
  EvaluationOptions,
  MissionTemporalEvaluation,
  MissionTemporalPlan,
  MissingTemporalDataCode,
  PreparedPairReference,
  RegulatoryCounters,
  RegulatoryDatum,
  RegulatoryDecisionCode,
  RegulatoryProfile,
  SequenceTemporalEvaluation,
  TimelineSegment,
} from './types'

type MutableState = {
  drivingSinceBreak: number
  dailyDriving: number
  weeklyDriving: number
  previousWeekDriving: number
  extensionsUsed: number
  reducedRestsUsed: number
  splitBreakFirstPart: number
  splitDailyRestFirstPart: number
  lastRestEndedAt: Date
  dutyStartedAt: Date
  currentIsoWeek: string
  weeklyRestDueAt: Date | null
  weeklyRestCompensation: number
}

type EvaluationAccumulator = {
  cursor: Date
  timeline: TimelineSegment[]
  decisions: RegulatoryDecisionCode[]
  drivingSeconds: number
  otherWorkSeconds: number
  insertedBreakSeconds: number
  insertedDailyRestSeconds: number
  insertedWeeklyRestSeconds: number
  usedDailyExtension: boolean
  arrivalAt: Date | null
  state: MutableState
}

const essentialStateFields: Array<keyof DriverRegulatoryState> = [
  'drivingSinceValidBreakSeconds',
  'dailyDrivingSeconds',
  'weeklyDrivingSeconds',
  'previousWeekDrivingSeconds',
  'dailyExtensionsUsedThisWeek',
  'reducedDailyRestsUsedSinceWeeklyRest',
  'splitBreakFirstPartSeconds',
  'splitDailyRestFirstPartSeconds',
  'lastValidRestEndedAt',
  'dutyPeriodStartedAt',
  'currentIsoWeek',
  'weeklyRestDueAt',
  'weeklyRestCompensationDueSeconds',
]

function knownValue<T>(datum: RegulatoryDatum<T>) {
  return datum.status === 'KNOWN' ? datum.value : null
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values))
}

function asMessage(codes: RegulatoryDecisionCode[]) {
  return unique(codes).map((code) => regulatoryDecisionMessages[code])
}

function addDecision(
  accumulator: EvaluationAccumulator,
  decision: RegulatoryDecisionCode
) {
  if (!accumulator.decisions.includes(decision)) {
    accumulator.decisions.push(decision)
  }
}

function addSegment(
  accumulator: EvaluationAccumulator,
  plan: MissionTemporalPlan,
  input: {
    stepId: string
    activityType: TimelineSegment['activityType']
    durationSeconds: number
    source: TimelineSegment['source']
    evidence: TimelineSegment['evidence']
    confidence: TimelineSegment['confidence']
    from?: TimelineSegment['from']
    to?: TimelineSegment['to']
    anomalies?: RegulatoryDecisionCode[]
  }
) {
  const startedAt = accumulator.cursor
  const endedAt = addSeconds(startedAt, input.durationSeconds)
  const segment: TimelineSegment = {
    id: `${plan.missionId}:${input.stepId}:${accumulator.timeline.length}`,
    missionId: plan.missionId,
    stepId: input.stepId,
    activityType: input.activityType,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: input.durationSeconds,
    source: input.source,
    evidence: input.evidence,
    confidence: input.confidence,
    from: input.from,
    to: input.to,
    anomalies: input.anomalies ?? [],
  }
  accumulator.timeline.push(segment)
  accumulator.cursor = endedAt
  return segment
}

function rollCalendarWeekIfNeeded(
  accumulator: EvaluationAccumulator,
  timeZone: string
) {
  const week = getIsoWeekKey(accumulator.cursor, timeZone)
  if (week === accumulator.state.currentIsoWeek) return

  accumulator.state.previousWeekDriving = accumulator.state.weeklyDriving
  accumulator.state.weeklyDriving = 0
  accumulator.state.extensionsUsed = 0
  accumulator.state.currentIsoWeek = week
}

function insertBreak(
  accumulator: EvaluationAccumulator,
  plan: MissionTemporalPlan,
  profile: RegulatoryProfile
) {
  addSegment(accumulator, plan, {
    stepId: 'AUTO_BREAK',
    activityType: 'BREAK',
    durationSeconds: profile.normalBreakSeconds,
    source: 'SIMULATION',
    evidence: 'ESTIMATED',
    confidence: 'HIGH',
  })
  accumulator.state.drivingSinceBreak = 0
  accumulator.state.splitBreakFirstPart = 0
  accumulator.insertedBreakSeconds += profile.normalBreakSeconds
  addDecision(accumulator, 'FEASIBLE_WITH_BREAK')
}

function insertDailyRest(
  accumulator: EvaluationAccumulator,
  plan: MissionTemporalPlan,
  profile: RegulatoryProfile,
  options: EvaluationOptions
) {
  const useReduced =
    options.allowReducedDailyRest === true &&
    accumulator.state.reducedRestsUsed <
      profile.maximumReducedDailyRestsBetweenWeeklyRests
  const duration = useReduced
    ? profile.reducedDailyRestSeconds
    : profile.normalDailyRestSeconds
  const previousDate = getLocalDateKey(accumulator.cursor, plan.timeZone)

  addSegment(accumulator, plan, {
    stepId: useReduced ? 'AUTO_REDUCED_DAILY_REST' : 'AUTO_DAILY_REST',
    activityType: 'DAILY_REST',
    durationSeconds: duration,
    source: 'SIMULATION',
    evidence: 'ESTIMATED',
    confidence: 'HIGH',
  })
  if (useReduced) accumulator.state.reducedRestsUsed += 1
  accumulator.state.drivingSinceBreak = 0
  accumulator.state.dailyDriving = 0
  accumulator.state.splitBreakFirstPart = 0
  accumulator.state.splitDailyRestFirstPart = 0
  accumulator.state.lastRestEndedAt = accumulator.cursor
  accumulator.state.dutyStartedAt = accumulator.cursor
  accumulator.insertedDailyRestSeconds += duration
  addDecision(accumulator, 'FEASIBLE_AFTER_DAILY_REST')
  if (getLocalDateKey(accumulator.cursor, plan.timeZone) !== previousDate) {
    addDecision(accumulator, 'REQUIRES_NEXT_DAY')
  }
  rollCalendarWeekIfNeeded(accumulator, plan.timeZone)
}

function insertWeeklyRest(
  accumulator: EvaluationAccumulator,
  plan: MissionTemporalPlan,
  profile: RegulatoryProfile
) {
  addSegment(accumulator, plan, {
    stepId: 'AUTO_WEEKLY_REST',
    activityType: 'WEEKLY_REST',
    durationSeconds: profile.normalWeeklyRestSeconds,
    source: 'SIMULATION',
    evidence: 'ESTIMATED',
    confidence: 'HIGH',
  })
  accumulator.state.drivingSinceBreak = 0
  accumulator.state.dailyDriving = 0
  accumulator.state.splitBreakFirstPart = 0
  accumulator.state.splitDailyRestFirstPart = 0
  accumulator.state.reducedRestsUsed = 0
  accumulator.state.weeklyRestCompensation = 0
  accumulator.state.lastRestEndedAt = accumulator.cursor
  accumulator.state.dutyStartedAt = accumulator.cursor
  accumulator.state.weeklyRestDueAt = addSeconds(
    accumulator.cursor,
    6 * 24 * 60 * 60
  )
  accumulator.insertedWeeklyRestSeconds += profile.normalWeeklyRestSeconds
  addDecision(accumulator, 'REQUIRES_NEXT_DAY')
  rollCalendarWeekIfNeeded(accumulator, plan.timeZone)
}

function maximumDutySeconds(
  accumulator: EvaluationAccumulator,
  profile: RegulatoryProfile,
  options: EvaluationOptions
) {
  const canUseReduced =
    options.allowReducedDailyRest === true &&
    accumulator.state.reducedRestsUsed <
      profile.maximumReducedDailyRestsBetweenWeeklyRests
  return (
    24 * 60 * 60 -
    (canUseReduced
      ? profile.reducedDailyRestSeconds
      : profile.normalDailyRestSeconds)
  )
}

function ensureRestDeadlines(
  accumulator: EvaluationAccumulator,
  plan: MissionTemporalPlan,
  profile: RegulatoryProfile,
  options: EvaluationOptions,
  upcomingDurationSeconds: number
) {
  if (
    accumulator.state.weeklyRestDueAt &&
    accumulator.cursor.getTime() >= accumulator.state.weeklyRestDueAt.getTime()
  ) {
    insertWeeklyRest(accumulator, plan, profile)
  }

  const dutyLimit = addSeconds(
    accumulator.state.dutyStartedAt,
    maximumDutySeconds(accumulator, profile, options)
  )
  if (
    addSeconds(accumulator.cursor, upcomingDurationSeconds).getTime() >
    dutyLimit.getTime()
  ) {
    insertDailyRest(accumulator, plan, profile, options)
  }
}

function applyExplicitBreak(
  accumulator: EvaluationAccumulator,
  durationSeconds: number,
  profile: RegulatoryProfile
) {
  if (durationSeconds >= profile.normalBreakSeconds) {
    accumulator.state.drivingSinceBreak = 0
    accumulator.state.splitBreakFirstPart = 0
    return
  }

  if (
    accumulator.state.splitBreakFirstPart >=
      profile.splitBreakFirstPartMinimumSeconds &&
    durationSeconds >= profile.splitBreakSecondPartMinimumSeconds
  ) {
    accumulator.state.drivingSinceBreak = 0
    accumulator.state.splitBreakFirstPart = 0
    return
  }

  if (
    accumulator.state.splitBreakFirstPart === 0 &&
    durationSeconds >= profile.splitBreakFirstPartMinimumSeconds
  ) {
    accumulator.state.splitBreakFirstPart = durationSeconds
    return
  }

  addDecision(accumulator, 'INVALID_SPLIT_BREAK')
}

function applyExplicitRest(
  accumulator: EvaluationAccumulator,
  activityType: 'DAILY_REST' | 'WEEKLY_REST',
  durationSeconds: number,
  profile: RegulatoryProfile
) {
  if (activityType === 'WEEKLY_REST') {
    if (durationSeconds < profile.reducedWeeklyRestMinimumSeconds) {
      return 'INSUFFICIENT_DAILY_REST' as const
    }
    if (durationSeconds < profile.normalWeeklyRestSeconds) {
      accumulator.state.weeklyRestCompensation +=
        profile.normalWeeklyRestSeconds - durationSeconds
    } else {
      accumulator.state.weeklyRestCompensation = 0
    }
    accumulator.state.reducedRestsUsed = 0
    accumulator.state.weeklyRestDueAt = addSeconds(
      accumulator.cursor,
      6 * 24 * 60 * 60
    )
  } else {
    const completesSplitDailyRest =
      accumulator.state.splitDailyRestFirstPart >=
        profile.splitDailyRestFirstPartMinimumSeconds &&
      durationSeconds >= profile.splitDailyRestSecondPartMinimumSeconds

    if (
      !completesSplitDailyRest &&
      durationSeconds >= profile.splitDailyRestFirstPartMinimumSeconds &&
      durationSeconds < profile.reducedDailyRestSeconds
    ) {
      accumulator.state.splitDailyRestFirstPart = durationSeconds
      return null
    }

    if (durationSeconds < profile.reducedDailyRestSeconds) {
      return 'INSUFFICIENT_DAILY_REST' as const
    }

    if (
      durationSeconds < profile.normalDailyRestSeconds &&
      !completesSplitDailyRest
    ) {
      if (
        accumulator.state.reducedRestsUsed >=
        profile.maximumReducedDailyRestsBetweenWeeklyRests
      ) {
        return 'TOO_MANY_REDUCED_DAILY_RESTS' as const
      }
      accumulator.state.reducedRestsUsed += 1
    }
  }

  accumulator.state.drivingSinceBreak = 0
  accumulator.state.dailyDriving = 0
  accumulator.state.splitBreakFirstPart = 0
  accumulator.state.splitDailyRestFirstPart = 0
  accumulator.state.lastRestEndedAt = accumulator.cursor
  accumulator.state.dutyStartedAt = accumulator.cursor
  return null
}

function getMissingStateData(state: DriverRegulatoryState) {
  const missingFields = essentialStateFields.filter((field) => {
    if (field === 'driverId' || field === 'timeZone' || field === 'observedAt') {
      return false
    }
    return (state[field] as RegulatoryDatum<unknown>).status !== 'KNOWN'
  })
  const missingData: MissingTemporalDataCode[] = []
  if (missingFields.length) {
    missingData.push('MISSING_DRIVER_STATE', 'MISSING_TACHOGRAPH_HISTORY')
  }
  if (
    missingFields.includes('weeklyRestDueAt') ||
    missingFields.includes('weeklyRestCompensationDueSeconds')
  ) {
    missingData.push('MISSING_WEEKLY_REST_STATE')
  }
  return unique(missingData)
}

function createIndeterminateResult(
  plan: MissionTemporalPlan,
  pair: PreparedPairReference,
  missingData: MissingTemporalDataCode[],
  primaryDecision: RegulatoryDecisionCode
): MissionTemporalEvaluation {
  const decisions = unique([
    primaryDecision,
    ...(missingData as RegulatoryDecisionCode[]),
  ])
  return {
    missionId: plan.missionId,
    pair,
    status: 'INDETERMINATE',
    primaryDecision,
    decisions,
    messages: asMessage(decisions),
    timeline: [],
    possibleStartAt: null,
    arrivalAt: null,
    completedAt: null,
    nextAvailableAt: null,
    consumedDrivingSeconds: 0,
    consumedOtherWorkSeconds: 0,
    insertedBreakSeconds: 0,
    insertedDailyRestSeconds: 0,
    insertedWeeklyRestSeconds: 0,
    usedDailyExtension: false,
    missingData,
    countersAfter: null,
    stateAfter: null,
  }
}

function createImpossibleResult(
  plan: MissionTemporalPlan,
  pair: PreparedPairReference,
  accumulator: EvaluationAccumulator,
  primaryDecision: RegulatoryDecisionCode
): MissionTemporalEvaluation {
  const decisions = unique([primaryDecision, ...accumulator.decisions])
  return {
    missionId: plan.missionId,
    pair,
    status: 'IMPOSSIBLE',
    primaryDecision,
    decisions,
    messages: asMessage(decisions),
    timeline: accumulator.timeline,
    possibleStartAt: accumulator.timeline[0]?.startedAt ?? null,
    arrivalAt: accumulator.arrivalAt?.toISOString() ?? null,
    completedAt: null,
    nextAvailableAt: null,
    consumedDrivingSeconds: accumulator.drivingSeconds,
    consumedOtherWorkSeconds: accumulator.otherWorkSeconds,
    insertedBreakSeconds: accumulator.insertedBreakSeconds,
    insertedDailyRestSeconds: accumulator.insertedDailyRestSeconds,
    insertedWeeklyRestSeconds: accumulator.insertedWeeklyRestSeconds,
    usedDailyExtension: accumulator.usedDailyExtension,
    missingData: [],
    countersAfter: null,
    stateAfter: null,
  }
}

function mutableStateFromInput(state: DriverRegulatoryState): MutableState | null {
  const lastRestEndedAt = parseInstant(
    knownValue(state.lastValidRestEndedAt) ?? ''
  )
  const dutyStartedAt = parseInstant(
    knownValue(state.dutyPeriodStartedAt) ?? ''
  )
  const weeklyRestDueValue = knownValue(state.weeklyRestDueAt)
  const weeklyRestDueAt = weeklyRestDueValue
    ? parseInstant(weeklyRestDueValue)
    : null
  if (!lastRestEndedAt || !dutyStartedAt) return null

  return {
    drivingSinceBreak:
      knownValue(state.drivingSinceValidBreakSeconds) ?? 0,
    dailyDriving: knownValue(state.dailyDrivingSeconds) ?? 0,
    weeklyDriving: knownValue(state.weeklyDrivingSeconds) ?? 0,
    previousWeekDriving: knownValue(state.previousWeekDrivingSeconds) ?? 0,
    extensionsUsed:
      knownValue(state.dailyExtensionsUsedThisWeek) ?? 0,
    reducedRestsUsed:
      knownValue(state.reducedDailyRestsUsedSinceWeeklyRest) ?? 0,
    splitBreakFirstPart:
      knownValue(state.splitBreakFirstPartSeconds) ?? 0,
    splitDailyRestFirstPart:
      knownValue(state.splitDailyRestFirstPartSeconds) ?? 0,
    lastRestEndedAt,
    dutyStartedAt,
    currentIsoWeek: knownValue(state.currentIsoWeek) ?? '',
    weeklyRestDueAt,
    weeklyRestCompensation:
      knownValue(state.weeklyRestCompensationDueSeconds) ?? 0,
  }
}

function knownSimulationDatum<T>(value: T, observedAt: string) {
  return {
    status: 'KNOWN' as const,
    value,
    source: 'SIMULATION' as const,
    observedAt,
    confidence: 'HIGH' as const,
  }
}

function buildStateAfter(
  initialState: DriverRegulatoryState,
  accumulator: EvaluationAccumulator
) {
  const observedAt = accumulator.cursor.toISOString()
  return {
    driverId: initialState.driverId,
    timeZone: initialState.timeZone,
    observedAt,
    drivingSinceValidBreakSeconds: knownSimulationDatum(
      accumulator.state.drivingSinceBreak,
      observedAt
    ),
    dailyDrivingSeconds: knownSimulationDatum(
      accumulator.state.dailyDriving,
      observedAt
    ),
    weeklyDrivingSeconds: knownSimulationDatum(
      accumulator.state.weeklyDriving,
      observedAt
    ),
    previousWeekDrivingSeconds: knownSimulationDatum(
      accumulator.state.previousWeekDriving,
      observedAt
    ),
    dailyExtensionsUsedThisWeek: knownSimulationDatum(
      accumulator.state.extensionsUsed,
      observedAt
    ),
    reducedDailyRestsUsedSinceWeeklyRest: knownSimulationDatum(
      accumulator.state.reducedRestsUsed,
      observedAt
    ),
    splitBreakFirstPartSeconds: knownSimulationDatum(
      accumulator.state.splitBreakFirstPart,
      observedAt
    ),
    splitDailyRestFirstPartSeconds: knownSimulationDatum(
      accumulator.state.splitDailyRestFirstPart,
      observedAt
    ),
    lastValidRestEndedAt: knownSimulationDatum(
      accumulator.state.lastRestEndedAt.toISOString(),
      observedAt
    ),
    dutyPeriodStartedAt: knownSimulationDatum(
      accumulator.state.dutyStartedAt.toISOString(),
      observedAt
    ),
    currentIsoWeek: knownSimulationDatum(
      accumulator.state.currentIsoWeek,
      observedAt
    ),
    weeklyRestDueAt: knownSimulationDatum(
      accumulator.state.weeklyRestDueAt?.toISOString() ?? null,
      observedAt
    ),
    weeklyRestCompensationDueSeconds: knownSimulationDatum(
      accumulator.state.weeklyRestCompensation,
      observedAt
    ),
  } as DriverRegulatoryState
}

function getCounters(accumulator: EvaluationAccumulator): RegulatoryCounters {
  return {
    drivingSinceValidBreakSeconds: accumulator.state.drivingSinceBreak,
    dailyDrivingSeconds: accumulator.state.dailyDriving,
    weeklyDrivingSeconds: accumulator.state.weeklyDriving,
    previousWeekDrivingSeconds: accumulator.state.previousWeekDriving,
    fortnightDrivingSeconds:
      accumulator.state.previousWeekDriving + accumulator.state.weeklyDriving,
    dailyExtensionsUsedThisWeek: accumulator.state.extensionsUsed,
    reducedDailyRestsUsedSinceWeeklyRest:
      accumulator.state.reducedRestsUsed,
    splitBreakFirstPartSeconds: accumulator.state.splitBreakFirstPart,
    splitDailyRestFirstPartSeconds:
      accumulator.state.splitDailyRestFirstPart,
    dutyPeriodStartedAt: accumulator.state.dutyStartedAt.toISOString(),
    currentIsoWeek: accumulator.state.currentIsoWeek,
    weeklyRestCompensationDueSeconds:
      accumulator.state.weeklyRestCompensation,
  }
}

function processDrivingStep(
  accumulator: EvaluationAccumulator,
  plan: MissionTemporalPlan,
  step: MissionTemporalPlan['steps'][number],
  profile: RegulatoryProfile,
  options: EvaluationOptions
): RegulatoryDecisionCode | null {
  let remaining = step.durationSeconds
  let isFirstChunk = true

  while (remaining > 0) {
    rollCalendarWeekIfNeeded(accumulator, plan.timeZone)
    ensureRestDeadlines(accumulator, plan, profile, options, 0)

    if (
      accumulator.state.drivingSinceBreak >=
      profile.maximumContinuousDrivingSeconds
    ) {
      insertBreak(accumulator, plan, profile)
      continue
    }

    let dailyLimit = profile.normalDailyDrivingSeconds
    if (accumulator.state.dailyDriving >= profile.normalDailyDrivingSeconds) {
      if (
        accumulator.state.extensionsUsed <
          profile.maximumDailyExtensionsPerWeek &&
        accumulator.state.dailyDriving < profile.extendedDailyDrivingSeconds
      ) {
        accumulator.state.extensionsUsed += 1
        accumulator.usedDailyExtension = true
        dailyLimit = profile.extendedDailyDrivingSeconds
        addDecision(accumulator, 'FEASIBLE_WITH_DAILY_EXTENSION')
      } else {
        insertDailyRest(accumulator, plan, profile, options)
        continue
      }
    }

    const weeklyCapacity =
      profile.maximumWeeklyDrivingSeconds - accumulator.state.weeklyDriving
    if (weeklyCapacity <= 0) return 'WEEKLY_LIMIT_EXCEEDED'
    const fortnightCapacity =
      profile.maximumFortnightDrivingSeconds -
      (accumulator.state.previousWeekDriving +
        accumulator.state.weeklyDriving)
    if (fortnightCapacity <= 0) return 'FORTNIGHT_LIMIT_EXCEEDED'

    const breakCapacity =
      profile.maximumContinuousDrivingSeconds -
      accumulator.state.drivingSinceBreak
    const dailyCapacity = dailyLimit - accumulator.state.dailyDriving
    const dutyLimit = addSeconds(
      accumulator.state.dutyStartedAt,
      maximumDutySeconds(accumulator, profile, options)
    )
    const dutyCapacity = Math.max(
      0,
      differenceInSeconds(accumulator.cursor, dutyLimit)
    )
    if (dutyCapacity <= 0) {
      insertDailyRest(accumulator, plan, profile, options)
      continue
    }

    const provisionalEnd = addSeconds(accumulator.cursor, remaining)
    const weekBoundary = findNextIsoWeekBoundary(
      accumulator.cursor,
      provisionalEnd,
      plan.timeZone
    )
    const weekBoundaryCapacity = weekBoundary
      ? Math.max(1, differenceInSeconds(accumulator.cursor, weekBoundary))
      : Number.POSITIVE_INFINITY
    const chunk = Math.min(
      remaining,
      breakCapacity,
      dailyCapacity,
      weeklyCapacity,
      fortnightCapacity,
      dutyCapacity,
      weekBoundaryCapacity
    )
    if (chunk <= 0) return 'DRIVING_LIMIT_EXCEEDED'

    const segment = addSegment(accumulator, plan, {
      stepId: step.id,
      activityType: 'DRIVING',
      durationSeconds: chunk,
      source: step.source,
      evidence: step.evidence,
      confidence: step.confidence,
      from: isFirstChunk ? step.from : undefined,
      to: chunk === remaining ? step.to : undefined,
      anomalies: (step.anomalies ?? []) as RegulatoryDecisionCode[],
    })
    accumulator.state.drivingSinceBreak += chunk
    accumulator.state.dailyDriving += chunk
    accumulator.state.weeklyDriving += chunk
    accumulator.drivingSeconds += chunk
    remaining -= chunk
    isFirstChunk = false

    if (
      step.to &&
      plan.endPosition &&
      step.to.id === plan.endPosition.id
    ) {
      accumulator.arrivalAt = parseInstant(segment.endedAt)
    }
  }
  return null
}

export function evaluateTemporalMission(input: {
  pair: PreparedPairReference
  plan: MissionTemporalPlan
  initialState: DriverRegulatoryState
  simulationStartAt: string
  profile?: RegulatoryProfile
  options?: EvaluationOptions
}): MissionTemporalEvaluation {
  const profile = input.profile ?? euRoadFreightProfileV1
  const options = input.options ?? {}
  const start = parseInstant(input.simulationStartAt)
  const earliest = input.plan.earliestStartAt
    ? parseInstant(input.plan.earliestStartAt)
    : null
  const missingState = getMissingStateData(input.initialState)
  const missingData = unique([
    ...missingState,
    ...input.plan.missingData.filter(
      (item) => item !== 'MISSING_MISSION_TIME' || !input.plan.earliestStartAt
    ),
    ...(!input.plan.startPosition || !input.plan.endPosition
      ? (['MISSING_POSITION'] as MissingTemporalDataCode[])
      : []),
    ...(!input.plan.earliestStartAt
      ? (['MISSING_MISSION_TIME'] as MissingTemporalDataCode[])
      : []),
  ])

  if (input.initialState.driverId !== input.pair.driverId) {
    missingData.push('MISSING_DRIVER_STATE')
  }
  if (missingData.length) {
    const primary = missingData.includes('MISSING_TACHOGRAPH_HISTORY')
      ? 'MISSING_TACHOGRAPH_HISTORY'
      : (missingData[0] as RegulatoryDecisionCode)
    return createIndeterminateResult(
      input.plan,
      input.pair,
      unique(missingData),
      primary
    )
  }
  if (!start || !earliest) {
    return createIndeterminateResult(
      input.plan,
      input.pair,
      ['MISSING_MISSION_TIME'],
      'MISSING_MISSION_TIME'
    )
  }
  const observedAt = parseInstant(input.initialState.observedAt)
  const validUntil = input.initialState.validUntil
    ? parseInstant(input.initialState.validUntil)
    : null
  if (!observedAt || (validUntil && start > validUntil)) {
    return createIndeterminateResult(
      input.plan,
      input.pair,
      [],
      'STALE_DRIVER_STATE'
    )
  }
  const mutableState = mutableStateFromInput(input.initialState)
  if (!mutableState) {
    return createIndeterminateResult(
      input.plan,
      input.pair,
      ['MISSING_DRIVER_STATE'],
      'MISSING_DRIVER_STATE'
    )
  }

  const cursor = new Date(Math.max(start.getTime(), earliest.getTime()))
  const accumulator: EvaluationAccumulator = {
    cursor,
    timeline: [],
    decisions: [],
    drivingSeconds: 0,
    otherWorkSeconds: 0,
    insertedBreakSeconds: 0,
    insertedDailyRestSeconds: 0,
    insertedWeeklyRestSeconds: 0,
    usedDailyExtension: false,
    arrivalAt: null,
    state: mutableState,
  }
  rollCalendarWeekIfNeeded(accumulator, input.plan.timeZone)

  for (const step of input.plan.steps) {
    if (
      !Number.isFinite(step.durationSeconds) ||
      step.durationSeconds < 0
    ) {
      return createImpossibleResult(
        input.plan,
        input.pair,
        accumulator,
        'INVALID_TIMELINE'
      )
    }
    const notBefore = step.notBefore ? parseInstant(step.notBefore) : null
    if (notBefore && accumulator.cursor.getTime() < notBefore.getTime()) {
      addSegment(accumulator, input.plan, {
        stepId: `${step.id}:WAIT`,
        activityType: 'AVAILABILITY',
        durationSeconds: differenceInSeconds(accumulator.cursor, notBefore),
        source: 'MISSION',
        evidence: 'DECLARED',
        confidence: 'HIGH',
      })
    }
    const mustStartBy = step.mustStartBy
      ? parseInstant(step.mustStartBy)
      : null
    if (mustStartBy && accumulator.cursor.getTime() > mustStartBy.getTime()) {
      return createImpossibleResult(
        input.plan,
        input.pair,
        accumulator,
        'MISSION_TIME_WINDOW_MISSED'
      )
    }

    if (step.activityType === 'DRIVING') {
      const failure = processDrivingStep(
        accumulator,
        input.plan,
        step,
        profile,
        options
      )
      if (failure) {
        return createImpossibleResult(
          input.plan,
          input.pair,
          accumulator,
          failure
        )
      }
    } else {
      if (
        step.activityType === 'OTHER_WORK' ||
        step.activityType === 'AVAILABILITY'
      ) {
        ensureRestDeadlines(
          accumulator,
          input.plan,
          profile,
          options,
          step.durationSeconds
        )
      }
      const segment = addSegment(accumulator, input.plan, {
        stepId: step.id,
        activityType: step.activityType,
        durationSeconds: step.durationSeconds,
        source: step.source,
        evidence: step.evidence,
        confidence: step.confidence,
        from: step.from,
        to: step.to,
        anomalies: (step.anomalies ?? []) as RegulatoryDecisionCode[],
      })
      if (step.activityType === 'OTHER_WORK') {
        accumulator.otherWorkSeconds += step.durationSeconds
      } else if (step.activityType === 'BREAK') {
        applyExplicitBreak(accumulator, step.durationSeconds, profile)
      } else if (
        step.activityType === 'DAILY_REST' ||
        step.activityType === 'WEEKLY_REST'
      ) {
        const failure = applyExplicitRest(
          accumulator,
          step.activityType,
          step.durationSeconds,
          profile
        )
        if (failure) {
          return createImpossibleResult(
            input.plan,
            input.pair,
            accumulator,
            failure
          )
        }
      }
      if (
        step.to &&
        input.plan.endPosition &&
        step.to.id === input.plan.endPosition.id
      ) {
        accumulator.arrivalAt = parseInstant(segment.endedAt)
      }
    }

    const mustEndBy = step.mustEndBy ? parseInstant(step.mustEndBy) : null
    if (mustEndBy && accumulator.cursor.getTime() > mustEndBy.getTime()) {
      return createImpossibleResult(
        input.plan,
        input.pair,
        accumulator,
        'MISSION_TIME_WINDOW_MISSED'
      )
    }
    rollCalendarWeekIfNeeded(accumulator, input.plan.timeZone)
  }

  if (!accumulator.decisions.length) addDecision(accumulator, 'FEASIBLE')
  const primaryDecision = accumulator.decisions.includes('REQUIRES_NEXT_DAY')
    ? 'REQUIRES_NEXT_DAY'
    : accumulator.decisions.includes('FEASIBLE_AFTER_DAILY_REST')
    ? 'FEASIBLE_AFTER_DAILY_REST'
    : accumulator.decisions.includes('FEASIBLE_WITH_DAILY_EXTENSION')
    ? 'FEASIBLE_WITH_DAILY_EXTENSION'
    : accumulator.decisions.includes('FEASIBLE_WITH_BREAK')
    ? 'FEASIBLE_WITH_BREAK'
    : 'FEASIBLE'
  const stateAfter = buildStateAfter(input.initialState, accumulator)

  return {
    missionId: input.plan.missionId,
    pair: input.pair,
    status: 'FEASIBLE',
    primaryDecision,
    decisions: unique(accumulator.decisions),
    messages: asMessage(accumulator.decisions),
    timeline: accumulator.timeline,
    possibleStartAt: accumulator.timeline[0]?.startedAt ?? cursor.toISOString(),
    arrivalAt: accumulator.arrivalAt?.toISOString() ?? null,
    completedAt: accumulator.cursor.toISOString(),
    nextAvailableAt: accumulator.cursor.toISOString(),
    consumedDrivingSeconds: accumulator.drivingSeconds,
    consumedOtherWorkSeconds: accumulator.otherWorkSeconds,
    insertedBreakSeconds: accumulator.insertedBreakSeconds,
    insertedDailyRestSeconds: accumulator.insertedDailyRestSeconds,
    insertedWeeklyRestSeconds: accumulator.insertedWeeklyRestSeconds,
    usedDailyExtension: accumulator.usedDailyExtension,
    missingData: [],
    countersAfter: getCounters(accumulator),
    stateAfter,
  }
}

export function evaluateTemporalMissionSequence(input: {
  pair: PreparedPairReference
  plans: MissionTemporalPlan[]
  initialState: DriverRegulatoryState
  simulationStartAt: string
  initialPosition: { id: string } | null
  profile?: RegulatoryProfile
  options?: EvaluationOptions
}): SequenceTemporalEvaluation {
  const evaluations: MissionTemporalEvaluation[] = []
  let state: DriverRegulatoryState | null = input.initialState
  let cursor = input.simulationStartAt
  let position = input.initialPosition

  for (const plan of input.plans) {
    if (
      position &&
      plan.startPosition &&
      position.id !== plan.startPosition.id
    ) {
      const evaluation = createIndeterminateResult(
        plan,
        input.pair,
        ['MISSING_POSITION'],
        'INCOHERENT_START_POSITION'
      )
      evaluations.push(evaluation)
      return {
        status: 'INDETERMINATE',
        evaluations,
        finalState: null,
        decisions: unique(
          evaluations.flatMap((item) => item.decisions)
        ),
      }
    }
    if (!state) break

    const earliest = plan.earliestStartAt
      ? parseInstant(plan.earliestStartAt)
      : null
    const current = parseInstant(cursor)
    const firstDeadline = plan.steps[0]?.mustStartBy
      ? parseInstant(plan.steps[0].mustStartBy as string)
      : null
    if (
      earliest &&
      current &&
      earliest.getTime() < current.getTime() &&
      firstDeadline &&
      firstDeadline.getTime() < current.getTime()
    ) {
      const evaluation = evaluateTemporalMission({
        pair: input.pair,
        plan,
        initialState: state,
        simulationStartAt: cursor,
        profile: input.profile,
        options: input.options,
      })
      evaluation.status = 'IMPOSSIBLE'
      evaluation.primaryDecision = 'OVERLAPPING_ACTIVITY'
      evaluation.decisions = unique([
        'OVERLAPPING_ACTIVITY',
        ...evaluation.decisions,
      ])
      evaluation.messages = asMessage(evaluation.decisions)
      evaluations.push(evaluation)
      return {
        status: 'IMPOSSIBLE',
        evaluations,
        finalState: null,
        decisions: unique(
          evaluations.flatMap((item) => item.decisions)
        ),
      }
    }

    const evaluation = evaluateTemporalMission({
      pair: input.pair,
      plan,
      initialState: state,
      simulationStartAt: cursor,
      profile: input.profile,
      options: input.options,
    })
    evaluations.push(evaluation)
    if (evaluation.status !== 'FEASIBLE' || !evaluation.stateAfter) {
      return {
        status: evaluation.status,
        evaluations,
        finalState: null,
        decisions: unique(
          evaluations.flatMap((item) => item.decisions)
        ),
      }
    }
    state = evaluation.stateAfter
    cursor = evaluation.nextAvailableAt as string
    position = plan.endPosition
  }

  return {
    status: 'FEASIBLE',
    evaluations,
    finalState: state,
    decisions: unique(evaluations.flatMap((item) => item.decisions)),
  }
}
