import type {
  MaintenanceInterventionType,
  MaintenanceRequestStatus,
  MaintenanceUrgency,
} from './maintenance-display'

export type Driver = {
  id: string
  name: string
  phone?: string
  email?: string | null
  username?: string | null
  status?: DriverStatus
  hourlyCostAmount?: number | null
  hourlyCostCurrency?: string | null
  operationalSummary?: DriverOperationalSummary | null
}

export type DriverStatus = 'ACTIVE' | 'UNAVAILABLE' | 'ON_LEAVE' | 'INACTIVE'

export type DriverOperationalSummary = {
  regulatoryStatus: 'CONFORME' | 'AVERTISSEMENT' | 'BLOQUANT'
  currentActivity: string | null
  openActivity: boolean
  positionSource: 'DRIVER_GPS' | 'LAST_COMPLETED_MISSION' | 'OPERATING_BASE' | 'UNKNOWN'
  positionLabel: string
  positionObservedAt: string | null
  positionFreshnessSeconds: number | null
  priorityAction: string
}

export type Truck = {
  id: string
  plateNumber: string
  brand?: string
  model?: string
  driverId?: string | null
  gpsDeviceId?: string | null
  status?: TruckStatus
  statusUpdatedAt?: string | null
  technicalInspectionDate?: string | null
  technicalInspectionExpiresAt?: string | null
  returnToBaseDistanceMeters?: number
  returnToBaseDurationSeconds?: number
  returnToBasePolyline?: string
  returnToBaseCalculatedAt?: string
  returnToBaseProvider?: string
  category?: string | null
  capacityKg?: number | null
  couplingType?: string | null
  activeMaintenance?: MaintenanceSummary | null
}

export type TrailerType =
  | 'CURTAINSIDER'
  | 'FLATBED'
  | 'REFRIGERATED'
  | 'CONTAINER'
  | 'BOX'
  | 'OTHER'

export type TrailerStatus =
  | 'AVAILABLE'
  | 'ASSIGNED'
  | 'AT_BASE'
  | 'IN_MAINTENANCE'
  | 'MAINTENANCE_EXT'
  | 'OUT_OF_SERVICE'

export type TrailerLoadStatus = 'EMPTY' | 'LOADED'
export type TrailerCustodyState =
  | 'EMPTY'
  | 'LOADED'
  | 'IN_MISSION'
  | 'AT_BASE'
  | 'RELAY_AVAILABLE'
  | 'DELIVERED'
  | 'IMMOBILIZED'

export type TrailerCargoType =
  | 'WOOD'
  | 'ALUMINIUM'
  | 'STEEL'
  | 'PALLETS'
  | 'CONSTRUCTION_MATERIALS'
  | 'FOOD'
  | 'MACHINERY'
  | 'TEXTILE'
  | 'CHEMICALS'
  | 'OTHER'

export type Trailer = {
  id: string
  plateNumber: string
  type: TrailerType
  status: TrailerStatus
  loadStatus?: TrailerLoadStatus
  cargoType?: TrailerCargoType | null
  compatibleCargoTypes?: TrailerCargoType[] | null
  cargoDescription?: string | null
  technicalInspectionDate?: string | null
  technicalInspectionExpiresAt?: string | null
  truckId?: string | null
  notes?: string | null
  capacityKg?: number | null
  couplingType?: string | null
  custodyState?: TrailerCustodyState
  custodyVersion?: number
  activeMaintenance?: MaintenanceSummary | null
}

export type MaintenanceSummary = {
  id: string
  status: MaintenanceRequestStatus
  interventionType: MaintenanceInterventionType
  urgency: MaintenanceUrgency
  immobilizationRequired: boolean
  preferredDate?: string | null
  issueDescription?: string | null
  quoteAmount?: number | null
  invoiceAmount?: number | null
  slInvoiceReference?: string | null
  providerRequestId?: string | null
  quotePdfUrl?: string | null
  invoicePdfUrl?: string | null
}

export type MissionStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'done'
  | 'issue'
  | 'cancelled'

