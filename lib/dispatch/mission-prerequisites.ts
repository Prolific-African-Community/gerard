import { AddressResolutionStatus } from '@prisma/client'

import {
  normalizeCouplingType,
  normalizeTrailerType,
} from './form-normalization'

type MissionPrerequisiteSource = {
  pickupDate?: Date | string | null
  deliveryDate?: Date | string | null
  pickupAddress?: string | null
  pickupCity?: string | null
  deliveryAddress?: string | null
  deliveryCity?: string | null
  pickupLat?: number | null
  pickupLng?: number | null
  deliveryLat?: number | null
  deliveryLng?: number | null
  pickupResolutionStatus?: AddressResolutionStatus | string | null
  deliveryResolutionStatus?: AddressResolutionStatus | string | null
  routeDistanceMeters?: number | null
  routeDurationSeconds?: number | null
  requirements?: unknown
}

export type MissionPrerequisiteItem = {
  key:
    | 'pickup'
    | 'delivery'
    | 'route'
    | 'trailer'
    | 'coupling'
    | 'capacity'
    | 'driver'
  label: string
  status: 'CONFIRMED' | 'MISSING' | 'NOT_REQUIRED' | 'ACTION_REQUIRED'
  detail: string
}

function validDate(value: Date | string | null | undefined) {
  if (!value) return false
  const date = value instanceof Date ? value : new Date(value)
  return !Number.isNaN(date.getTime())
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function resolved(status: string | null | undefined) {
  return status === 'CONFIRMED' || status === 'AUTO_CONFIRMED'
}

export function evaluateMissionPrerequisites(
  mission: MissionPrerequisiteSource,
  driver?: { assigned: boolean; regulatoryStateKnown: boolean }
): MissionPrerequisiteItem[] {
  const requirements = record(mission.requirements)
  const rawTrailerType = requirements.requiredTrailerType
  const rawCoupling = requirements.requiredCouplingType
  const rawCapacity = requirements.requiredCapacityKg
  const trailerType = normalizeTrailerType(rawTrailerType)
  const coupling = normalizeCouplingType(rawCoupling)
  const capacity = Number(requirements.requiredCapacityKg)
  const invalidTrailerType =
    rawTrailerType !== undefined &&
    rawTrailerType !== null &&
    rawTrailerType !== '' &&
    !trailerType
  const invalidCoupling =
    rawCoupling !== undefined &&
    rawCoupling !== null &&
    rawCoupling !== '' &&
    !coupling
  const invalidCapacity =
    rawCapacity !== undefined &&
    rawCapacity !== null &&
    rawCapacity !== '' &&
    !(Number.isFinite(capacity) && capacity > 0)
  const pickupAddress = Boolean(
    mission.pickupAddress?.trim() || mission.pickupCity?.trim()
  )
  const deliveryAddress = Boolean(
    mission.deliveryAddress?.trim() || mission.deliveryCity?.trim()
  )
  const coordinatesConfirmed =
    typeof mission.pickupLat === 'number' &&
    typeof mission.pickupLng === 'number' &&
    typeof mission.deliveryLat === 'number' &&
    typeof mission.deliveryLng === 'number' &&
    resolved(mission.pickupResolutionStatus) &&
    resolved(mission.deliveryResolutionStatus)
  const routeConfirmed =
    coordinatesConfirmed &&
    typeof mission.routeDistanceMeters === 'number' &&
    mission.routeDistanceMeters > 0 &&
    typeof mission.routeDurationSeconds === 'number' &&
    mission.routeDurationSeconds > 0

  return [
    {
      key: 'pickup',
      label: 'Chargement',
      status: validDate(mission.pickupDate) ? 'CONFIRMED' : 'MISSING',
      detail: validDate(mission.pickupDate)
        ? 'Date et heure de chargement confirmées.'
        : "La date et l’heure de chargement sont nécessaires pour calculer le départ.",
    },
    {
      key: 'delivery',
      label: 'Livraison',
      status: validDate(mission.deliveryDate) ? 'CONFIRMED' : 'MISSING',
      detail: validDate(mission.deliveryDate)
        ? 'Date et heure de livraison confirmées.'
        : "La date et l’heure de livraison sont nécessaires pour contrôler la fenêtre.",
    },
    {
      key: 'route',
      label: 'Adresse / itinéraire',
      status: routeConfirmed ? 'CONFIRMED' : 'MISSING',
      detail: routeConfirmed
        ? 'Adresses, coordonnées, durée et distance confirmées.'
        : !pickupAddress || !deliveryAddress
          ? 'Les adresses de chargement et de livraison sont nécessaires.'
          : !coordinatesConfirmed
            ? 'Les adresses doivent être confirmées pour calculer l’itinéraire.'
            : 'La durée et la distance de trajet doivent être calculées.',
    },
    {
      key: 'trailer',
      label: 'Remorque',
      status: invalidTrailerType
        ? 'MISSING'
        : trailerType
          ? 'CONFIRMED'
          : 'NOT_REQUIRED',
      detail: invalidTrailerType
        ? 'Le type de remorque enregistré est invalide et doit être corrigé.'
        : trailerType
        ? 'Type de remorque requis confirmé.'
        : 'Aucune remorque spécifique requise.',
    },
    {
      key: 'coupling',
      label: 'Attelage',
      status: invalidCoupling
        ? 'MISSING'
        : coupling
          ? 'CONFIRMED'
          : 'NOT_REQUIRED',
      detail: invalidCoupling
        ? "Le type d’attelage enregistré est invalide et doit être corrigé."
        : coupling
        ? 'Type d’attelage confirmé.'
        : 'Aucun attelage spécifique requis.',
    },
    {
      key: 'capacity',
      label: 'Capacité',
      status: invalidCapacity
        ? 'MISSING'
        : capacity > 0
          ? 'CONFIRMED'
          : 'NOT_REQUIRED',
      detail: invalidCapacity
        ? 'La capacité enregistrée est invalide et doit être corrigée.'
        : capacity > 0
        ? 'Capacité minimale confirmée.'
        : 'Aucune capacité minimale requise.',
    },
    {
      key: 'driver',
      label: 'Chauffeur',
      status: !driver
        ? 'NOT_REQUIRED'
        : driver.assigned && driver.regulatoryStateKnown
          ? 'CONFIRMED'
          : 'ACTION_REQUIRED',
      detail: !driver
        ? 'Le chauffeur sera évalué lors de la simulation.'
        : !driver.assigned
          ? 'Aucun chauffeur n’est affecté à cette mission.'
          : driver.regulatoryStateKnown
            ? 'État chauffeur disponible.'
            : 'L’état réglementaire du chauffeur doit être complété.',
    },
  ]
}

export function prerequisiteMissingCodes(items: MissionPrerequisiteItem[]) {
  const codes: string[] = []
  for (const item of items) {
    if (item.status !== 'MISSING') continue
    switch (item.key) {
      case 'pickup':
        codes.push('PICKUP_DATE')
        break
      case 'delivery':
        codes.push('DELIVERY_DATE')
        break
      case 'route':
        codes.push('MISSION_ROUTE')
        break
      case 'trailer':
        codes.push('REQUIRED_TRAILER_TYPE')
        break
      case 'coupling':
        codes.push('REQUIRED_COUPLING_TYPE')
        break
      case 'capacity':
        codes.push('REQUIRED_CAPACITY')
        break
    }
  }
  return codes
}
