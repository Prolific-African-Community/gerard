/**
 * Caractéristiques techniques contrôlées des camions et remorques réellement
 * évaluées par le moteur de compatibilité (correctif fonctionnel §3 et §4).
 *
 * Le schéma stocke :
 *  - Truck.category / Truck.capacityKg (colonnes historiques dépréciées,
 *    conservées uniquement pour ne pas détruire les données existantes) ;
 *  - Truck.couplingType (String libre) ;
 *  - Trailer.type (enum TrailerType) ;
 *  - Trailer.capacityKg (Int) ;
 *  - Trailer.couplingType (String libre).
 *
 * Pour éviter une migration inutile (§12), les catégories et types d'attelage
 * restent des chaînes en base, mais l'interface et les APIs n'acceptent que des
 * valeurs d'une liste contrôlée, avec un libellé français et une valeur
 * explicite « Non renseigné ». Une donnée absente reste inconnue : elle n'est
 * jamais confondue avec une incompatibilité (§12).
 *
 * Les exigences de transport sont évaluées sur Trailer. Les parseurs Truck
 * restent exportés pour la compatibilité des anciennes API, mais les formulaires
 * et le moteur ne les alimentent plus.
 */
import { TrailerCargoType, TrailerType, TruckStatus } from '@prisma/client'

export const TRUCK_CATEGORY_VALUES = [
  'CURTAINSIDER',
  'FLATBED',
  'REFRIGERATED',
  'CONTAINER',
  'BOX',
  'OTHER',
] as const

export type TruckCategoryValue = (typeof TRUCK_CATEGORY_VALUES)[number]

export const truckCategoryLabels: Record<TruckCategoryValue, string> = {
  CURTAINSIDER: 'Bâché / tautliner',
  FLATBED: 'Plateau',
  REFRIGERATED: 'Frigorifique',
  CONTAINER: 'Porte-conteneur',
  BOX: 'Fourgon',
  OTHER: 'Autre',
}

export const trailerTypeLabels: Record<TrailerType, string> = {
  CURTAINSIDER: 'Bâchée / tautliner',
  FLATBED: 'Plateau',
  REFRIGERATED: 'Frigorifique',
  CONTAINER: 'Porte-conteneur',
  BOX: 'Fourgon',
  OTHER: 'Autre',
}

export const COUPLING_TYPE_VALUES = [
  'FIFTH_WHEEL',
  'DRAWBAR',
  'CENTRE_AXLE',
  'OTHER',
] as const

export type CouplingTypeValue = (typeof COUPLING_TYPE_VALUES)[number]

export const couplingTypeLabels: Record<CouplingTypeValue, string> = {
  FIFTH_WHEEL: 'Sellette (semi-remorque)',
  DRAWBAR: 'Timon (remorque à timon)',
  CENTRE_AXLE: 'Axe central',
  OTHER: 'Autre',
}

/** Libellé affiché pour une valeur inconnue / non renseignée. */
export const NOT_PROVIDED_LABEL = 'Non renseigné'

/** Brèves explications de l'utilité de chaque donnée (affichées dans l'UI). */
export const technicalFieldHints = {
  truckCategory:
    'Champ historique déprécié ; la catégorie de transport appartient à la remorque.',
  truckCapacity:
    'Champ historique déprécié ; la capacité utile appartient à la remorque.',
  couplingType:
    'Type d’attelage, utile pour vérifier la compatibilité camion / remorque.',
  trailerType:
    'Catégorie de remorque, comparée au type exigé par la mission.',
  trailerCapacity:
    'Charge utile de la remorque en kilogrammes.',
} as const

/**
 * Résultat de l'analyse d'un champ optionnel contrôlé.
 *  - ABSENT  : la clé n'était pas fournie → aucune modification ;
 *  - CLEARED : valeur explicitement vidée (« Non renseigné ») → passe à null ;
 *  - VALUE   : valeur contrôlée valide ;
 *  - INVALID : valeur fournie mais hors liste / incohérente.
 */
export type ControlledParse =
  | { status: 'ABSENT' }
  | { status: 'CLEARED' }
  | { status: 'VALUE'; value: string }
  | { status: 'INVALID'; message: string }

