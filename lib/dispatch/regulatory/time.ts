function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  )

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  }
}

export function parseInstant(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + Math.round(seconds * 1000))
}

export function differenceInSeconds(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 1000)
}

export function getLocalDateKey(date: Date, timeZone: string) {
  const parts = getZonedParts(date, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(
    parts.day
  ).padStart(2, '0')}`
}

export function getIsoWeekKey(date: Date, timeZone: string) {
  const { year, month, day } = getZonedParts(date, timeZone)
  const localDate = new Date(Date.UTC(year, month - 1, day))
  const dayOfWeek = localDate.getUTCDay() || 7
  localDate.setUTCDate(localDate.getUTCDate() + 4 - dayOfWeek)
  const isoYear = localDate.getUTCFullYear()
  const yearStart = new Date(Date.UTC(isoYear, 0, 1))
  const week = Math.ceil(
    ((localDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  )
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

export function findNextIsoWeekBoundary(
  start: Date,
  end: Date,
  timeZone: string
) {
  const startKey = getIsoWeekKey(start, timeZone)
  if (getIsoWeekKey(end, timeZone) === startKey) return null

  let low = start.getTime()
  let high = end.getTime()
  while (high - low > 1000) {
    const middle = Math.floor((low + high) / 2)
    if (getIsoWeekKey(new Date(middle), timeZone) === startKey) {
      low = middle
    } else {
      high = middle
    }
  }
  return new Date(Math.ceil(high / 1000) * 1000)
}
