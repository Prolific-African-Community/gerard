import { ParkVehicleType } from '@prisma/client'

export type InspectionSectionKey =
  | 'TIRES'
  | 'BRAKES'
  | 'LIGHTS'
  | 'BODY_SAFETY'
  | 'COUPLING'
  | 'TRUCK_SPECIFIC'
  | 'TRAILER_SPECIFIC'

export type InspectionTemplateItem = {
  key: string
  label: string
  required: boolean
}

export type InspectionTemplateSection = {
  key: InspectionSectionKey
  label: string
  icon: 'tire' | 'brake' | 'light' | 'shield' | 'coupling' | 'truck' | 'trailer'
  items: readonly InspectionTemplateItem[]
}

const commonSections: readonly InspectionTemplateSection[] = [
  {
    key: 'TIRES',
    label: 'Pneus',
    icon: 'tire',
    items: [
      { key: 'tires.visual', label: 'État visuel', required: true },
      { key: 'tires.wear', label: 'Usure', required: true },
      { key: 'tires.damage', label: 'Dommage', required: true },
    ],
  },
  {
    key: 'BRAKES',
    label: 'Freinage',
    icon: 'brake',
    items: [
      { key: 'brakes.general', label: 'État général', required: true },
      { key: 'brakes.anomaly', label: 'Anomalie visible', required: true },
    ],
  },
  {
    key: 'LIGHTS',
    label: 'Éclairage',
    icon: 'light',
    items: [
      { key: 'lights.front', label: 'Feux avant', required: true },
      { key: 'lights.rear', label: 'Feux arrière', required: true },
      { key: 'lights.indicators', label: 'Clignotants', required: true },
      { key: 'lights.stop', label: 'Feux stop', required: true },
      { key: 'lights.plate', label: 'Éclairage de plaque', required: true },
    ],
  },
]

const truckSections: readonly InspectionTemplateSection[] = [
  ...commonSections,
  {
    key: 'BODY_SAFETY',
    label: 'Carrosserie et sécurité',
    icon: 'shield',
    items: [
      { key: 'body.damage', label: 'Dommages visibles', required: true },
      { key: 'body.mirrors', label: 'Rétroviseurs', required: true },
      { key: 'body.windshield', label: 'Pare-brise', required: true },
      { key: 'body.protection', label: 'Protections et fixations', required: true },
      { key: 'body.plate', label: 'Plaque lisible', required: true },
    ],
  },
  {
    key: 'COUPLING',
    label: 'Attelage et connexions',
    icon: 'coupling',
    items: [
      { key: 'coupling.fifth_wheel', label: 'Sellette ou crochet', required: true },
      { key: 'coupling.hoses', label: 'Flexibles', required: true },
      { key: 'coupling.electrical', label: 'Prises électriques', required: true },
      { key: 'coupling.lock', label: 'Verrouillage', required: true },
    ],
  },
  {
    key: 'TRUCK_SPECIFIC',
    label: 'Cabine et moteur',
    icon: 'truck',
    items: [
      { key: 'truck.levels', label: 'Niveaux visibles', required: true },
      { key: 'truck.leaks', label: 'Fuites', required: true },
      { key: 'truck.dashboard', label: 'Tableau de bord et alertes', required: true },
    ],
  },
]

const trailerSections: readonly InspectionTemplateSection[] = [
  ...commonSections.map((section) =>
    section.key === 'LIGHTS'
      ? {
          ...section,
          items: section.items.filter((item) => item.key !== 'lights.front'),
        }
      : section
  ),
  {
    key: 'BODY_SAFETY',
    label: 'Carrosserie et sécurité',
    icon: 'shield',
    items: [
      { key: 'body.damage', label: 'Dommages visibles', required: true },
      { key: 'body.protection', label: 'Protections et fixations', required: true },
      { key: 'body.plate', label: 'Plaque lisible', required: true },
    ],
  },
  {
    key: 'COUPLING',
    label: 'Attelage et connexions',
    icon: 'coupling',
    items: [
      { key: 'coupling.hoses', label: 'Flexibles', required: true },
      { key: 'coupling.electrical', label: 'Prises électriques', required: true },
      { key: 'coupling.lock', label: 'Verrouillage', required: true },
      { key: 'coupling.legs', label: 'Béquilles', required: true },
    ],
  },
  {
    key: 'TRAILER_SPECIFIC',
    label: 'Structure remorque',
    icon: 'trailer',
    items: [
      { key: 'trailer.body', label: 'Bâche, portes ou caisse', required: true },
      { key: 'trailer.floor', label: 'Plancher', required: true },
      { key: 'trailer.legs', label: 'Béquilles', required: true },
      { key: 'trailer.axles', label: 'Essieux', required: true },
      { key: 'trailer.load_securing', label: 'Fixation du chargement', required: true },
    ],
  },
]

export function inspectionTemplate(vehicleType: ParkVehicleType) {
  return vehicleType === ParkVehicleType.TRUCK ? truckSections : trailerSections
}

export function inspectionTemplateItemMap(vehicleType: ParkVehicleType) {
  return new Map(
    inspectionTemplate(vehicleType).flatMap((section) =>
      section.items.map((item, index) => [
        item.key,
        { ...item, category: section.key, sortOrder: index },
      ] as const)
    )
  )
}

export const truckPressurePositions = [
  'Avant gauche',
  'Avant droite',
  'Arrière gauche',
  'Arrière droite',
] as const

export const trailerPressurePositions = [
  'Essieu 1 gauche',
  'Essieu 1 droite',
  'Essieu 2 gauche',
  'Essieu 2 droite',
  'Essieu 3 gauche',
  'Essieu 3 droite',
] as const

export function defaultPressurePositions(vehicleType: ParkVehicleType) {
  return vehicleType === ParkVehicleType.TRUCK
    ? truckPressurePositions
    : trailerPressurePositions
}

export function pressureItemKey(index: number) {
  return `tires.pressure.${index + 1}`
}

export function isPressureItemKey(value: string) {
  return /^tires\.pressure\.\d{1,2}$/.test(value)
}
