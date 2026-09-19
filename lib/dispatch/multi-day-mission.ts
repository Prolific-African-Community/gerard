export type MissionOccupation = {
  startsAt: string
  endsAt: string
  durationSeconds: number
  occupiedDayKeys: string[]
}

function validDate(value: Date | string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function getMissionOccupation(input: {
  pickupDate?: Date | string | null
  deliveryDate?: Date | string | null
  routeDurationSeconds?: number | null
  scheduledDate?: Date | string | null
  plannedEndAt?: Date | string | null
}): MissionOccupation | null {
  const startsAt =
    validDate(input.scheduledDate) ?? validDate(input.pickupDate)
  if (!startsAt) return null
  const explicitEnd =
    validDate(input.plannedEndAt) ?? validDate(input.deliveryDate)
  const estimatedEnd =
    typeof input.routeDurationSeconds === 'number' &&
    input.routeDurationSeconds >= 0
      ? new Date(startsAt.getTime() + input.routeDurationSeconds * 1000)
      : null
  const endsAt =
    explicitEnd && explicitEnd >= startsAt
      ? explicitEnd
      : estimatedEnd && estimatedEnd >= startsAt
      ? estimatedEnd
      : startsAt
  const occupiedDayKeys: string[] = []
  const cursor = new Date(
    Date.UTC(
      startsAt.getUTCFullYear(),
      startsAt.getUTCMonth(),
      startsAt.getUTCDate()
    )
  )
  const lastDay = Date.UTC(
    endsAt.getUTCFullYear(),
    endsAt.getUTCMonth(),
    endsAt.getUTCDate()
  )
  while (cursor.getTime() <= lastDay) {
    occupiedDayKeys.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    durationSeconds: Math.max(
      0,
      Math.floor((endsAt.getTime() - startsAt.getTime()) / 1000)
    ),
    occupiedDayKeys,
  }
}

export function intervalsIntersect(
  leftStart: Date | string,
  leftEnd: Date | string,
  rightStart: Date | string,
  rightEnd: Date | string
) {
  return (
    new Date(leftStart).getTime() < new Date(rightEnd).getTime() &&
    new Date(rightStart).getTime() < new Date(leftEnd).getTime()
  )
}

export function missionIntersectsPeriod(
  occupation: MissionOccupation | null,
  periodStart: Date,
  periodEnd: Date
) {
  if (!occupation) return false
  if (occupation.startsAt === occupation.endsAt) {
    const instant = new Date(occupation.startsAt).getTime()
    return instant >= periodStart.getTime() && instant <= periodEnd.getTime()
  }
  return intervalsIntersect(
    occupation.startsAt,
    occupation.endsAt,
    periodStart,
    periodEnd
  )
}

export function getMissionDayPhase(
  occupation: MissionOccupation,
  dayKey: string
): 'START' | 'CONTINUATION' | 'END' | 'SINGLE' | null {
  const index = occupation.occupiedDayKeys.indexOf(dayKey)
  if (index < 0) return null
  if (occupation.occupiedDayKeys.length === 1) return 'SINGLE'
  if (index === 0) return 'START'
  if (index === occupation.occupiedDayKeys.length - 1) return 'END'
  return 'CONTINUATION'
}
