import type {
  DriverActivitySource,
  DriverActivityType,
} from '@prisma/client'

import { euRoadFreightProfileV1 } from './profile'
import { getIsoWeekKey, getLocalDateKey } from './time'

export type ActivityReliability =
  | 'UP_TO_DATE'
  | 'TO_CONFIRM'
  | 'INCOMPLETE'
  | 'STALE'

export type ActivityEventInput = {
  id: string
  type: DriverActivityType
  effectiveAt: Date
  recordedAt: Date
  source: DriverActivitySource
  note?: string | null
  missionId?: string | null
  correctedEventId?: string | null
  isVoided?: boolean
}

export type PlannedMissionInput = {
  id: string
  reference: string
  startsAt: Date
  endsAt: Date | null
  plannedDrivingSeconds: number | null
}

export type ActivitySegmentKind =
  | 'DRIVING'
  | 'OTHER_WORK'
  | 'BREAK'
  | 'DAILY_REST'
  | 'WEEKLY_REST'
  | 'UNAVAILABLE'
  | 'AVAILABLE'

export type ActivitySegment = {
  eventId: string
  kind: ActivitySegmentKind
  startsAt: string
  endsAt: string
  durationSeconds: number
  source: 'OBSERVED'
  missionId: string | null
}

export type RegulatoryActivitySummary = {
  updatedAt: string | null
  reliability: ActivityReliability
  reliabilityReasons: string[]
  currentStatus: DriverActivityType | null
  openActivity: boolean
  weeklyDrivingSeconds: number | null
  weeklyDrivingRemainingSeconds: number | null
  dailyDrivingSeconds: number | null
  dailyDrivingRemainingSeconds: number | null
  drivingSinceValidBreakSeconds: number | null
  nextAvailabilityAt: string | null
  nextRestDueAt: string | null
  warning: string | null
  observedSegments: ActivitySegment[]
  plannedMissions: Array<
    PlannedMissionInput & {
      associatedEventIds: string[]
      status: 'MATCHED' | 'UNCONFIRMED'
    }
  >
  anomalies: string[]
}

type Baseline = {
  referenceAt: Date
  validUntil?: Date | null
  weeklyDrivingSeconds: number
  dailyDrivingSeconds: number
  drivingSinceValidBreakSeconds: number
}

const activityKind: Record<DriverActivityType, ActivitySegmentKind> = {
  DRIVE_START: 'DRIVING',
  DRIVE_END: 'AVAILABLE',
  OTHER_WORK: 'OTHER_WORK',
  BREAK: 'BREAK',
  SPLIT_BREAK: 'BREAK',
  DAILY_REST: 'DAILY_REST',
  WEEKLY_REST: 'WEEKLY_REST',
  UNAVAILABLE: 'UNAVAILABLE',
  AVAILABLE: 'AVAILABLE',
}

const regulatoryTimeZone = 'Europe/Luxembourg'

function findPeriodStart(
  value: Date,
  keyFor: (date: Date) => string,
  maximumLookbackMs: number
) {
  const targetKey = keyFor(value)
  let outside = value.getTime() - maximumLookbackMs
  while (keyFor(new Date(outside)) === targetKey) {
    outside -= maximumLookbackMs
  }
  let inside = value.getTime()
  while (inside - outside > 1) {
    const middle = Math.floor((outside + inside) / 2)
    if (keyFor(new Date(middle)) === targetKey) {
      inside = middle
    } else {
      outside = middle
    }
  }
  return new Date(inside)
}

function startOfLocalDay(
  value: Date,
  timeZone = regulatoryTimeZone
) {
  return findPeriodStart(
    value,
    (date) => getLocalDateKey(date, timeZone),
    2 * 24 * 60 * 60 * 1000
  )
}

export function startOfIsoWeek(
  value: Date,
  timeZone = regulatoryTimeZone
) {
  return findPeriodStart(
    value,
    (date) => getIsoWeekKey(date, timeZone),
    8 * 24 * 60 * 60 * 1000
  )
}

export function regulatoryHistoryStart(
  value: Date,
  timeZone = regulatoryTimeZone
) {
  return new Date(
    startOfIsoWeek(value, timeZone).getTime() - 14 * 24 * 60 * 60 * 1000
  )
}

function overlapSeconds(
  startsAt: Date,
  endsAt: Date,
  rangeStart: Date,
  rangeEnd: Date
) {
  return Math.max(
    0,
    Math.floor(
      (Math.min(endsAt.getTime(), rangeEnd.getTime()) -
        Math.max(startsAt.getTime(), rangeStart.getTime())) /
        1000
    )
  )
}

function activeEvents(events: readonly ActivityEventInput[]) {
  const correctedIds = new Set(
    events
      .map((event) => event.correctedEventId)
      .filter((id): id is string => Boolean(id))
  )
  return events
    .filter((event) => !event.isVoided && !correctedIds.has(event.id))
    .slice()
    .sort(
      (left, right) =>
        left.effectiveAt.getTime() - right.effectiveAt.getTime() ||
        left.recordedAt.getTime() - right.recordedAt.getTime() ||
        left.id.localeCompare(right.id)
    )
}