export type TruckStatus =
  | 'AVAILABLE'
  | 'ASSIGNED'
  | 'EN_ROUTE_TO_PICKUP'
  | 'AT_PICKUP'
  | 'ON_MISSION'
  | 'RETURNING_TO_BASE'
  | 'AT_BASE'
  | 'IN_MAINTENANCE'
  | 'MAINTENANCE_EXT'
  | 'OUT_OF_SERVICE'

export type Mission = {
  id: string
  reference: string
  clientName: string
  shortLabel?: string
  pickupCity: string
  deliveryCity: string
  pickupAddress?: string
  deliveryAddress?: string
  pickupPlaceId?: string
  deliveryPlaceId?: string
  pickupLat?: number
  pickupLng?: number
  deliveryLat?: number
  deliveryLng?: number
  estimatedKm: number
  clientReference?: string
  cmrNumber?: string
  deliveryNoteNumber?: string
  pickupDate?: string
  deliveryDate?: string
  requiredTruckType?: string
  priceAmount?: number
  priceCurrency?: string
  paymentTerms?: string
  preAnnouncementRequired?: boolean
  preAnnouncementSent?: boolean
  preAnnouncementSentAt?: string
  requirements?: Record<string, unknown>
  contacts?: Record<string, unknown>
  billingInfo?: Record<string, unknown>
  routeDistanceMeters?: number
  routeDurationSeconds?: number
  routePolyline?: string
  routeCalculatedAt?: string
  routeProvider?: string
  sourceEmailId?: string
  sourceEmailFrom?: string
  sourceEmailSubject?: string
  hasSourceEmail?: boolean
  preparationStatus?: string
  /**
   * Affectation réelle en base (MissionAssignment), indépendante de la semaine
   * consultée. `null` signifie « aucune affectation », jamais « pas affectée
   * cette semaine ».
   */
  assignment?: {
    id?: string | null
    scheduledDate?: string | null
    plannedEndAt?: string | null
    planningRowId?: string | null
    driverId?: string | null
    truckId?: string | null
  } | null
  status: MissionStatus
  notes?: string
  trailerPlateNumber?: string
  trailerId?: string
  trailerCustodyState?: TrailerCustodyState
  trailerCustodyLabel?: string
  trailerRelayAvailable?: boolean
  trailerCustodyEvents?: Array<{
    id: string
    fromState: TrailerCustodyState
    toState: TrailerCustodyState
    status: 'PLANNED' | 'COMPLETED' | 'CANCELLED'
    location?: string | null
    note?: string | null
    occurredAt: string
    fromDriverId?: string | null
    toDriverId?: string | null
    fromDriver?: { id: string; name: string } | null
    toDriver?: { id: string; name: string } | null
  }>
}

export const dispatchDays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export type DispatchDay = typeof dispatchDays[number]

export const dayLabels: Record<DispatchDay, string> = {
  monday: 'Lundi',
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
  sunday: 'Dimanche',
}

export const mockDrivers: Driver[] = [
  {
    id: 'driver-antoine',
    name: 'Antoine Muller',
    phone: '+352 621 184 902',
  },
  {
    id: 'driver-samir',
    name: 'Samir Benali',
    phone: '+352 621 740 118',
  },
  {
    id: 'driver-julien',
    name: 'Julien Weber',
    phone: '+352 621 552 481',
  },
  {
    id: 'driver-marc',
    name: 'Marc Hoffmann',
    phone: '+352 621 330 765',
  },
  {
    id: 'driver-laurent',
    name: 'Laurent Klein',
    phone: '+352 621 904 216',
  },
]

