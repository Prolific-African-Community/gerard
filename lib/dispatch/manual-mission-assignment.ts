export function getManualMissionDurationMs(input: {
  pickupDate: Date | string | null
  deliveryDate: Date | string | null
  routeDurationSeconds: number | null
}) {
  const pickup = input.pickupDate ? new Date(input.pickupDate) : null
  const delivery = input.deliveryDate ? new Date(input.deliveryDate) : null
  if (
    pickup &&
    delivery &&
    !Number.isNaN(pickup.getTime()) &&
    !Number.isNaN(delivery.getTime()) &&
    delivery > pickup
  ) {
    return delivery.getTime() - pickup.getTime()
  }
  return typeof input.routeDurationSeconds === 'number' &&
    input.routeDurationSeconds >= 0
    ? input.routeDurationSeconds * 1000
    : null
}

export function getManualMissionMove(input: {
  scheduledDate: Date | string
  pickupDate: Date | string | null
  deliveryDate: Date | string | null
  routeDurationSeconds: number | null
}) {
  const scheduledDate = new Date(input.scheduledDate)
  const durationMs = getManualMissionDurationMs(input)
  return {
    scheduledDate,
    plannedEndAt: new Date(
      scheduledDate.getTime() + Math.max(0, durationMs ?? 0)
    ),
    warnings:
      durationMs === null
        ? [
            'Durée complète inconnue : déplacement manuel conservé, contrôle réglementaire à compléter.',
          ]
        : [],
  }
}

export function isCertainMissionOverlap(input: {
  movedMissionId: string
  existingMissionId: string
  movedStartsAt: Date | string
  movedEndsAt: Date | string
  existingStartsAt: Date | string
  existingEndsAt: Date | string
}) {
  if (input.movedMissionId === input.existingMissionId) return false
  return (
    new Date(input.movedStartsAt) < new Date(input.existingEndsAt) &&
    new Date(input.existingStartsAt) < new Date(input.movedEndsAt)
  )
}

/* ------------------------------------------------------------------ */
/* Fiabilité de la durée d'occupation                                  */
/* ------------------------------------------------------------------ */

/**
 * Origine de la fin d'occupation retenue pour une affectation.
 *
 * ROUTE     : durée réellement calculée (routeDurationSeconds).
 * EXPLICIT  : plannedEndAt posé à partir d'autre chose que les dates métier.
 * ESTIMATED : déduit de deliveryDate - pickupDate, donc approximatif.
 * UNKNOWN   : aucune fin exploitable.
 *
 * Seuls ROUTE et EXPLICIT autorisent un blocage dur : l'audit a montré que
 * 69 % des couples pickup/delivery portent la même heure:minute et sont donc
 * des valeurs fabriquées à l'import, pas des horaires de transport.
 */
export type OccupationReliability = 'ROUTE' | 'EXPLICIT' | 'ESTIMATED' | 'UNKNOWN'

export const reliableOccupationSources: OccupationReliability[] = [
  'ROUTE',
  'EXPLICIT',
]

