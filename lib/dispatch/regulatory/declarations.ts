import type {
  DriverRegulatoryDeclaration,
  RegulatoryStateSource,
} from '@prisma/client'

import {
  createUnknownDriverRegulatoryState,
  knownRegulatoryDatum,
  unknownRegulatoryDatum,
} from './state'
import type {
  DriverRegulatoryState,
  TemporalDataSource,
} from './types'
import type { RegulatoryActivitySummary } from './activity-calculator'

function temporalSource(source: RegulatoryStateSource): TemporalDataSource {
  return source === 'TACHOGRAPH'
    ? 'TACHOGRAPH'
    : 'DISPATCHER_DECLARATION'
}

export function regulatoryStateFromDeclaration(
  declaration: DriverRegulatoryDeclaration
): DriverRegulatoryState {
  const observedAt = declaration.referenceAt.toISOString()
  const source = temporalSource(declaration.source)
  const explicitKnownFields = Array.isArray(declaration.knownFields)
    ? new Set(
        declaration.knownFields.filter(
          (field): field is string => typeof field === 'string'
        )
      )
    : null
  const datum = <T>(field: string, value: T) =>
    !explicitKnownFields || explicitKnownFields.has(field)
      ? knownRegulatoryDatum(value, observedAt, source)
      : unknownRegulatoryDatum<T>(
          'Cette valeur n’est pas fournie par la déclaration simplifiée et ne peut pas être déduite des activités connues.'
        )
  return {
    driverId: declaration.driverId,
    timeZone: declaration.timeZone,
    observedAt,
    validUntil: declaration.validUntil?.toISOString() ?? null,
    drivingSinceValidBreakSeconds: datum(
      'drivingSinceValidBreakSeconds',
      declaration.drivingSinceValidBreakSeconds
    ),
    dailyDrivingSeconds: datum(
      'dailyDrivingSeconds',
      declaration.dailyDrivingSeconds
    ),
    weeklyDrivingSeconds: datum(
      'weeklyDrivingSeconds',
      declaration.weeklyDrivingSeconds
    ),
    previousWeekDrivingSeconds: datum(
      'previousWeekDrivingSeconds',
      declaration.previousWeekDrivingSeconds
    ),
    dailyExtensionsUsedThisWeek: datum(
      'dailyExtensionsUsedThisWeek',
      declaration.dailyExtensionsUsedThisWeek
    ),
    reducedDailyRestsUsedSinceWeeklyRest: datum(
      'reducedDailyRestsUsedSinceWeeklyRest',
      declaration.reducedDailyRestsUsedSinceWeeklyRest
    ),
    splitBreakFirstPartSeconds: datum(
      'splitBreakFirstPartSeconds',
      declaration.splitBreakFirstPartSeconds
    ),
    splitDailyRestFirstPartSeconds: datum(
      'splitDailyRestFirstPartSeconds',
      declaration.splitDailyRestFirstPartSeconds
    ),
    lastValidRestEndedAt: datum(
      'lastValidRestEndedAt',
      declaration.lastValidRestEndedAt.toISOString()
    ),
    dutyPeriodStartedAt: datum(
      'dutyPeriodStartedAt',
      declaration.dutyPeriodStartedAt.toISOString()
    ),
    currentIsoWeek: datum('currentIsoWeek', declaration.currentIsoWeek),
    weeklyRestDueAt: datum(
      'weeklyRestDueAt',
      declaration.weeklyRestDueAt?.toISOString() ?? null
    ),
    weeklyRestCompensationDueSeconds: datum(
      'weeklyRestCompensationDueSeconds',
      declaration.weeklyRestCompensationDueSeconds
    ),
  }
}

/**
 * A legacy verified snapshot remains the baseline for counters that cannot be
 * reconstructed from the local event journal yet. Closed driver activity
 * intervals update the three directly observable driving counters. An
 * incomplete/open/contradictory journal is deliberately not promoted to a
 * KNOWN engine state.
 */
export function regulatoryStateFromActivitySummary(
  declaration: DriverRegulatoryDeclaration | null,
  summary: RegulatoryActivitySummary,
  fallback?: { driverId: string; timeZone: string }
): DriverRegulatoryState {
  const observedAt =
    summary.updatedAt ??
    declaration?.referenceAt.toISOString() ??
    new Date(0).toISOString()
  const state = declaration
    ? regulatoryStateFromDeclaration(declaration)
    : createUnknownDriverRegulatoryState({
        driverId: fallback?.driverId ?? '',
        timeZone: fallback?.timeZone ?? 'Europe/Luxembourg',
        observedAt,
      })
  state.observedAt = observedAt
  if (summary.weeklyDrivingSeconds !== null && summary.updatedAt) {
    state.weeklyDrivingSeconds = knownRegulatoryDatum(
      summary.weeklyDrivingSeconds,
      summary.updatedAt,
      'DRIVER_DECLARATION'
    )
  }
  if (summary.dailyDrivingSeconds !== null && summary.updatedAt) {
    state.dailyDrivingSeconds = knownRegulatoryDatum(
      summary.dailyDrivingSeconds,
      summary.updatedAt,
      'DRIVER_DECLARATION'
    )
  }
  if (
    summary.drivingSinceValidBreakSeconds !== null &&
    summary.updatedAt
  ) {
    state.drivingSinceValidBreakSeconds = knownRegulatoryDatum(
      summary.drivingSinceValidBreakSeconds,
      summary.updatedAt,
      'DRIVER_DECLARATION'
    )
  }
  return state
}
