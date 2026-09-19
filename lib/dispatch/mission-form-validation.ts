import { MissionStatus } from '@prisma/client'

import { normalizeMissionTrailerRequirements } from './mission-trailer-requirements'

type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

const requiredStrings = [
  ['reference', 'La référence est obligatoire.'],
] as const

const optionalNumbers = [
  ['estimatedKm', 'La distance estimée doit être un nombre positif ou nul.'],
  ['priceAmount', 'Le prix doit être un nombre positif ou nul.'],
  ['routeDistanceMeters', 'La distance routière doit être un nombre positif.'],
  ['routeDurationSeconds', 'La durée routière doit être un nombre positif.'],
] as const

const dateFields = [
  ['pickupDate', 'La date de chargement est invalide.'],
  ['deliveryDate', 'La date de livraison est invalide.'],
  ['preAnnouncementSentAt', "La date d’envoi de la pré-annonce est invalide."],
] as const

const coordinateFields = [
  ['pickupLat', -90, 90, 'La latitude de chargement est invalide.'],
  ['pickupLng', -180, 180, 'La longitude de chargement est invalide.'],
  ['deliveryLat', -90, 90, 'La latitude de livraison est invalide.'],
  ['deliveryLng', -180, 180, 'La longitude de livraison est invalide.'],
] as const

const optionalStrings = [
  'title',
  'clientName',
  'pickupCity',
  'deliveryCity',
  'pickupAddress',
  'deliveryAddress',
  'pickupPlaceId',
  'deliveryPlaceId',
  'clientReference',
  'cmrNumber',
  'deliveryNoteNumber',
  'priceCurrency',
  'paymentTerms',
  'sourceEmailId',
  'sourceEmailFrom',
  'sourceEmailSubject',
  'notes',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmptyOptional(value: unknown) {
  return value === null || (typeof value === 'string' && value.trim() === '')
}

export function validateAndNormalizeMissionPayload(
  input: unknown,
  options: { requireMissionId?: boolean; allowPartialRequired?: boolean } = {}
): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, error: 'Le formulaire Mission est invalide.' }
  }

  const value = { ...input }

  if (options.requireMissionId) {
    if (typeof value.missionId !== 'string' || !value.missionId.trim()) {
      return { ok: false, error: 'La mission à modifier est introuvable.' }
    }
    value.missionId = value.missionId.trim()
  }

  for (const [field, error] of requiredStrings) {
    const fieldValue = value[field]
    if (options.allowPartialRequired && typeof fieldValue === 'undefined') {
      continue
    }
    if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
      return { ok: false, error }
    }
    value[field] = fieldValue.trim()
  }

  for (const [field, error] of optionalNumbers) {
    const fieldValue = value[field]
    if (typeof fieldValue === 'undefined' || isEmptyOptional(fieldValue)) {
      delete value[field]
      continue
    }
    if (
      typeof fieldValue !== 'number' ||
      !Number.isFinite(fieldValue) ||
      fieldValue < 0 ||
      ((field === 'routeDistanceMeters' ||
        field === 'routeDurationSeconds') &&
        fieldValue === 0)
    ) {
      return { ok: false, error }
    }
  }

  for (const field of optionalStrings) {
    const fieldValue = value[field]
    if (typeof fieldValue === 'undefined' || isEmptyOptional(fieldValue)) {
      delete value[field]
    } else if (typeof fieldValue !== 'string') {
      return { ok: false, error: `Le champ ${field} doit être un texte.` }
    } else {
      value[field] = fieldValue.trim()
    }
  }

  for (const [field, min, max, error] of coordinateFields) {
    const fieldValue = value[field]
    if (typeof fieldValue === 'undefined' || isEmptyOptional(fieldValue)) {
      delete value[field]
      continue
    }
    if (
      typeof fieldValue !== 'number' ||
      !Number.isFinite(fieldValue) ||
      fieldValue < min ||
      fieldValue > max
    ) {
      return { ok: false, error }
    }
  }

  for (const [field, error] of dateFields) {
    const fieldValue = value[field]
    if (typeof fieldValue === 'undefined' || isEmptyOptional(fieldValue)) {
      delete value[field]
      continue
    }
    if (
      typeof fieldValue !== 'string' ||
      Number.isNaN(new Date(fieldValue).getTime())
    ) {
      return { ok: false, error }
    }
  }

  if (
    typeof value.pickupDate === 'string' &&
    typeof value.deliveryDate === 'string' &&
    new Date(value.deliveryDate) < new Date(value.pickupDate)
  ) {
    return {
      ok: false,
      error: 'La livraison ne peut pas précéder le chargement.',
    }
  }

  if (typeof value.status !== 'undefined') {
    if (typeof value.status !== 'string') {
      return { ok: false, error: 'Le statut de la mission est invalide.' }
    }
    const status = value.status.trim().toUpperCase()
    if (!Object.values(MissionStatus).includes(status as MissionStatus)) {
      return { ok: false, error: 'Le statut de la mission est invalide.' }
    }
    value.status = status
  }

  for (const field of ['preAnnouncementRequired', 'preAnnouncementSent']) {
    if (
      typeof value[field] !== 'undefined' &&
      typeof value[field] !== 'boolean'
    ) {
      return {
        ok: false,
        error: `Le champ ${field} doit être un booléen.`,
      }
    }
  }

  for (const [field, label] of [
    ['contacts', 'Les contacts'],
    ['billingInfo', 'Les informations de facturation'],
  ] as const) {
    if (typeof value[field] === 'undefined' || value[field] === null) {
      delete value[field]
    } else if (!isRecord(value[field])) {
      return { ok: false, error: `${label} sont invalides.` }
    }
  }

  if (typeof value.requirements !== 'undefined') {
    if (value.requirements === null) {
      delete value.requirements
    } else if (!isRecord(value.requirements)) {
      return { ok: false, error: 'Les exigences remorque sont invalides.' }
    } else {
      const requirements = normalizeMissionTrailerRequirements(
        value.requirements
      )
      if (!requirements.ok) return requirements
      value.requirements = requirements.value
    }
  }

  return { ok: true, value }
}