/**
 * Deterministic calculation from immutable transitions.
 *
 * Only closed intervals are counted. Missions enrich/reconcile the timeline,
 * but never become observed driving time and therefore cannot manufacture a
 * regulatory balance.
 */
export function calculateDriverActivityState(input: {
  events: readonly ActivityEventInput[]
  missions?: readonly PlannedMissionInput[]
  at: Date
  baseline?: Baseline | null
}): RegulatoryActivitySummary {
  const events = activeEvents(
    input.events.filter((event) => event.effectiveAt <= input.at)
  )
  const missions = input.missions ?? []
  const anomalies: string[] = []
  const reasons: string[] = []
  const segments: ActivitySegment[] = []

  for (let index = 0; index < events.length - 1; index += 1) {
    const current = events[index]
    const next = events[index + 1]
    const durationSeconds = Math.floor(
      (next.effectiveAt.getTime() - current.effectiveAt.getTime()) / 1000
    )
    if (durationSeconds <= 0) {
      anomalies.push(
        `Événements simultanés ou inversés à ${current.effectiveAt.toISOString()}.`
      )
      continue
    }
    segments.push({
      eventId: current.id,
      kind: activityKind[current.type],
      startsAt: current.effectiveAt.toISOString(),
      endsAt: next.effectiveAt.toISOString(),
      durationSeconds,
      source: 'OBSERVED',
      missionId: current.missionId ?? null,
    })
  }

  const lastEvent = events.at(-1) ?? null
  const openActivity = Boolean(
    lastEvent &&
      lastEvent.effectiveAt <= input.at &&
      lastEvent.type !== 'AVAILABLE' &&
      lastEvent.type !== 'DRIVE_END'
  )
  if (openActivity) {
    reasons.push(
      `L’activité « ${lastEvent?.type ?? ''} » est ouverte ; aucune durée de fin n’a été inventée.`
    )
  }

  const weekStart = startOfIsoWeek(input.at)
  const dayStart = startOfLocalDay(input.at)
  const rangeEnd = input.at
  const relevantSegments = input.baseline
    ? segments.filter(
        (segment) =>
          new Date(segment.endsAt).getTime() >
          input.baseline!.referenceAt.getTime()
      )
    : segments
  const drivingSegments = relevantSegments.filter(
    (segment) => segment.kind === 'DRIVING'
  )

  const baselineUsable = Boolean(
    input.baseline && input.baseline.referenceAt <= input.at
  )
  const baselineWeek =
    baselineUsable &&
    startOfIsoWeek(input.baseline!.referenceAt).getTime() ===
      weekStart.getTime()
      ? input.baseline!.weeklyDrivingSeconds
      : 0
  const baselineDay =
    baselineUsable &&
    startOfLocalDay(input.baseline!.referenceAt).getTime() ===
      dayStart.getTime()
      ? input.baseline!.dailyDrivingSeconds
      : 0

  const weeklyObserved = drivingSegments.reduce(
    (total, segment) =>
      total +
      overlapSeconds(
        new Date(segment.startsAt),
        new Date(segment.endsAt),
        weekStart,
        rangeEnd
      ),
    0
  )
  const dailyObserved = drivingSegments.reduce(
    (total, segment) =>
      total +
      overlapSeconds(
        new Date(segment.startsAt),
        new Date(segment.endsAt),
        dayStart,
        rangeEnd
      ),
    0
  )

  let continuousDriving = baselineUsable
    ? input.baseline!.drivingSinceValidBreakSeconds
    : 0
  let splitBreakFirstPart = 0
  for (const segment of relevantSegments) {
    if (segment.kind === 'DRIVING') {
      continuousDriving += segment.durationSeconds
      continue
    }
    if (segment.kind === 'BREAK') {
      if (
        segment.durationSeconds >=
        euRoadFreightProfileV1.normalBreakSeconds
      ) {
        continuousDriving = 0
        splitBreakFirstPart = 0
      } else if (
        splitBreakFirstPart >=
          euRoadFreightProfileV1.splitBreakFirstPartMinimumSeconds &&
        segment.durationSeconds >=
          euRoadFreightProfileV1.splitBreakSecondPartMinimumSeconds
      ) {
        continuousDriving = 0
        splitBreakFirstPart = 0
      } else if (
        segment.durationSeconds >=
        euRoadFreightProfileV1.splitBreakFirstPartMinimumSeconds
      ) {
        splitBreakFirstPart = Math.max(
          splitBreakFirstPart,
          segment.durationSeconds
        )
      }
    }
    if (
      (segment.kind === 'DAILY_REST' &&
        segment.durationSeconds >=
          euRoadFreightProfileV1.reducedDailyRestSeconds) ||
      (segment.kind === 'WEEKLY_REST' &&
        segment.durationSeconds >=
          euRoadFreightProfileV1.reducedWeeklyRestMinimumSeconds)
    ) {
      continuousDriving = 0
    }
  }

  const associatedEventIds = new Set<string>()
  const plannedMissions = missions.map((mission) => {
    const matched = events.filter(
      (event) =>
        event.type === 'DRIVE_START' &&
        (event.missionId === mission.id ||
          (!event.missionId &&
            event.effectiveAt >= mission.startsAt &&
            event.effectiveAt <=
              (mission.endsAt ??
                new Date(
                  mission.startsAt.getTime() + 24 * 60 * 60 * 1000
                ))))
    )
    for (const event of matched) {
      const missionEnd =
        mission.endsAt ??
        new Date(mission.startsAt.getTime() + 24 * 60 * 60 * 1000)
      if (
        event.missionId === mission.id &&
        (event.effectiveAt < mission.startsAt ||
          event.effectiveAt > missionEnd)
      ) {
        anomalies.push(
          `La conduite liée à la mission ${mission.reference} est hors de son créneau planifié.`
        )
      }
    }
    matched.forEach((event) => associatedEventIds.add(event.id))
    return {
      ...mission,
      associatedEventIds: matched.map((event) => event.id),
      status: matched.length ? ('MATCHED' as const) : ('UNCONFIRMED' as const),
    }
  })
  for (const mission of plannedMissions) {
    if (
      mission.startsAt <= input.at &&
      mission.status === 'UNCONFIRMED'
    ) {
      anomalies.push(
        `Mission ${mission.reference} sans déclaration de conduite cohérente.`
      )
    }
  }
  for (const event of events) {
    if (
      event.type === 'DRIVE_START' &&
      event.effectiveAt <= input.at &&
      !event.missionId &&
      !associatedEventIds.has(event.id)
    ) {
      anomalies.push(
        `Conduite déclarée à ${event.effectiveAt.toISOString()} sans mission connue.`
      )
    }
    if (
      event.recordedAt.getTime() - event.effectiveAt.getTime() >
      5 * 60 * 1000
    ) {
      anomalies.push(
        `Déclaration rétrospective enregistrée à ${event.recordedAt.toISOString()}.`
      )
    }
  }

  const updatedAt = events.reduce<Date | null>(
    (latest, event) =>
      !latest || event.recordedAt > latest ? event.recordedAt : latest,
    input.baseline?.referenceAt ?? null
  )
  const stale = Boolean(
    input.baseline?.validUntil &&
      input.baseline.validUntil.getTime() < input.at.getTime()
  )
  let reliability: ActivityReliability
  if (
    !input.baseline &&
    (events.length < 2 || events[0].effectiveAt > weekStart)
  ) {
    reliability = 'INCOMPLETE'
    reasons.push(
      'Historique insuffisant : une valeur inconnue n’est pas remplacée par zéro.'
    )
  } else if (stale) {
    reliability = 'STALE'
    reasons.push('Les dernières données réglementaires sont périmées.')
  } else if (openActivity || anomalies.length) {
    reliability = 'TO_CONFIRM'
    reasons.push(...anomalies)
  } else {
    reliability = 'UP_TO_DATE'
  }

  const eventJournalCoversWholeWeek = Boolean(
    !input.baseline &&
      events.length >= 2 &&
      events[0].effectiveAt.getTime() <= weekStart.getTime()
  )
  const canCalculate = Boolean(input.baseline || eventJournalCoversWholeWeek)
  const weeklyDrivingSeconds = canCalculate
    ? baselineWeek + weeklyObserved
    : null
  const dailyDrivingSeconds = canCalculate ? baselineDay + dailyObserved : null
  const weeklyRemaining =
    weeklyDrivingSeconds === null
      ? null
      : Math.max(
          0,
          euRoadFreightProfileV1.maximumWeeklyDrivingSeconds -
            weeklyDrivingSeconds
        )
  const dailyRemaining =
    dailyDrivingSeconds === null
      ? null
      : Math.max(
          0,
          euRoadFreightProfileV1.normalDailyDrivingSeconds -
            dailyDrivingSeconds
        )
  const warning =
    continuousDriving >
    euRoadFreightProfileV1.maximumContinuousDrivingSeconds
      ? 'Pause réglementaire requise.'
      : weeklyRemaining === 0
        ? 'Limite hebdomadaire atteinte.'
        : null

  return {
    updatedAt: updatedAt?.toISOString() ?? null,
    reliability,
    reliabilityReasons: Array.from(new Set(reasons)),
    currentStatus: lastEvent?.type ?? null,
    openActivity,
    weeklyDrivingSeconds,
    weeklyDrivingRemainingSeconds: weeklyRemaining,
    dailyDrivingSeconds,
    dailyDrivingRemainingSeconds: dailyRemaining,
    drivingSinceValidBreakSeconds: canCalculate ? continuousDriving : null,
    nextAvailabilityAt:
      lastEvent?.type === 'UNAVAILABLE' ? null : input.at.toISOString(),
    nextRestDueAt: null,
    warning,
    observedSegments: segments,
    plannedMissions,
    anomalies: Array.from(new Set(anomalies)),
  }
}
