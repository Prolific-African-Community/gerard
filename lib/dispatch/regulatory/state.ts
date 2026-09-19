import type {
  DriverRegulatoryState,
  RegulatoryDatum,
  TemporalDataSource,
} from './types'

export function knownRegulatoryDatum<T>(
  value: T,
  observedAt: string,
  source: TemporalDataSource = 'DISPATCHER_DECLARATION'
): RegulatoryDatum<T> {
  return {
    status: 'KNOWN',
    value,
    source,
    observedAt,
    confidence: source === 'TACHOGRAPH' ? 'HIGH' : 'MEDIUM',
  }
}

export function unknownRegulatoryDatum<T>(
  reason: string
): RegulatoryDatum<T> {
  return {
    status: 'UNKNOWN',
    source: 'UNKNOWN',
    reason,
  }
}

export function createUnknownDriverRegulatoryState(input: {
  driverId: string
  timeZone: string
  observedAt: string
}): DriverRegulatoryState {
  const missing = <T>() =>
    unknownRegulatoryDatum<T>(
      'Historique tachygraphe ou déclaration du dispatcher requis.'
    )

  return {
    driverId: input.driverId,
    timeZone: input.timeZone,
    observedAt: input.observedAt,
    drivingSinceValidBreakSeconds: missing<number>(),
    dailyDrivingSeconds: missing<number>(),
    weeklyDrivingSeconds: missing<number>(),
    previousWeekDrivingSeconds: missing<number>(),
    dailyExtensionsUsedThisWeek: missing<number>(),
    reducedDailyRestsUsedSinceWeeklyRest: missing<number>(),
    splitBreakFirstPartSeconds: missing<number>(),
    splitDailyRestFirstPartSeconds: missing<number>(),
    lastValidRestEndedAt: missing<string>(),
    dutyPeriodStartedAt: missing<string>(),
    currentIsoWeek: missing<string>(),
    weeklyRestDueAt: missing<string | null>(),
    weeklyRestCompensationDueSeconds: missing<number>(),
  }
}