export const mockTrucks: Truck[] = [
  {
    id: 'truck-ntx-421',
    plateNumber: 'LU-NTX-421',
    model: 'Mercedes Actros',
    driverId: 'driver-antoine',
  },
  {
    id: 'truck-ntx-518',
    plateNumber: 'LU-NTX-518',
    model: 'Volvo FH',
    driverId: 'driver-samir',
  },
  {
    id: 'truck-ntx-603',
    plateNumber: 'LU-NTX-603',
    model: 'Scania R450',
    driverId: 'driver-julien',
  },
  {
    id: 'truck-ntx-744',
    plateNumber: 'LU-NTX-744',
    model: 'MAN TGX',
    driverId: 'driver-marc',
  },
  {
    id: 'truck-ntx-812',
    plateNumber: 'LU-NTX-812',
    model: 'DAF XF',
    driverId: 'driver-laurent',
  },
  {
    id: 'truck-ntx-930',
    plateNumber: 'LU-NTX-930',
    model: 'Mercedes Actros',
    driverId: null,
  },
  {
    id: 'truck-ntx-944',
    plateNumber: 'LU-NTX-944',
    model: 'Volvo FH',
    driverId: null,
  },
  {
    id: 'truck-ntx-972',
    plateNumber: 'LU-NTX-972',
    model: 'MAN TGX',
    driverId: null,
  },
]

export const mockMissions: Mission[] = [
  {
    id: 'mission-2048',
    reference: 'REF-2048',
    clientName: 'Translog Europe',
    shortLabel: 'Translog Europe',
    pickupCity: 'Luxembourg',
    deliveryCity: 'Paris',
    estimatedKm: 320,
    status: 'pending',
  },
  {
    id: 'mission-2051',
    reference: 'REF-2051',
    clientName: 'Ardennes Fret',
    shortLabel: 'Sedan -> Metz',
    pickupCity: 'Sedan',
    deliveryCity: 'Metz',
    estimatedKm: 145,
    status: 'assigned',
  },
  {
    id: 'mission-2053',
    reference: 'REF-2053',
    clientName: 'EuroSteel Logistics',
    shortLabel: 'EuroSteel',
    pickupCity: 'Luxembourg',
    deliveryCity: 'Charleroi',
    estimatedKm: 205,
    status: 'in_progress',
  },
  {
    id: 'mission-2057',
    reference: 'REF-2057',
    clientName: 'Lorraine Distribution',
    shortLabel: 'Nancy -> Reims',
    pickupCity: 'Nancy',
    deliveryCity: 'Reims',
    estimatedKm: 190,
    status: 'pending',
  },
  {
    id: 'mission-2060',
    reference: 'REF-2060',
    clientName: 'Benelux Cargo',
    shortLabel: 'Benelux Cargo',
    pickupCity: 'Bruxelles',
    deliveryCity: 'Luxembourg',
    estimatedKm: 225,
    status: 'done',
  },
  {
    id: 'mission-2064',
    reference: 'REF-2064',
    clientName: 'Rhine Supply',
    shortLabel: 'Strasbourg -> Metz',
    pickupCity: 'Strasbourg',
    deliveryCity: 'Metz',
    estimatedKm: 165,
    status: 'pending',
  },
  {
    id: 'mission-2068',
    reference: 'REF-2068',
    clientName: 'Nord Hub Transport',
    shortLabel: 'Paris -> Bruxelles',
    pickupCity: 'Paris',
    deliveryCity: 'Bruxelles',
    estimatedKm: 310,
    status: 'issue',
  },
  {
    id: 'mission-2072',
    reference: 'REF-2072',
    clientName: 'Alpine Industrie',
    shortLabel: 'Alpine Industrie',
    pickupCity: 'Lyon',
    deliveryCity: 'Luxembourg',
    estimatedKm: 515,
    status: 'pending',
  },
  {
    id: 'mission-2075',
    reference: 'REF-2075',
    clientName: 'Champagne Express',
    shortLabel: 'Reims -> Sedan',
    pickupCity: 'Reims',
    deliveryCity: 'Sedan',
    estimatedKm: 96,
    status: 'assigned',
  },
  {
    id: 'mission-2079',
    reference: 'REF-2079',
    clientName: 'Moselle Freight',
    shortLabel: 'Moselle Freight',
    pickupCity: 'Metz',
    deliveryCity: 'Nancy',
    estimatedKm: 58,
    status: 'in_progress',
  },
  {
    id: 'mission-2082',
    reference: 'REF-2082',
    clientName: 'Capital Logistics',
    shortLabel: 'Luxembourg -> Bruxelles',
    pickupCity: 'Luxembourg',
    deliveryCity: 'Bruxelles',
    estimatedKm: 218,
    status: 'pending',
  },
]
