import { TrailerCargoType, TrailerType } from '@prisma/client'

import { COUPLING_TYPE_VALUES } from './technical-attributes'
import {
  normalizeCouplingType,
  normalizeTrailerCargoType,
  normalizeTrailerType,
} from './form-normalization'

const trailerTypes = new Set<string>(Object.values(TrailerType))
const cargoTypes = new Set<string>(Object.values(TrailerCargoType))
const couplingTypes = new Set<string>(COUPLING_TYPE_VALUES)

/**
 * Valide uniquement les clés structurées exploitées par le moteur. Les autres
 * exigences historiques restent autorisées et sont conservées telles quelles.
 */
export function hasValidMissionTrailerRequirements(
  requirements: Record<string, unknown> | undefined
) {
  if (!requirements) return true
  const {
    requiredTrailerType,
    requiredCapacityKg,
    requiredCargoType,
    requiredCouplingType,
  } = requirements
  if (
    typeof requiredTrailerType !== 'undefined' &&
    requiredTrailerType !== null &&
    requiredTrailerType !== '' &&
    (typeof requiredTrailerType !== 'string' ||
      !trailerTypes.has(requiredTrailerType))
  ) return false
  if (
    typeof requiredCapacityKg !== 'undefined' &&
    requiredCapacityKg !== null &&
    (typeof requiredCapacityKg !== 'number' ||
      !Number.isFinite(requiredCapacityKg) ||
      requiredCapacityKg <= 0)
  ) return false
  if (
    typeof requiredCargoType !== 'undefined' &&
    requiredCargoType !== null &&
    requiredCargoType !== '' &&
    (typeof requiredCargoType !== 'string' ||
      !cargoTypes.has(requiredCargoType))
  ) return false
  if (
    typeof requiredCouplingType !== 'undefined' &&
    requiredCouplingType !== null &&
    requiredCouplingType !== '' &&
    (typeof requiredCouplingType !== 'string' ||
      !couplingTypes.has(requiredCouplingType))
  ) return false
  return true
}

export function normalizeMissionTrailerRequirements(
  requirements: Record<string, unknown>
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string } {
  const value = { ...requirements }

  if ('requiredTrailerType' in value) {
    if (typeof value.requiredTrailerType === 'undefined') {
      delete value.requiredTrailerType
    } else {
    const normalized = normalizeTrailerType(value.requiredTrailerType)
    if (
      typeof value.requiredTrailerType !== 'undefined' &&
      value.requiredTrailerType !== null &&
      value.requiredTrailerType !== '' &&
      typeof normalized === 'undefined'
    ) {
      return { ok: false, error: 'Type de remorque requis invalide.' }
    }
    value.requiredTrailerType = normalized ?? null
    }
  }

  if ('requiredCargoType' in value) {
    if (typeof value.requiredCargoType === 'undefined') {
      delete value.requiredCargoType
    } else {
    const normalized = normalizeTrailerCargoType(value.requiredCargoType)
    if (
      typeof value.requiredCargoType !== 'undefined' &&
      value.requiredCargoType !== null &&
      value.requiredCargoType !== '' &&
      typeof normalized === 'undefined'
    ) {
      return { ok: false, error: 'Type de marchandise requis invalide.' }
    }
    value.requiredCargoType = normalized ?? null
    }
  }

  if ('requiredCouplingType' in value) {
    if (typeof value.requiredCouplingType === 'undefined') {
      delete value.requiredCouplingType
    } else {
    const normalized = normalizeCouplingType(value.requiredCouplingType)
    if (
      typeof value.requiredCouplingType !== 'undefined' &&
      value.requiredCouplingType !== null &&
      value.requiredCouplingType !== '' &&
      typeof normalized === 'undefined'
    ) {
      return { ok: false, error: 'Type d’attelage requis invalide.' }
    }
    value.requiredCouplingType = normalized ?? null
    }
  }

  if ('requiredCapacityKg' in value) {
    const raw = value.requiredCapacityKg
    if (typeof raw === 'undefined') {
      delete value.requiredCapacityKg
    } else if (raw === null || raw === '') {
      value.requiredCapacityKg = null
    } else {
      const capacity =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string'
            ? Number(raw.trim().replace(',', '.'))
            : Number.NaN
      if (!Number.isFinite(capacity) || capacity <= 0) {
        return { ok: false, error: 'Capacité remorque requise invalide.' }
      }
      value.requiredCapacityKg = capacity
    }
  }

  return { ok: true, value }
}
