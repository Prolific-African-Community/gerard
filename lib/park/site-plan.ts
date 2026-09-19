import type { ParkSpotType } from '@prisma/client'

/**
 * Plan extérieur du site de Sedan.
 *
 * L'image fournie le 22/07/2026 est la source de vérité : 30 places
 * extérieures, aucune place dans le bâtiment. Les mêmes définitions servent
 * au rendu et à l'initialisation idempotente de la base.
 */
export const PARK_VIEWBOX = { width: 1000, height: 1120 } as const

export type SpotDef = {
  code: string
  zone: string
  label: string
  type: ParkSpotType
  posX: number
  posY: number
  width: number
  height: number
  rotation: number
  sortOrder: number
  capacity: number
}

function row(input: {
  prefix: string
  zone: string
  label: string
  count: number
  x: number
  y: number
  width: number
  height: number
  gap: number
  startOrder: number
}): SpotDef[] {
  return Array.from({ length: input.count }, (_, index) => ({
    code: `${input.prefix}-${String(index + 1).padStart(2, '0')}`,
    zone: input.zone,
    label: `${input.label} ${String(index + 1).padStart(2, '0')}`,
    type: 'PARKING',
    posX: input.x + index * (input.width + input.gap),
    posY: input.y,
    width: input.width,
    height: input.height,
    rotation: 0,
    sortOrder: input.startOrder + index,
    capacity: 1,
  }))
}

export const PARK_SPOTS: SpotDef[] = [
  // Grand parking horizontal en haut à droite : dix longues places verticales.
  ...row({
    prefix: 'P-NORD', zone: 'NORD', label: 'Parking Nord', count: 10,
    x: 575, y: 78, width: 30, height: 128, gap: 8, startOrder: 1,
  }),
  // Deux places de chaque côté de la voie centrale.
  ...row({
    prefix: 'P-CENTRE-G', zone: 'CENTRE-G', label: 'Centre gauche', count: 2,
    x: 245, y: 255, width: 48, height: 132, gap: 18, startOrder: 20,
  }),
  ...row({
    prefix: 'P-CENTRE-D', zone: 'CENTRE-D', label: 'Centre droit', count: 2,
    x: 465, y: 255, width: 48, height: 132, gap: 18, startOrder: 30,
  }),
  // Quatre places en deux rangées de deux, puis deux places plus basses.
  ...row({
    prefix: 'P-OUEST', zone: 'OUEST', label: 'Parking Ouest', count: 2,
    x: 82, y: 455, width: 42, height: 132, gap: 76, startOrder: 40,
  }),
  ...row({
    prefix: 'P-OUEST', zone: 'OUEST', label: 'Parking Ouest', count: 2,
    x: 82, y: 610, width: 42, height: 132, gap: 76, startOrder: 42,
  }).map((spot, index) => ({ ...spot, code: `P-OUEST-0${index + 3}`, sortOrder: 42 + index })),
  ...row({
    prefix: 'P-OUEST', zone: 'OUEST', label: 'Parking Ouest', count: 2,
    x: 58, y: 790, width: 42, height: 112, gap: 12, startOrder: 44,
  }).map((spot, index) => ({ ...spot, code: `P-OUEST-0${index + 5}`, sortOrder: 44 + index })),
  // Parking en façade, devant le bâtiment : dix places verticales.
  ...row({
    prefix: 'P-SUD', zone: 'SUD', label: 'Parking Sud', count: 10,
    x: 380, y: 952, width: 34, height: 126, gap: 9, startOrder: 50,
  }),
].sort((a, b) => a.sortOrder - b.sortOrder)

export const ZONE_LABELS: Record<string, string> = {
  NORD: 'Parking Nord',
  'CENTRE-G': 'Centre gauche',
  'CENTRE-D': 'Centre droit',
  OUEST: 'Parking Ouest',
  SUD: 'Parking Sud',
}

export function zoneLabel(zone: string): string {
  return ZONE_LABELS[zone] ?? zone
}

export function shortSpotCode(code: string): string {
  const number = code.slice(-2)
  if (code.startsWith('P-NORD-')) return `N${number}`
  if (code.startsWith('P-CENTRE-G-')) return `CG${number}`
  if (code.startsWith('P-CENTRE-D-')) return `CD${number}`
  if (code.startsWith('P-OUEST-')) return `O${number}`
  if (code.startsWith('P-SUD-')) return `S${number}`
  return code
}

export type DecorRect = { x: number; y: number; w: number; h: number }

export const ROADS: DecorRect[] = [
  { x: 35, y: 365, w: 260, h: 600 },
  { x: 295, y: 200, w: 145, h: 345 },
  { x: 295, y: 200, w: 665, h: 82 },
  { x: 235, y: 905, w: 665, h: 190 },
  { x: 185, y: 960, w: 110, h: 135 },
]

export const GREEN_AREAS: DecorRect[] = [
  { x: 245, y: 42, w: 135, h: 145 },
  { x: 455, y: 42, w: 505, h: 42 },
  { x: 455, y: 212, w: 120, h: 48 },
  { x: 118, y: 452, w: 44, h: 292 },
]

/** Silhouette volontairement neutre : aucun détail architectural intérieur. */
export const BUILDING_SHELL: DecorRect = { x: 365, y: 390, w: 535, h: 520 }
export const MAIN_ACCESS = { x: 205, y: 1042, w: 128, h: 30 }

export const FLOW_ARROWS: Array<{
  x: number
  y: number
  dir: 'up' | 'down' | 'left' | 'right'
}> = [
  { x: 255, y: 1025, dir: 'up' },
  { x: 285, y: 1025, dir: 'down' },
  { x: 365, y: 300, dir: 'up' },
]