export function isReliableOccupation(reliability: OccupationReliability) {
  return reliableOccupationSources.includes(reliability)
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

function asDate(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Détecte une durée fabriquée à l'import : même heure:minute de part et
 * d'autre, ou multiple exact de 24 h. Ces valeurs ne décrivent pas une
 * immobilisation réelle de la ressource.
 */
export function isSyntheticDateSpan(
  pickupDate: Date | string | null | undefined,
  deliveryDate: Date | string | null | undefined
) {
  const pickup = asDate(pickupDate)
  const delivery = asDate(deliveryDate)
  if (!pickup || !delivery) return false
  if (delivery <= pickup) return false

  const sameClockTime =
    pickup.getUTCHours() === delivery.getUTCHours() &&
    pickup.getUTCMinutes() === delivery.getUTCMinutes()
  const span = delivery.getTime() - pickup.getTime()
  const wholeDays = span % DAY_MS === 0

  return sameClockTime || wholeDays
}

export type ResolvedOccupation = {
  startsAt: Date
  /** `null` lorsqu'aucune fin exploitable n'existe. */
  endsAt: Date | null
  reliability: OccupationReliability
}

/**
 * Fin d'occupation d'une affectation et fiabilité de cette fin.
 *
 * Contrairement à l'ancienne détection, `deliveryDate` n'est jamais utilisée
 * comme fin de créneau Planning : c'est une échéance métier, pas une durée
 * d'immobilisation.
 */
export function resolveOccupation(input: {
  scheduledDate: Date | string
  plannedEndAt?: Date | string | null
  pickupDate?: Date | string | null
  deliveryDate?: Date | string | null
  routeDurationSeconds?: number | null
}): ResolvedOccupation {
  const startsAt = asDate(input.scheduledDate) ?? new Date(NaN)

  // 1. Durée réellement calculée : la seule pleinement fiable.
  if (
    typeof input.routeDurationSeconds === 'number' &&
    Number.isFinite(input.routeDurationSeconds) &&
    input.routeDurationSeconds >= 0
  ) {
    return {
      startsAt,
      endsAt: new Date(startsAt.getTime() + input.routeDurationSeconds * 1000),
      reliability: 'ROUTE',
    }
  }

  const pickup = asDate(input.pickupDate)
  const delivery = asDate(input.deliveryDate)
  const datesSpanMs =
    pickup && delivery && delivery > pickup
      ? delivery.getTime() - pickup.getTime()
      : null

  // 2. plannedEndAt : fiable uniquement s'il ne reproduit pas l'écart des
  // dates métier. Un plannedEndAt simplement recopié depuis
  // deliveryDate - pickupDate n'apporte aucune information nouvelle et ne peut
  // donc pas fonder un blocage dur.
  const plannedEndAt = asDate(input.plannedEndAt)
  if (plannedEndAt && plannedEndAt >= startsAt) {
    const derivedFromDates =
      datesSpanMs !== null &&
      plannedEndAt.getTime() - startsAt.getTime() === datesSpanMs

    return {
      startsAt,
      endsAt: plannedEndAt,
      reliability: derivedFromDates ? 'ESTIMATED' : 'EXPLICIT',
    }
  }

  // 3. Écart des dates métier : toléré comme estimation, jamais comme preuve.
  if (datesSpanMs !== null) {
    return {
      startsAt,
      endsAt: new Date(startsAt.getTime() + datesSpanMs),
      reliability: 'ESTIMATED',
    }
  }

  return { startsAt, endsAt: null, reliability: 'UNKNOWN' }
}

export type ManualConflictVerdict = 'BLOCKING' | 'POTENTIAL' | 'NONE'

/**
 * Verdict de conflit entre la mission déplacée et une affectation existante
 * partageant une ressource.
 *
 * BLOCKING  : les deux intervalles sont fiables et se croisent réellement.
 * POTENTIAL : croisement possible, mais au moins une durée est estimée ou
 *             inconnue — le dispatcher tranche.
 * NONE      : aucun croisement.
 */
export function evaluateManualConflict(input: {
  movedMissionId: string
  existingMissionId: string
  moved: ResolvedOccupation
  existing: ResolvedOccupation
}): ManualConflictVerdict {
  if (input.movedMissionId === input.existingMissionId) return 'NONE'

  const { moved, existing } = input

  // Sans fin exploitable d'un côté, aucun croisement ne peut être démontré :
  // on signale un risque au lieu de refuser l'affectation.
  if (!moved.endsAt || !existing.endsAt) return 'POTENTIAL'

  const intersects = isCertainMissionOverlap({
    movedMissionId: input.movedMissionId,
    existingMissionId: input.existingMissionId,
    movedStartsAt: moved.startsAt,
    movedEndsAt: moved.endsAt,
    existingStartsAt: existing.startsAt,
    existingEndsAt: existing.endsAt,
  })

  if (!intersects) return 'NONE'

  return isReliableOccupation(moved.reliability) &&
    isReliableOccupation(existing.reliability)
    ? 'BLOCKING'
    : 'POTENTIAL'
}

/** Contrat structuré des avertissements renvoyés par l'affectation manuelle. */
export type ManualAssignmentWarningCode =
  | 'ESTIMATED_TIME_OVERLAP'
  | 'UNKNOWN_DURATION'
  | 'PREPARATION_REVIEW'
  | 'ADDRESS_UNCONFIRMED'
  | 'UNKNOWN_DISTANCE'
  | 'RESOURCE_COMPATIBILITY'

export type ManualAssignmentWarning = {
  code: ManualAssignmentWarningCode
  message: string
  missionId?: string
  missionReference?: string
}