export type CapacityParse =
  | { status: 'ABSENT' }
  | { status: 'CLEARED' }
  | { status: 'VALUE'; value: number }
  | { status: 'INVALID'; message: string }

function parseControlled(
  value: unknown,
  allowed: readonly string[],
  fieldLabel: string
): ControlledParse {
  if (typeof value === 'undefined') return { status: 'ABSENT' }
  if (value === null || value === '') return { status: 'CLEARED' }
  if (typeof value !== 'string') {
    return { status: 'INVALID', message: `${fieldLabel} invalide.` }
  }
  const trimmed = value.trim()
  if (!trimmed) return { status: 'CLEARED' }
  if (!allowed.includes(trimmed)) {
    return {
      status: 'INVALID',
      message: `${fieldLabel} hors des valeurs autorisées.`,
    }
  }
  return { status: 'VALUE', value: trimmed }
}

export function parseTruckCategory(value: unknown): ControlledParse {
  return parseControlled(value, TRUCK_CATEGORY_VALUES, 'Catégorie du camion')
}

export function parseCouplingType(value: unknown): ControlledParse {
  return parseControlled(value, COUPLING_TYPE_VALUES, 'Type d’attelage')
}

/** Capacité en kg : entier strictement positif, ou vidage explicite. */
export function parseCapacityKg(value: unknown): CapacityParse {
  if (typeof value === 'undefined') return { status: 'ABSENT' }
  if (value === null || value === '') return { status: 'CLEARED' }
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim())
        : Number.NaN
  if (!Number.isFinite(numeric)) {
    return { status: 'INVALID', message: 'Capacité invalide.' }
  }
  if (!Number.isInteger(numeric)) {
    return {
      status: 'INVALID',
      message: 'La capacité doit être un nombre entier de kilogrammes.',
    }
  }
  if (numeric <= 0) {
    return {
      status: 'INVALID',
      message: 'La capacité doit être strictement positive.',
    }
  }
  return { status: 'VALUE', value: numeric }
}

export function parseCompatibleCargoTypes(value: unknown):
  | { status: 'ABSENT' }
  | { status: 'CLEARED' }
  | { status: 'VALID'; value: TrailerCargoType[] }
  | { status: 'INVALID'; message: string } {
  if (typeof value === 'undefined') return { status: 'ABSENT' }
  if (value === null) return { status: 'CLEARED' }
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        typeof item !== 'string' ||
        !Object.values(TrailerCargoType).includes(item as TrailerCargoType)
    )
  ) {
    return {
      status: 'INVALID',
      message: 'Types de marchandise compatibles invalides',
    }
  }
  return {
    status: 'VALID',
    value: Array.from(new Set(value as TrailerCargoType[])),
  }
}

/**
 * Convertit un résultat d'analyse en valeur Prisma :
 *  - ABSENT  → undefined (champ non modifié) ;
 *  - CLEARED → null (donnée effacée, reste inconnue) ;
 *  - VALUE   → la valeur.
 * INVALID doit être traité en amont (erreur 400) et n'est jamais passé ici.
 */
export function toPrismaValue<T>(
  parse:
    | { status: 'ABSENT' }
    | { status: 'CLEARED' }
    | { status: 'VALUE'; value: T }
): T | null | undefined {
  switch (parse.status) {
    case 'ABSENT':
      return undefined
    case 'CLEARED':
      return null
    default:
      return parse.value
  }
}

/**
 * Statut opérationnel du camion. Table de libellés partagée par le bandeau
 * Dispatch et la recherche locator : un camion ne peut pas être décrit
 * « Disponible » d'un côté et autrement de l'autre.
 */
export const truckStatusLabels: Record<TruckStatus, string> = {
  AVAILABLE: 'Disponible',
  ASSIGNED: 'Affecté',
  EN_ROUTE_TO_PICKUP: 'Vers pickup',
  AT_PICKUP: 'Au pickup',
  ON_MISSION: 'En mission',
  RETURNING_TO_BASE: 'Retour base',
  AT_BASE: 'À la base',
  IN_MAINTENANCE: 'Maintenance à la Base',
  MAINTENANCE_EXT: 'Maintenance extérieure',
  OUT_OF_SERVICE: 'Hors service',
}
