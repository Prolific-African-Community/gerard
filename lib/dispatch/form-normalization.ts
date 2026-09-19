import { TrailerCargoType, TrailerType } from '@prisma/client'

import {
  COUPLING_TYPE_VALUES,
} from './technical-attributes'
import type { CouplingTypeValue } from './technical-attributes'

function normalizeKey(value: string) {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const trailerTypeAliases: Readonly<Record<string, TrailerType>> = {
  BACHE: TrailerType.CURTAINSIDER,
  BACHEE: TrailerType.CURTAINSIDER,
  TAUTLINER: TrailerType.CURTAINSIDER,
  RIDEAUX_COULISSANTS: TrailerType.CURTAINSIDER,
  PLATEAU: TrailerType.FLATBED,
  FLAT_BED: TrailerType.FLATBED,
  FRIGO: TrailerType.REFRIGERATED,
  FRIGORIFIQUE: TrailerType.REFRIGERATED,
  REEFER: TrailerType.REFRIGERATED,
  PORTE_CONTENEUR: TrailerType.CONTAINER,
  CONTENEUR: TrailerType.CONTAINER,
  FOURGON: TrailerType.BOX,
  AUTRE: TrailerType.OTHER,
}

const cargoTypeAliases: Readonly<Record<string, TrailerCargoType>> = {
  BOIS: TrailerCargoType.WOOD,
  ALU: TrailerCargoType.ALUMINIUM,
  ACIER: TrailerCargoType.STEEL,
  PALETTE: TrailerCargoType.PALLETS,
  PALETTES: TrailerCargoType.PALLETS,
  MATERIAUX_DE_CONSTRUCTION: TrailerCargoType.CONSTRUCTION_MATERIALS,
  ALIMENTAIRE: TrailerCargoType.FOOD,
  MACHINES: TrailerCargoType.MACHINERY,
  MACHINERIE: TrailerCargoType.MACHINERY,
  CHIMIQUE: TrailerCargoType.CHEMICALS,
  AUTRE: TrailerCargoType.OTHER,
}

const couplingTypeAliases: Readonly<Record<string, CouplingTypeValue>> = {
  SELLETTE: 'FIFTH_WHEEL',
  SEMI_REMORQUE: 'FIFTH_WHEEL',
  TIMON: 'DRAWBAR',
  REMORQUE_A_TIMON: 'DRAWBAR',
  AXE_CENTRAL: 'CENTRE_AXLE',
  AUTRE: 'OTHER',
}

export function normalizeTrailerType(
  value: unknown
): TrailerType | null | undefined {
  if (typeof value === 'undefined') return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const key = normalizeKey(value)
  return (
    (Object.values(TrailerType).includes(key as TrailerType)
      ? (key as TrailerType)
      : trailerTypeAliases[key]) ?? undefined
  )
}

export function normalizeTrailerCargoType(
  value: unknown
): TrailerCargoType | null | undefined {
  if (typeof value === 'undefined') return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const key = normalizeKey(value)
  return (
    (Object.values(TrailerCargoType).includes(key as TrailerCargoType)
      ? (key as TrailerCargoType)
      : cargoTypeAliases[key]) ?? undefined
  )
}

export function normalizeCouplingType(
  value: unknown
): CouplingTypeValue | null | undefined {
  if (typeof value === 'undefined') return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const key = normalizeKey(value)
  return (
    (COUPLING_TYPE_VALUES.includes(key as CouplingTypeValue)
      ? (key as CouplingTypeValue)
      : couplingTypeAliases[key]) ?? undefined
  )
}

export function normalizeCompatibleCargoTypes(
  value: unknown
): TrailerCargoType[] | null | undefined {
  if (typeof value === 'undefined') return undefined
  if (value === null || value === '') return null
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null
  if (!values) return undefined
  const normalized = values.map(normalizeTrailerCargoType)
  if (normalized.some((item) => typeof item === 'undefined')) return undefined
  return Array.from(
    new Set(
      normalized.filter(
        (item): item is TrailerCargoType => item !== null
      )
    )
  )
}

export function mergeJsonPatch(
  existing: unknown,
  patch: Record<string, unknown>
) {
  const base =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}
  return Object.fromEntries(
    Object.entries({ ...base, ...patch }).filter(
      ([, value]) => typeof value !== 'undefined'
    )
  )
}
