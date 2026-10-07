import { createHash } from 'node:crypto'

/**
 * Empreinte d'un instantané de planification et sa décomposition par catégorie.
 *
 * L'empreinte globale décide si une simulation est encore applicable ; la
 * décomposition ne sert qu'à dire POURQUOI elle ne l'est plus, sans jamais
 * exposer d'empreinte à l'utilisateur. Une catégorie ne change que si une donnée
 * métier a réellement changé : le simple passage du temps est neutralisé en
 * amont (instant de référence figé dans le jeton de simulation).
 */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function fingerprintSnapshot(value: unknown) {
  return createHash('sha256').update(stable(value)).digest('hex')
}

export const snapshotChangeReasons = [
  'MISSION_CHANGED',
  'ASSIGNMENT_CHANGED',
  'PAIR_CHANGED',
  'TRAILER_CHANGED',
  'DRIVER_ACTIVITY_CHANGED',
  'REGULATORY_CHANGED',
  'POSITION_CHANGED',
  'ROUTE_DATA_CHANGED',
  'CONFIGURATION_CHANGED',
] as const

export type SnapshotChangeReason = (typeof snapshotChangeReasons)[number]

export const snapshotChangeLabels: Record<SnapshotChangeReason, string> = {
  MISSION_CHANGED: 'une mission a été modifiée',
  ASSIGNMENT_CHANGED: 'une affectation a changé',
  PAIR_CHANGED: 'un couple chauffeur/camion a changé',
  TRAILER_CHANGED: 'une remorque a changé',
  DRIVER_ACTIVITY_CHANGED: 'une activité chauffeur a été enregistrée ou corrigée',
  REGULATORY_CHANGED: 'une déclaration réglementaire a changé',
  POSITION_CHANGED: 'la position d’un chauffeur a changé',
  ROUTE_DATA_CHANGED: 'des données d’itinéraire ont changé',
  CONFIGURATION_CHANGED: 'la configuration de planification a changé',
}

export type SnapshotParts = Record<string, string>

type PairLike = {
  initialPosition?: unknown
  regulatoryState?: unknown
} & Record<string, unknown>

type MaterialLike = {
  period: unknown
  timeZone: unknown
  pairs: PairLike[]
  missions: unknown
  trailers: unknown
  transitions: unknown
  resourceOccupations?: unknown
  unavailableResourceIds?: unknown
  costs: unknown
  profile: unknown
  configuration: unknown
}

const short = (value: unknown) => fingerprintSnapshot(value).slice(0, 12)

/** Empreinte courte de chaque catégorie de données de l'instantané. */
export function computeSnapshotParts(input: {
  material: MaterialLike
  assignments: unknown
  driverActivityRevision: unknown
  regulatoryDeclarationRevision: unknown
}): SnapshotParts {
  const { material } = input
  return {
    MISSION_CHANGED: short(material.missions),
    ASSIGNMENT_CHANGED: short([input.assignments, material.resourceOccupations]),
    PAIR_CHANGED: short(
      material.pairs.map(({ initialPosition: _p, regulatoryState: _r, ...rest }) => rest)
    ),
    TRAILER_CHANGED: short(material.trailers),
    DRIVER_ACTIVITY_CHANGED: short(input.driverActivityRevision),
    REGULATORY_CHANGED: short(input.regulatoryDeclarationRevision),
    // État réglementaire dérivé : ne devient une cause propre que si ni les
    // activités ni les déclarations n'ont changé (voir changedSnapshotReasons).
    DERIVED_REGULATORY_STATE: short(material.pairs.map((pair) => pair.regulatoryState)),
    POSITION_CHANGED: short(material.pairs.map((pair) => pair.initialPosition)),
    ROUTE_DATA_CHANGED: short(material.transitions),
    CONFIGURATION_CHANGED: short([
      material.period,
      material.timeZone,
      material.unavailableResourceIds,
      material.costs,
      material.profile,
      material.configuration,
    ]),
  }
}

/** Catégories dont les données ont réellement changé entre la simulation et maintenant. */
export function changedSnapshotReasons(
  expected: SnapshotParts,
  actual: SnapshotParts
): SnapshotChangeReason[] {
  const changed = new Set<string>(
    Object.keys(expected).filter((key) => expected[key] !== actual[key])
  )
  if (
    changed.has('DERIVED_REGULATORY_STATE') &&
    !changed.has('DRIVER_ACTIVITY_CHANGED') &&
    !changed.has('REGULATORY_CHANGED')
  ) {
    changed.add('REGULATORY_CHANGED')
  }
  return snapshotChangeReasons.filter((reason) => changed.has(reason))
}

export function describeSnapshotChange(reasons: readonly SnapshotChangeReason[]) {
  if (!reasons.length) {
    return 'Les données Dispatch ont changé. Une nouvelle simulation est requise.'
  }
  return `Le planning a changé depuis la simulation : ${reasons
    .map((reason) => snapshotChangeLabels[reason])
    .join(', ')}. Une nouvelle simulation est requise.`
}
