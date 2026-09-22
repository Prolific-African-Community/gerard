'use client'

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type {
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'

import {
  formatDateParam,
  getScheduledDateForWeekDay,
  getWeekEndDate,
  getWeekStartDate,
  parseWeekStartParam,
} from '../../lib/dispatch/date-utils'
import { dayLabels, dispatchDays } from '../../lib/dispatch/mock-data'
import {
  getMissionDayPhase,
  getMissionOccupation,
} from '../../lib/dispatch/multi-day-mission'
import type {
  DispatchDay,
  Driver,
  DriverStatus,
  Mission,
  MissionStatus,
  Trailer,
  TrailerCargoType,
  TrailerLoadStatus,
  TrailerStatus,
  TrailerType,
  Truck,
  TruckStatus,
} from '../../lib/dispatch/mock-data'
import { buildDispatchCellId, DispatchCell } from './DispatchCell'
import { CreateMissionPanel } from './CreateMissionPanel'
import type { CreateMissionFormData } from './CreateMissionPanel'
import { ClientProfilesPanel } from './ClientProfilesPanel'
import { DispatchMapView } from './DispatchMapView'
import { ImportedMissionsPanel } from './ImportedMissionsPanel'
import { InvoicesPanel } from './InvoicesPanel'
import { MissionCardVisual } from './MissionCard'
import { useGerardApplication } from '@prolific/gerard-core/react'
import { MissionDetailPanel } from './MissionDetailPanel'
import { missionPoolDroppableId, MissionPool } from './MissionPool'
import type {
  DriverFormData,
  PoolLocatorRequest,
  ResourceEditRequest,
  TrailerFormData,
  TruckFormData,
} from './MissionPool'
import { DispatchSmartSearchPanel } from './DispatchSmartSearch'
import { useLocatorHighlight } from './useLocatorHighlight'
import type {
  LocatorNavigation,
  SmartSearchResult,
} from '../../lib/dispatch/smart-search-navigation'
import { TrailerCard } from './TrailerCard'
import { TruckCard } from './TruckCard'
import { useResourceCardActivation } from './useResourceCardActivation'
import { ProfitabilityPanel } from './ProfitabilityPanel'
import { DispatchToolbar } from './DispatchToolbar'
import type { ClientProfile } from '../../lib/dispatch/client-profiles'
import { normalizeClientProfile } from '../../lib/dispatch/client-profiles'
import {
  fullDispatchCapabilities,
} from '../../lib/auth/dispatch-capabilities'
import type { DispatchCapabilities } from '../../lib/auth/dispatch-capabilities'
import { ParkView } from '../park/ParkView'
import type { ParkOverviewDTO } from '../../lib/park/types'
import { AutoPlanningPanel } from './auto-planning/AutoPlanningPanel'
import type { AutoPlanningPreview } from './auto-planning/AutoPlanningPanel'
import { getMissionDropIndex } from '../../lib/dispatch/manual-mission-dnd'
import {
  classifyPlanningPoolMissions,
  groupPlanningBuckets,
} from '../../lib/dispatch/planning-pool'
import {
  buildTrailerActiveMissions,
  isTrailerVisibleOnPlanningRow,
} from '../../lib/dispatch/trailer-rotation'
import { getMissionDisplayLocation } from '../../lib/dispatch/mission-display-location'
import { DriverOperationalCardContent } from './DriverOperationalCardContent'
import { GerardSuggestionsPanel } from './intelligence/GerardSuggestionsPanel'
import { GerardAssistantPanel } from './intelligence/GerardAssistantPanel'

type MissionPlacement = {
  assignmentId?: string
  planningRowId?: string | null
  driverId?: string | null
  truckId?: string | null
  trailerId?: string | null
  trailerChangePlanned?: boolean
  day: DispatchDay
  scheduledDate?: string
  plannedEndAt?: string | null
  approachDistanceMeters?: number
  approachDurationSeconds?: number
  approachPolyline?: string
  approachCalculatedAt?: string
  approachProvider?: string
}

type MissionPlacements = Record<string, MissionPlacement | null>
type DragType = 'mission' | 'truck' | 'driver' | 'trailer'
type ActiveDrag = {
  id: string
  type: DragType
} | null
type TruckAssignments = Record<string, string | null>
type MissionStatuses = Record<string, MissionStatus>
export type ViewMode = 'planning' | 'map' | 'profitability' | 'invoices' | 'park'
type PlanningRow = {
  id: string
  weekStartDate: string
  sortOrder: number
  driverId: string | null
  truckId: string | null
  trailerId: string | null
  pairLocked: boolean
  assignmentOrigin: 'MANUAL' | 'AUTOMATIC' | 'ADJUSTED'
  isExceptionalReplacement: boolean
  usualTruckIdSnapshot: string | null
}
type TruckPosition = {
  id: string
  truckId: string
  driverId?: string | null
  latitude: number
  longitude: number
  speedKmh?: number | null
  heading?: number | null
  provider?: string | null
  recordedAt: string
}
type DispatchOverviewState = {
  drivers: Driver[]
  trucks: Truck[]
  trailers: Trailer[]
  missions: Mission[]
  planningRows: PlanningRow[]
  truckPositions: TruckPosition[]
}
type DbMissionStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'ISSUE'
  | 'CANCELLED'
type DbTruckStatus =
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
type DbPlanningDay =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY'
type ApiDriver = {
  id: string
  name: string
  phone: string | null
  email: string | null
  username?: string | null
  status: DriverStatus
  hourlyCostAmount?: number | null
  hourlyCostCurrency?: string | null
  truck?: ApiTruck | null
  operationalSummary?: Driver['operationalSummary']
}
type ApiTruck = {
  id: string
  plateNumber: string
  brand: string | null
  model: string | null
  status: DbTruckStatus
  statusUpdatedAt: string | null
  technicalInspectionDate: string | null
  technicalInspectionExpiresAt: string | null
  driverId: string | null
  gpsDeviceId: string | null
  returnToBaseDistanceMeters: number | null
  returnToBaseDurationSeconds: number | null
  returnToBasePolyline: string | null
  returnToBaseCalculatedAt: string | null
  returnToBaseProvider: string | null
  category: string | null
  capacityKg: number | null
  couplingType: string | null
  activeMaintenance: ApiActiveMaintenance | null
}
type ApiTrailer = {
  id: string
  plateNumber: string
  type: TrailerType
  status: TrailerStatus
  loadStatus: TrailerLoadStatus
  cargoType: TrailerCargoType | null
  compatibleCargoTypes: TrailerCargoType[] | null
  cargoDescription: string | null
  technicalInspectionDate: string | null
  technicalInspectionExpiresAt: string | null
  truckId: string | null
  notes: string | null
  capacityKg: number | null
  couplingType: string | null
  custodyState: Trailer['custodyState']
  custodyVersion: number
  custodyEvents?: Mission['trailerCustodyEvents']
  activeMaintenance: ApiActiveMaintenance | null
}
type ApiActiveMaintenance = {
  id: string
  status:
    | 'DRAFT'
    | 'SUBMITTED'
    | 'RECEIVED'
    | 'UNDER_REVIEW'
    | 'QUOTE_RECEIVED'
    | 'QUOTE_APPROVED'
    | 'QUOTE_REJECTED'
    | 'SCHEDULED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'INVOICED'
    | 'PAID'
    | 'CLOSED'
    | 'CANCELLED'
  interventionType:
    | 'DIAGNOSTIC'
    | 'TIRES'
    | 'BRAKES'
    | 'OIL_SERVICE'
    | 'ELECTRICAL'
    | 'BODYWORK'
    | 'TRAILER_REPAIR'
    | 'SAFETY_CHECK'
    | 'OTHER'
  urgency: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'
  immobilizationRequired: boolean
  preferredDate: string | null
  issueDescription: string | null
  quoteAmount: number | null
  invoiceAmount: number | null
  slInvoiceReference: string | null
  providerRequestId: string | null
  quotePdfUrl: string | null
  invoicePdfUrl: string | null
}
type ApiMission = {
  id: string
  reference: string
  title: string | null
  clientName: string | null
  pickupCity: string | null
  deliveryCity: string | null
  pickupAddress: string | null
  deliveryAddress: string | null
  pickupPlaceId: string | null
  deliveryPlaceId: string | null
  pickupLat: number | null
  pickupLng: number | null
  deliveryLat: number | null
  deliveryLng: number | null
  estimatedKm: number | null
  clientReference: string | null
  cmrNumber: string | null
  deliveryNoteNumber: string | null
  pickupDate: string | null
  deliveryDate: string | null
  requiredTruckType: string | null
  priceAmount: number | null
  priceCurrency: string | null
  paymentTerms: string | null
  preAnnouncementRequired: boolean
  preAnnouncementSent: boolean
  preAnnouncementSentAt: string | null
  requirements: Record<string, unknown> | null
  contacts: Record<string, unknown> | null
  billingInfo: Record<string, unknown> | null
  routeDistanceMeters: number | null
  routeDurationSeconds: number | null
  routePolyline: string | null
  routeCalculatedAt: string | null
  routeProvider: string | null
  preparationStatus: string
  status: DbMissionStatus
  notes: string | null
  assignment?: {
    id: string
    scheduledDate: string
    plannedEndAt: string | null
    planningRowId: string | null
    driverId: string | null
    truckId: string | null
  } | null
}
type ApiAssignment = {
  id: string
  missionId: string
  planningRowId: string | null
  driverId: string | null
  truckId: string | null
  trailerId: string | null
  plannedEndAt: string | null
  trailerChangePlanned: boolean
  day: DbPlanningDay
  scheduledDate: string
  sortOrder: number
  approachDistanceMeters: number | null
  approachDurationSeconds: number | null
  approachPolyline: string | null
  approachCalculatedAt: string | null
  approachProvider: string | null
  trailer?: ApiTrailer | null
}
type ApiPlanningRow = {
  id: string
  weekStartDate: string
  sortOrder: number
  driverId: string | null
  truckId: string | null
  trailerId?: string | null
  pairLocked?: boolean
  assignmentOrigin?: 'MANUAL' | 'AUTOMATIC' | 'ADJUSTED'
  isExceptionalReplacement?: boolean
  usualTruckIdSnapshot?: string | null
  driver?: ApiDriver | null
  truck?: ApiTruck | null
  trailer?: ApiTrailer | null
}

const trailerTypeLabels: Record<TrailerType, string> = {
  CURTAINSIDER: 'Bâchée',
  FLATBED: 'Plateau',
  REFRIGERATED: 'Frigorifique',
  CONTAINER: 'Container',
  BOX: 'Fourgon',
  OTHER: 'Autre',
}
const planningDays = dispatchDays.filter(
  (day): day is Exclude<DispatchDay, 'saturday' | 'sunday'> =>
    day !== 'saturday' && day !== 'sunday'
)
type DispatchOverviewResponse = {
  drivers: ApiDriver[]
  trucks: ApiTruck[]
  trailers: ApiTrailer[]
  availableTrucks: ApiTruck[]
  missions: ApiMission[]
  pendingMissions: ApiMission[]
  missionScope?: {
    periodStart: string
    periodEnd: string
    visibleMissionIds: string[]
    includedMissionIds: string[]
    exclusions: Array<{
      missionId: string
      reference: string
      pickupDate: string | null
      code: string
      reason: string
    }>
    counts: {
      visible: number
      included: number
      outsidePeriod: number
      missingPickupDate: number
      excludedByStatus: number
      alreadyAssigned: number
      forcedExisting: number
    }
  }
  assignments: ApiAssignment[]
  planningRows: ApiPlanningRow[]
  truckPositions: TruckPosition[]
}
type PlanningInitializationResponse = {
  initialized: boolean
  sourceWeekStartDate: string | null
  createdRowCount: number
}
type PlanningRowResponse = {
  row: ApiPlanningRow
  affectedRows?: ApiPlanningRow[]
}
type CreateMissionResponse = {
  mission: ApiMission
  warnings?: string[]
  preparationStatus?: string
}
type TruckResponse = {
  truck: ApiTruck
}
type DriverResponse = {
  driver: ApiDriver & {
    trucks?: ApiTruck[]
  }
  trucks?: ApiTruck[]
}
type TrailerResponse = {
  trailer: ApiTrailer
  detachedTrailer?: ApiTrailer | null
}

const missionStatusByDbStatus: Record<DbMissionStatus, MissionStatus> = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  ISSUE: 'issue',
  CANCELLED: 'cancelled',
}

const dispatchDayByDbDay: Record<DbPlanningDay, DispatchDay> = {
  MONDAY: 'monday',
  TUESDAY: 'tuesday',
  WEDNESDAY: 'wednesday',
  THURSDAY: 'thursday',
  FRIDAY: 'friday',
  SATURDAY: 'saturday',
  SUNDAY: 'sunday',
}

const dbStatusByMissionStatus: Record<MissionStatus, DbMissionStatus> = {
  pending: 'PENDING',
  assigned: 'ASSIGNED',
  in_progress: 'IN_PROGRESS',
  done: 'DONE',
  issue: 'ISSUE',
  cancelled: 'CANCELLED',
}

const dbDayByDispatchDay: Record<DispatchDay, DbPlanningDay> = {
  monday: 'MONDAY',
  tuesday: 'TUESDAY',
  wednesday: 'WEDNESDAY',
  thursday: 'THURSDAY',
  friday: 'FRIDAY',
  saturday: 'SATURDAY',
  sunday: 'SUNDAY',
}

async function postDispatchAction(
  endpoint: string,
  body: Record<string, unknown>
) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const payload = (await response.json().catch(() => null)) as
    | { error?: unknown; warnings?: unknown }
    | null
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : `${endpoint} returned ${response.status}`
    )
  }
  return payload
}

function getInitialPlacements(missions: Mission[]): MissionPlacements {
  return missions.reduce<MissionPlacements>((placements, mission) => {
    placements[mission.id] = null
    return placements
  }, {})
}

function getInitialTruckAssignments(trucks: Truck[]): TruckAssignments {
  return trucks.reduce<TruckAssignments>((assignments, truck) => {
    assignments[truck.id] = null
    return assignments
  }, {})
}

function getInitialMissionStatuses(missions: Mission[]): MissionStatuses {
  return missions.reduce<MissionStatuses>((statuses, mission) => {
    statuses[mission.id] = mission.status
    return statuses
  }, {})
}

function getInitialPlacementsFromAssignments(
  missions: Mission[],
  assignments: ApiAssignment[]
): MissionPlacements {
  const placements = getInitialPlacements(missions)

  assignments.forEach((assignment) => {
    placements[assignment.missionId] = {
      assignmentId: assignment.id,
      planningRowId: assignment.planningRowId,
      driverId: assignment.driverId,
      truckId: assignment.truckId,
      trailerId: assignment.trailerId,
      trailerChangePlanned: assignment.trailerChangePlanned,
      day: dispatchDayByDbDay[assignment.day],
      scheduledDate: assignment.scheduledDate,
      plannedEndAt: assignment.plannedEndAt,
      approachDistanceMeters: assignment.approachDistanceMeters ?? undefined,
      approachDurationSeconds: assignment.approachDurationSeconds ?? undefined,
      approachPolyline: assignment.approachPolyline ?? undefined,
      approachCalculatedAt: assignment.approachCalculatedAt ?? undefined,
      approachProvider: assignment.approachProvider ?? undefined,
    }
  })

  return placements
}

function mapApiMission(mission: ApiMission): Mission {
  return {
    id: mission.id,
    reference: mission.reference,
    clientName: mission.clientName ?? 'Client à compléter',
    shortLabel: mission.title ?? mission.clientName ?? 'Mission à compléter',
    pickupCity: mission.pickupCity ?? 'À compléter',
    deliveryCity: mission.deliveryCity ?? 'À compléter',
    pickupAddress: mission.pickupAddress ?? undefined,
    deliveryAddress: mission.deliveryAddress ?? undefined,
    pickupPlaceId: mission.pickupPlaceId ?? undefined,
    deliveryPlaceId: mission.deliveryPlaceId ?? undefined,
    pickupLat: mission.pickupLat ?? undefined,
    pickupLng: mission.pickupLng ?? undefined,
    deliveryLat: mission.deliveryLat ?? undefined,
    deliveryLng: mission.deliveryLng ?? undefined,
    estimatedKm: mission.estimatedKm ?? 0,
    clientReference: mission.clientReference ?? undefined,
    cmrNumber: mission.cmrNumber ?? undefined,
    deliveryNoteNumber: mission.deliveryNoteNumber ?? undefined,
    pickupDate: mission.pickupDate ?? undefined,
    deliveryDate: mission.deliveryDate ?? undefined,
    requiredTruckType: mission.requiredTruckType ?? undefined,
    priceAmount: mission.priceAmount ?? undefined,
    priceCurrency: mission.priceCurrency ?? undefined,
    paymentTerms: mission.paymentTerms ?? undefined,
    preAnnouncementRequired: mission.preAnnouncementRequired,
    preAnnouncementSent: mission.preAnnouncementSent,
    preAnnouncementSentAt: mission.preAnnouncementSentAt ?? undefined,
    requirements: mission.requirements ?? undefined,
    contacts: mission.contacts ?? undefined,
    billingInfo: mission.billingInfo ?? undefined,
    routeDistanceMeters: mission.routeDistanceMeters ?? undefined,
    routeDurationSeconds: mission.routeDurationSeconds ?? undefined,
    routePolyline: mission.routePolyline ?? undefined,
    routeCalculatedAt: mission.routeCalculatedAt ?? undefined,
    routeProvider: mission.routeProvider ?? undefined,
    preparationStatus: mission.preparationStatus,
    status: missionStatusByDbStatus[mission.status],
    notes: mission.notes ?? undefined,
    assignment: mission.assignment ?? null,
  }
}

function mapApiTruck(truck: ApiTruck): Truck {
  return {
    id: truck.id,
    plateNumber: truck.plateNumber,
    brand: truck.brand ?? undefined,
    model: truck.model ?? undefined,
    driverId: truck.driverId,
    gpsDeviceId: truck.gpsDeviceId,
    status: truck.status,
    statusUpdatedAt: truck.statusUpdatedAt,
    technicalInspectionDate: truck.technicalInspectionDate,
    technicalInspectionExpiresAt: truck.technicalInspectionExpiresAt,
    returnToBaseDistanceMeters: truck.returnToBaseDistanceMeters ?? undefined,
    returnToBaseDurationSeconds: truck.returnToBaseDurationSeconds ?? undefined,
    returnToBasePolyline: truck.returnToBasePolyline ?? undefined,
    returnToBaseCalculatedAt: truck.returnToBaseCalculatedAt ?? undefined,
    returnToBaseProvider: truck.returnToBaseProvider ?? undefined,
    category: truck.category ?? null,
    capacityKg: truck.capacityKg ?? null,
    couplingType: truck.couplingType ?? null,
    activeMaintenance: truck.activeMaintenance ?? null,
  }
}

function mapApiTrailer(trailer: ApiTrailer): Trailer {
  return {
    id: trailer.id,
    plateNumber: trailer.plateNumber,
    type: trailer.type,
    status: trailer.status,
    loadStatus: trailer.loadStatus ?? 'EMPTY',
    cargoType: trailer.cargoType,
    compatibleCargoTypes: trailer.compatibleCargoTypes,
    cargoDescription: trailer.cargoDescription,
    technicalInspectionDate: trailer.technicalInspectionDate,
    technicalInspectionExpiresAt: trailer.technicalInspectionExpiresAt,
    truckId: trailer.truckId,
    notes: trailer.notes,
    capacityKg: trailer.capacityKg ?? null,
    couplingType: trailer.couplingType ?? null,
    custodyState: trailer.custodyState ?? 'EMPTY',
    custodyVersion: trailer.custodyVersion ?? 0,
    activeMaintenance: trailer.activeMaintenance ?? null,
  }
}

function getTrailerCustodyLabel(state: Trailer['custodyState']) {
  switch (state) {
    case 'RELAY_AVAILABLE':
      return 'Chargée · à la base · relais possible'
    case 'IN_MISSION':
      return 'Chargée · en mission'
    case 'AT_BASE':
      return 'Chargée · à la base'
    case 'DELIVERED':
      return 'Livrée'
    case 'IMMOBILIZED':
      return 'Indisponible'
    case 'LOADED':
      return 'Chargée'
    default:
      return 'Vide · disponible'
  }
}

function mapApiDriver(driver: ApiDriver): Driver {
  return {
    id: driver.id,
    name: driver.name,
    phone: driver.phone ?? undefined,
    email: driver.email,
    username: driver.username ?? null,
    status: driver.status,
    hourlyCostAmount: driver.hourlyCostAmount ?? null,
    hourlyCostCurrency: driver.hourlyCostCurrency ?? 'EUR',
    operationalSummary: driver.operationalSummary ?? null,
  }
}

function mapApiPlanningRow(row: ApiPlanningRow): PlanningRow {
  return {
    id: row.id,
    weekStartDate: row.weekStartDate,
    sortOrder: row.sortOrder,
    driverId: row.driverId,
    truckId: row.truckId,
    trailerId: row.trailerId ?? null,
    pairLocked: row.pairLocked ?? false,
    assignmentOrigin: row.assignmentOrigin ?? 'MANUAL',
    isExceptionalReplacement: row.isExceptionalReplacement ?? false,
    usualTruckIdSnapshot: row.usualTruckIdSnapshot ?? null,
  }
}

function isDispatchDay(value: string | undefined): value is DispatchDay {
  return dispatchDays.some((day) => day === value)
}

function parseCellDroppableId(
  droppableId: string
): { planningRowId: string; day: DispatchDay } | null {
  const [prefix, planningRowId, day] = droppableId.split(':')

  if (prefix !== 'cell' || !planningRowId || !isDispatchDay(day)) {
    return null
  }

  return {
    planningRowId,
    day,
  }
}

const dispatchCollisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args)

  if (args.active.data.current?.type !== 'mission') {
    return collisions
  }

  const dispatchCellCollision = collisions.find((collision) =>
    String(collision.id).startsWith('cell:')
  )

  return dispatchCellCollision ? [dispatchCellCollision] : collisions
}

function getVisibleStatus(
  mission: Mission,
  isAssigned: boolean
): MissionStatus {
  if (!isAssigned || mission.status !== 'pending') {
    return mission.status
  }

  return 'assigned'
}

function getPlanningInitializationNotice(
  sourceWeekStartDate: string | null,
  createdRowCount: number
) {
  const sourceDate = sourceWeekStartDate
    ? new Date(sourceWeekStartDate)
    : null
  const sourceLabel =
    sourceDate && Number.isFinite(sourceDate.getTime())
      ? new Intl.DateTimeFormat('fr-LU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(sourceDate)
      : 'la dernière semaine disponible'

  return `Planning initialisé depuis ${sourceLabel} · ${createdRowCount} ligne${
    createdRowCount > 1 ? 's' : ''
  } reprise${createdRowCount > 1 ? 's' : ''}.`
}

function buildTruckDropId(rowId: string) {
  return `truck-row:${rowId}`
}

function parseTruckDropId(droppableId: string) {
  const [prefix, rowId] = droppableId.split(':')

  if (prefix !== 'truck-row' || !rowId) {
    return null
  }

  return rowId
}

function buildTrailerDropId(rowId: string) {
  return `trailer-row:${rowId}`
}

function parseTrailerDropId(droppableId: string) {
  const [prefix, rowId] = droppableId.split(':')

  if (prefix !== 'trailer-row' || !rowId) {
    return null
  }

  return rowId
}

function buildDriverDropId(rowId: string) {
  return `driver-row:${rowId}`
}

function parseDriverDropId(droppableId: string) {
  const [prefix, rowId] = droppableId.split(':')

  if (prefix !== 'driver-row' || !rowId) {
    return null
  }

  return rowId
}

type TruckAssignmentCellProps = {
  onEdit?: (truck: Truck) => void
  rowId: string
  trailer?: Trailer | null
  truck: Truck | null
  dragDisabled?: boolean
}

function TruckAssignmentCell({
  onEdit,
  rowId,
  trailer,
  truck,
  dragDisabled = false,
}: TruckAssignmentCellProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: buildTruckDropId(rowId),
    data: {
      type: 'truck-drop',
      rowId,
    },
    disabled: dragDisabled,
  })

  return (
    <td className="h-[104px] w-[142px] border-l border-black/10 p-1 align-top">
      <div
        ref={setNodeRef}
        className={[
          'h-[96px] rounded-lg border border-dashed p-1 transition',
          isOver && !dragDisabled
            ? 'ring-lime-200/35 border-lime-300 bg-lime-50/70 ring-4'
            : 'bg-white/35 border-black/10',
        ].join(' ')}
      >
        {truck ? (
          <TruckCard
            truck={truck}
            trailer={trailer ?? undefined}
            dense
            className="h-full w-full overflow-y-auto"
            onEdit={onEdit}
            dragDisabled={dragDisabled}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-md text-center text-[11px] font-medium text-[#9aa090]">
            Aucun camion
          </div>
        )}
      </div>
    </td>
  )
}

type TrailerAssignmentCellProps = {
  onEdit?: (trailer: Trailer) => void
  rowId: string
  trailer: Trailer | null
  truck?: Truck | null
  dragDisabled?: boolean
}

function TrailerAssignmentCell({
  onEdit,
  rowId,
  trailer,
  truck,
  dragDisabled = false,
}: TrailerAssignmentCellProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: buildTrailerDropId(rowId),
    data: {
      type: 'trailer-drop',
      rowId,
    },
    disabled: dragDisabled,
  })

  return (
    <td className="h-[104px] w-[142px] border-l border-black/10 p-1 align-top">
      <div
        ref={setNodeRef}
        className={[
          'h-[96px] rounded-lg border border-dashed p-1 transition',
          isOver && !dragDisabled
            ? 'ring-lime-200/35 border-lime-300 bg-lime-50/70 ring-4'
            : 'bg-white/35 border-black/10',
        ].join(' ')}
      >
        {trailer ? (
          <TrailerCard
            trailer={trailer}
            truck={truck ?? undefined}
            dense
            className="h-full w-full overflow-y-auto"
            onEdit={onEdit}
            dragDisabled={dragDisabled}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-md text-center text-[11px] font-medium text-[#9aa090]">
            Aucune remorque
          </div>
        )}
      </div>
    </td>
  )
}

function AddPlanningRowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Ajouter une ligne planning"
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-[11px] bg-[#11130F] text-base font-semibold leading-none text-white shadow-[0_10px_26px_rgba(17,18,15,0.12)] transition hover:-translate-y-0.5 hover:bg-[#B9FF4A] hover:text-[#11130F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/70"
      style={{ border: 0 }}
    >
      +
    </button>
  )
}

function PlanningDriverCell({
  driver,
  hasWork = false,
  onEditDriver,
  onRemoveRow,
  rowId,
  dragDisabled = false,
}: {
  rowId: string
  driver?: Driver
  hasWork?: boolean
  onEditDriver?: (driver: Driver) => void
  onRemoveRow: (rowId: string) => void
  dragDisabled?: boolean
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: buildDriverDropId(rowId),
    data: {
      type: 'driver-drop',
      rowId,
    },
    disabled: dragDisabled,
  })
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: driver?.id ?? `driver-placeholder:${rowId}`,
    data: {
      type: 'driver',
    },
    disabled: !driver || dragDisabled,
  })
  const style = {
    transform: CSS.Translate.toString(transform),
  }
  const activation = useResourceCardActivation(
    driver,
    isDragging,
    onEditDriver
  )
  const placeholder = hasWork ? 'Chauffeur requis' : 'Déposer chauffeur'

  return (
    <div
      ref={setNodeRef}
      {...activation}
      role={driver && onEditDriver ? 'button' : undefined}
      tabIndex={driver && onEditDriver ? 0 : undefined}
      aria-label={
        driver && onEditDriver ? `Ouvrir la fiche de ${driver.name}` : undefined
      }
      className={[
        'relative flex h-[96px] rounded-lg border px-1.5 py-1 transition',
        driver
          ? 'items-center justify-start pr-6 text-left'
          : 'items-center justify-center text-center',
        driver
          ? 'cursor-pointer border-black/5 bg-white/80 shadow-[0_1px_8px_rgba(17,18,15,0.035)] hover:bg-white hover:ring-1 hover:ring-black/10'
          : isOver
          ? 'ring-lime-200/35 border-dashed border-lime-300 bg-lime-50/70 ring-4'
          : hasWork
          ? 'border-dashed border-red-200 bg-red-50/60'
          : 'border-dashed border-black/10 bg-white/25',
      ].join(' ')}
    >
      {driver ? (
        <div
          ref={setDraggableNodeRef}
          style={style}
          {...listeners}
          {...attributes}
          className={[
            'min-w-0 text-left transition',
            dragDisabled ? 'cursor-pointer' : 'cursor-grab touch-none active:cursor-grabbing',
            isDragging ? 'opacity-35' : 'opacity-100',
          ].join(' ')}
        >
          <DriverOperationalCardContent
            planning
            driver={driver}
            inMission={hasWork}
          />
        </div>
      ) : (
        <span
          className={[
            'text-[11px] font-semibold',
            hasWork ? 'text-red-500' : 'text-[#9aa090]',
          ].join(' ')}
        >
          {placeholder}
        </span>
      )}

      {driver && onEditDriver && false ? (
        <button
          type="button"
          aria-label={`Modifier ${driver!.name}`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onEditDriver?.(driver!)
          }}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.04] text-[0px] font-bold text-[#6f756b] transition after:content-['✎'] after:text-sm hover:bg-lime-100 hover:text-[#243600] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300"
          style={{ border: 0 }}
        >
          ×
        </button>
      ) : null}

      {!dragDisabled ? <button
        type="button"
        aria-label="Supprimer la ligne"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onRemoveRow(rowId)
        }}
        className={[
          'absolute top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/[0.035] text-xs font-bold text-[#8a9085] transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200',
          driver ? 'right-1' : 'left-1',
        ].join(' ')}
        style={{ border: 0 }}
      >
        ×
      </button> : null}
    </div>
  )
}

function PlanningRowView({
  driver,
  missionsByDay,
  onDriverEdit,
  onMissionClick,
  onRemoveRow,
  onTrailerEdit,
  onTruckEdit,
  row,
  trailer,
  truck,
  dragDisabled = false,
  canManageDrivers = false,
  canManageTrucks = false,
  canManageTrailers = false,
  previewMissionsByDay,
}: {
  driver?: Driver
  missionsByDay: Record<DispatchDay, Mission[]>
  onDriverEdit: (driver: Driver) => void
  onMissionClick: (mission: Mission) => void
  onRemoveRow: (rowId: string) => void
  onTrailerEdit: (trailer: Trailer) => void
  onTruckEdit: (truck: Truck) => void
  row: PlanningRow
  trailer?: Trailer
  truck?: Truck
  dragDisabled?: boolean
  canManageDrivers?: boolean
  canManageTrucks?: boolean
  canManageTrailers?: boolean
  previewMissionsByDay?: Record<
    DispatchDay,
    Array<{
      id: string
      reference: string
      conditional: boolean
      timeLabel: string
    }>
  >
}) {
  const hasMissions = planningDays.some((day) => missionsByDay[day].length > 0)
  const hasWork = Boolean(row.truckId || row.trailerId) || hasMissions

  return (
    <tr
      data-planning-row-id={row.id}
      className="group h-[104px] border-b border-black/10 last:border-b-0"
    >
      <th className="h-[104px] w-[158px] p-1 text-left align-top">
        <PlanningDriverCell
          rowId={row.id}
          driver={driver}
          hasWork={hasWork}
          onEditDriver={canManageDrivers ? onDriverEdit : undefined}
          onRemoveRow={onRemoveRow}
          dragDisabled={dragDisabled}
        />
      </th>
      <TruckAssignmentCell
        rowId={row.id}
        trailer={trailer}
        truck={truck ?? null}
        onEdit={canManageTrucks ? onTruckEdit : undefined}
        dragDisabled={dragDisabled}
      />
      <TrailerAssignmentCell
        rowId={row.id}
        trailer={trailer ?? null}
        truck={truck}
        onEdit={canManageTrailers ? onTrailerEdit : undefined}
        dragDisabled={dragDisabled}
      />
      {planningDays.map((day) => (
        <DispatchCell
          key={buildDispatchCellId(row.id, day)}
          driverId={row.id}
          day={day}
          missions={missionsByDay[day]}
          onMissionClick={onMissionClick}
          dragDisabled={dragDisabled}
          previewMissions={previewMissionsByDay?.[day] ?? []}
        />
      ))}
    </tr>
  )
}

function DriverDragPreview({ driver }: { driver: Driver }) {
  return (
    <div className="rounded-[22px] border border-black/[0.05] bg-white px-5 py-3 shadow-[0_18px_45px_rgba(17,18,15,0.14)]">
      <p className="truncate text-sm font-semibold text-[#11130F]">
        {driver.name}
      </p>
      {driver.phone ? (
        <p className="mt-1 truncate text-[11px] font-semibold text-[#72786d]">
          {driver.phone}
        </p>
      ) : null}
    </div>
  )
}

function DragPreviewCard({
  label,
  detail,
}: {
  label: string
  detail: string
}) {
  return (
    <div className="w-[220px] rounded-[22px] border border-black/[0.05] bg-white px-5 py-3 shadow-[0_18px_45px_rgba(17,18,15,0.14)]">
      <p className="truncate text-sm font-semibold uppercase tracking-[0.08em] text-[#11130F]">
        {label}
      </p>
      <p className="mt-1 truncate text-[11px] font-semibold text-[#72786d]">
        {detail}
      </p>
    </div>
  )
}

export function WeeklyDispatchBoard({
  capabilities = fullDispatchCapabilities,
  initialView = 'planning',
  initialParkOverview = null,
}: {
  capabilities?: DispatchCapabilities
  initialView?: ViewMode
  initialParkOverview?: ParkOverviewDTO | null
}) {
  const router = useRouter()
  const [dispatchData, setDispatchData] = useState<DispatchOverviewState>({
    drivers: [],
    trucks: [],
    trailers: [],
    missions: [],
    planningRows: [],
    truckPositions: [],
  })
  const [placements, setPlacements] = useState<MissionPlacements>(() =>
    getInitialPlacements([])
  )
  const [missionStatuses, setMissionStatuses] = useState<MissionStatuses>(() =>
    getInitialMissionStatuses([])
  )
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null)
  const lastDragDestinationRef = useRef<{
    key: string | null
    repeatedCalls: number
    startedAt: number
    warned: boolean
  }>({
    key: null,
    repeatedCalls: 0,
    startedAt: 0,
    warned: false,
  })
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(
    null
  )
  const [isLoadingOverview, setIsLoadingOverview] = useState(true)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [planningInitializationNotice, setPlanningInitializationNotice] =
    useState<string | null>(null)
  const [manualPlanningNotice, setManualPlanningNotice] = useState<{
    kind: 'success' | 'warning' | 'error'
    message: string
  } | null>(null)
  const [selectedWeekStartDate, setSelectedWeekStartDate] = useState(() =>
    getWeekStartDate()
  )
  useEffect(() => {
    if (!router.isReady) return
    const weekStart = router.query.weekStart
    const parsed = typeof weekStart === 'string' ? parseWeekStartParam(weekStart) : null
    if (parsed) setSelectedWeekStartDate(parsed)
  }, [router.isReady])

  function handleWeekChange(weekStartDate: Date) {
    setSelectedWeekStartDate(weekStartDate)
    void router.replace(
      { pathname: router.pathname, query: { ...router.query, weekStart: formatDateParam(weekStartDate) } },
      undefined,
      { shallow: true, scroll: false }
    )
  }
  const [viewMode, setViewMode] = useState<ViewMode>(initialView)
  const application = useGerardApplication()
  const hiddenNavigationItems = application.features.hiddenNavigationItems
  // Les vues accessibles dépendent des droits : la barre n'affiche que celles-là.
  const viewOptions = useMemo(
    () => [
      ...(capabilities.canViewPlanning ? [{ value: 'planning' as const, label: 'Planning' }] : []),
      ...(capabilities.canViewMap ? [{ value: 'map' as const, label: 'Carte' }] : []),
      ...(capabilities.canViewProfitability
        ? [{ value: 'profitability' as const, label: 'Rentabilité' }]
        : []),
      ...(capabilities.canViewInvoices ? [{ value: 'invoices' as const, label: 'Factures' }] : []),
      ...(capabilities.canViewPark ? [{ value: 'park' as const, label: application.terminology.park }] : []),
    ].filter((item) => !hiddenNavigationItems.includes(item.value)),
    [application.terminology.park, capabilities, hiddenNavigationItems],
  )
  useEffect(() => {
    if (!viewOptions.some((option) => option.value === viewMode) && viewOptions[0]) {
      setViewMode(viewOptions[0].value)
    }
  }, [viewMode, viewOptions])
  // L'analyse Gerard est déclenchée depuis la barre : le panneau expose son action.
  const analyzePlanningRef = useRef<(() => void) | null>(null)
  const [isPlanningFullscreen, setIsPlanningFullscreen] = useState(false)
  const [resourceEditRequest, setResourceEditRequest] =
    useState<ResourceEditRequest | null>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  const [poolLocatorRequest, setPoolLocatorRequest] =
    useState<PoolLocatorRequest | null>(null)
  const { requestHighlight } = useLocatorHighlight()
  // Incrémenté à chaque enregistrement d'une donnée source (chauffeur, camion,
  // remorque, mission) : sert à invalider la simulation de planification auto.
  const [dispatchDataVersion, setDispatchDataVersion] = useState(0)
  // Compteur dédié au panneau Imports : incrémenté dès qu'une affectation
  // change, pour que les cartes basculent de « Créé » vers « Assigné ».
  const [importsSyncVersion, setImportsSyncVersion] = useState(0)

  useEffect(() => {
    const handleRegulatoryChange = () => {
      setDispatchDataVersion((version) => version + 1)
      setAutoPlanningPreview(null)
      setAutoPlanningNotice(
        'Données chauffeur modifiées — relancez la simulation.'
      )
    }
    window.addEventListener(
      'driver-regulatory-changed',
      handleRegulatoryChange
    )
    return () => {
      window.removeEventListener(
        'driver-regulatory-changed',
        handleRegulatoryChange
      )
    }
  }, [])
  const [clientProfiles, setClientProfiles] = useState<ClientProfile[]>([])
  const [isCreateMissionOpen, setIsCreateMissionOpen] = useState(false)
  const [isImportedMissionsOpen, setIsImportedMissionsOpen] = useState(false)
  const [isClientProfilesOpen, setIsClientProfilesOpen] = useState(false)
  const [isAutoPlanningOpen, setIsAutoPlanningOpen] = useState(false)
  const [autoPlanningPreview, setAutoPlanningPreview] =
    useState<AutoPlanningPreview | null>(null)
  const [autoPlanningNotice, setAutoPlanningNotice] = useState<string | null>(
    null
  )

  useEffect(() => {
    if (!isPlanningFullscreen) return

    const handleFullscreenKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPlanningFullscreen(false)
      }
    }

    window.addEventListener('keydown', handleFullscreenKeyDown)
    return () => window.removeEventListener('keydown', handleFullscreenKeyDown)
  }, [isPlanningFullscreen])

  const handleViewChange = useCallback(
    (nextView: ViewMode) => {
      setViewMode(nextView)
      void router.replace(
        { pathname: router.pathname, query: { ...router.query, view: nextView } },
        undefined,
        { shallow: true, scroll: false }
      )
    },
    [router]
  )

  const loadOverview = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setIsLoadingOverview(true)
        setOverviewError(null)

        const weekStart = formatDateParam(selectedWeekStartDate)
        const response = await fetch(
          `/api/dispatch/overview?weekStart=${weekStart}`,
          {
            signal,
          }
        )

        if (!response.ok) {
          throw new Error(`Overview API returned ${response.status}`)
        }

        const overview = (await response.json()) as DispatchOverviewResponse
        const nextDrivers = overview.drivers.map(mapApiDriver)
        const nextTrucks = overview.trucks.map(mapApiTruck)
        const nextTrailers = overview.trailers.map(mapApiTrailer)
        const assignmentByMissionId = new Map(
          overview.assignments.map((assignment) => [
            assignment.missionId,
            assignment,
          ])
        )
        const nextMissions = overview.missions.map((mission) => {
          const mapped = mapApiMission(mission)
          const assignment = assignmentByMissionId.get(mission.id)
          return {
            ...mapped,
            trailerPlateNumber: assignment?.trailer?.plateNumber ?? undefined,
            trailerId: assignment?.trailer?.id ?? undefined,
            trailerCustodyState:
              assignment?.trailer?.custodyState ?? undefined,
            trailerCustodyLabel: assignment?.trailer
              ? getTrailerCustodyLabel(assignment.trailer.custodyState)
              : undefined,
            trailerRelayAvailable:
              assignment?.trailer?.custodyState === 'RELAY_AVAILABLE',
            trailerCustodyEvents:
              assignment?.trailer?.custodyEvents ?? undefined,
          }
        })
        const nextPlanningRows = overview.planningRows.map(mapApiPlanningRow)

        setDispatchData({
          drivers: nextDrivers,
          trucks: nextTrucks,
          trailers: nextTrailers,
          missions: nextMissions,
          planningRows: nextPlanningRows,
          truckPositions: overview.truckPositions,
        })
        setPlanningInitializationNotice(null)
        setPlacements(
          getInitialPlacementsFromAssignments(
            nextMissions,
            overview.assignments
          )
        )
        setMissionStatuses(getInitialMissionStatuses(nextMissions))
        setSelectedMissionId(null)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        setOverviewError(
          error instanceof Error
            ? error.message
            : 'Impossible de charger les données du dispatch.'
        )
      } finally {
        setIsLoadingOverview(false)
      }
    },
    [selectedWeekStartDate]
  )

  useEffect(() => {
    if (!capabilities.canViewPlanning) {
      setIsLoadingOverview(false)
      return
    }
    const controller = new AbortController()

    void loadOverview(controller.signal)

    return () => controller.abort()
  }, [capabilities.canViewPlanning, loadOverview])

  useEffect(() => {
    if (!capabilities.canViewPlanning) return
    const controller = new AbortController()

    async function loadClientProfiles() {
      try {
        const response = await fetch('/api/dispatch/client-profiles', {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Client profiles API returned ${response.status}`)
        }

        const payload = (await response.json()) as {
          clientProfiles?: Record<string, unknown>[]
        }

        setClientProfiles(
          (payload.clientProfiles ?? []).map((profile) =>
            normalizeClientProfile(profile)
          )
        )
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        console.error('Unable to load client profiles', error)
      }
    }

    void loadClientProfiles()

    return () => controller.abort()
  }, [capabilities.canViewPlanning])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 130,
        tolerance: 8,
      },
    })
  )

  const driversById = useMemo(() => {
    return dispatchData.drivers.reduce<Record<string, Driver>>(
      (drivers, driver) => {
        drivers[driver.id] = driver
        return drivers
      },
      {}
    )
  }, [dispatchData.drivers])

  const trucksById = useMemo(() => {
    return dispatchData.trucks.reduce<Record<string, Truck>>(
      (trucks, truck) => {
        trucks[truck.id] = truck
        return trucks
      },
      {}
    )
  }, [dispatchData.trucks])

  const trailersById = useMemo(() => {
    return dispatchData.trailers.reduce<Record<string, Trailer>>(
      (trailers, trailer) => {
        trailers[trailer.id] = trailer
        return trailers
      },
      {}
    )
  }, [dispatchData.trailers])

  const rowById = useMemo(() => {
    return dispatchData.planningRows.reduce<Record<string, PlanningRow>>(
      (rows, row) => {
        rows[row.id] = row
        return rows
      },
      {}
    )
  }, [dispatchData.planningRows])

  const trailersByTruckId = useMemo(() => {
    return dispatchData.trailers.reduce<Record<string, Trailer>>(
      (trailers, trailer) => {
        if (trailer.truckId) {
          trailers[trailer.truckId] = trailer
        }

        return trailers
      },
      {}
    )
  }, [dispatchData.trailers])

  const assignedDriverIds = useMemo(
    () =>
      new Set(
        dispatchData.planningRows
          .map((row) => row.driverId)
          .filter((driverId): driverId is string => Boolean(driverId))
      ),
    [dispatchData.planningRows]
  )

  const assignedTruckIds = useMemo(
    () =>
      new Set(
        dispatchData.planningRows
          .map((row) => row.truckId)
          .filter((truckId): truckId is string => Boolean(truckId))
      ),
    [dispatchData.planningRows]
  )

  const assignedTrailerIds = useMemo(() => {
    const trailerIds = new Set<string>()

    dispatchData.planningRows.forEach((row) => {
      if (row.trailerId) {
        trailerIds.add(row.trailerId)
      }
    })

    return trailerIds
  }, [dispatchData.planningRows])

  const truckAssignments = useMemo(() => {
    const assignments = getInitialTruckAssignments(dispatchData.trucks)

    dispatchData.planningRows.forEach((row) => {
      if (row.truckId) {
        assignments[row.truckId] = row.driverId
      }
    })

    return assignments
  }, [dispatchData.planningRows, dispatchData.trucks])

  const visiblePlanningRows = useMemo(
    () =>
      [...dispatchData.planningRows].sort(
        (firstRow, secondRow) => firstRow.sortOrder - secondRow.sortOrder
      ),
    [dispatchData.planningRows]
  )

  const missions = useMemo(
    () =>
      dispatchData.missions.map((mission) => ({
        ...mission,
        // `missionStatuses` est un Record : une mission absente de la table
        // (ajoutée ou mise à jour par un autre chemin) y renvoie `undefined`,
        // ce que TypeScript ne signale pas faute de `noUncheckedIndexedAccess`.
        // On retombe donc sur le statut canonique porté par l'API.
        status: missionStatuses[mission.id] ?? mission.status,
      })),
    [dispatchData.missions, missionStatuses]
  )

  const activeMission =
    activeDrag?.type === 'mission'
      ? missions.find((mission) => mission.id === activeDrag.id) ?? null
      : null
  const activeTruck =
    activeDrag?.type === 'truck'
      ? dispatchData.trucks.find((truck) => truck.id === activeDrag.id) ?? null
      : null
  const activeDriver =
    activeDrag?.type === 'driver'
      ? dispatchData.drivers.find((driver) => driver.id === activeDrag.id) ??
        null
      : null
  const activeTrailer =
    activeDrag?.type === 'trailer'
      ? dispatchData.trailers.find((trailer) => trailer.id === activeDrag.id) ??
        null
      : null

  // Le bandeau se calcule sur l'affectation RÉELLE de la mission
  // (MissionAssignment), jamais sur les seules affectations de la semaine
  // affichée : changer de semaine ne peut plus réintroduire une mission déjà
  // planifiée. Le statut métier ne pilote jamais l'appartenance au pool.
  const classifiedMissions = useMemo(
    () =>
      classifyPlanningPoolMissions(
        missions.map((mission) => ({
          mission,
          status: mission.status,
          preparationStatus: mission.preparationStatus,
          pickupDate: mission.pickupDate,
          deliveryDate: mission.deliveryDate,
          // Une affectation posée dans la session courante fait foi
          // immédiatement, avant même le prochain rechargement.
          assignment: placements[mission.id]
            ? {
                scheduledDate: placements[mission.id]?.scheduledDate ?? null,
                plannedEndAt: placements[mission.id]?.plannedEndAt ?? null,
                planningRowId: placements[mission.id]?.planningRowId ?? null,
                driverId: placements[mission.id]?.driverId ?? null,
                truckId: placements[mission.id]?.truckId ?? null,
              }
            : mission.assignment ?? null,
        })),
        {
          weekStart: selectedWeekStartDate,
          weekEnd: getWeekEndDate(selectedWeekStartDate),
        }
      ),
    [missions, placements, selectedWeekStartDate]
  )

  // Un seul regroupement alimente le rail, les compteurs et le sélecteur :
  // l'interface ne recalcule jamais la classification de son côté.
  const missionBuckets = useMemo(() => {
    const groups = groupPlanningBuckets(classifiedMissions)
    return {
      PLANNABLE: groups.PLANNABLE.map((entry) => entry.mission),
      BACKLOG: groups.BACKLOG.map((entry) => entry.mission),
      TO_VERIFY: groups.TO_VERIFY.map((entry) => entry.mission),
      UPCOMING: groups.UPCOMING.map((entry) => entry.mission),
      ANOMALY: groups.ANOMALY.map((entry) => entry.mission),
      SCHEDULED: groups.SCHEDULED.map((entry) => entry.mission),
      HISTORY: groups.HISTORY.map((entry) => entry.mission),
    }
  }, [classifiedMissions])

  const unassignedMissions = missionBuckets.PLANNABLE

  // Engagement mission des remorques : dérivé des affectations réelles, sans
  // statut persisté supplémentaire. Une remorque décrochée reste engagée.
  const trailerActiveMissions = useMemo(
    () =>
      buildTrailerActiveMissions(
        missions,
        (mission) => placements[mission.id]?.trailerId
      ),
    [missions, placements]
  )
  // Une ressource quitte le bandeau uniquement lorsqu'elle est présente dans
  // une ligne du planning de la semaine affichée. Son statut métier reste une
  // information de carte et ne pilote jamais son inclusion.
  const availableTrucks = dispatchData.trucks.filter(
    (truck) => !assignedTruckIds.has(truck.id)
  )

  const previewMissionsByRowAndDay = useMemo(() => {
    const result: Record<
      string,
      Partial<
        Record<
          DispatchDay,
          Array<{
            id: string
            reference: string
            conditional: boolean
            timeLabel: string
          }>
        >
      >
    > = {}
    if (!autoPlanningPreview) return result
    const add = (conditional: boolean) => (proposal: {
      pair: { rowId: string }
      missions: Array<{
        missionId: string
        reference: string
        temporalEvaluation: {
          possibleStartAt: string | null
          completedAt: string | null
        } | null
      }>
    }) => {
      proposal.missions.forEach((mission) => {
        const startedAt = mission.temporalEvaluation?.possibleStartAt
        if (!startedAt) return
        const occupied = getMissionOccupation({
          scheduledDate: startedAt,
          plannedEndAt: mission.temporalEvaluation?.completedAt,
        })
        if (!occupied) return
        const dayByShortName: Record<string, DispatchDay> = {
          Mon: 'monday',
          Tue: 'tuesday',
          Wed: 'wednesday',
          Thu: 'thursday',
          Fri: 'friday',
          Sat: 'saturday',
          Sun: 'sunday',
        }
        occupied.occupiedDayKeys.slice(0, 1).forEach((dayKey) => {
          const shortDay = new Intl.DateTimeFormat('en-US', {
            weekday: 'short',
            timeZone: 'UTC',
          }).format(new Date(`${dayKey}T12:00:00.000Z`))
          const day = dayByShortName[shortDay]
          if (!day) return
          const phase = getMissionDayPhase(occupied, dayKey)
          const byDay = (result[proposal.pair.rowId] ??= {})
          const list = (byDay[day] ??= [])
          list.push({
            id: `${mission.missionId}:${dayKey}`,
            reference: mission.reference,
            conditional,
            timeLabel:
              phase === 'START'
                ? 'Début'
                : phase === 'END'
                ? 'Fin'
                : phase === 'CONTINUATION'
                ? 'Suite'
                : new Intl.DateTimeFormat('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Europe/Luxembourg',
                  }).format(new Date(startedAt)),
          })
        })
      })
    }
    autoPlanningPreview.result.confirmedProposals.forEach(add(false))
    autoPlanningPreview.result.conditionalProposals.forEach(add(true))
    return result
  }, [autoPlanningPreview])
  const availableDrivers = dispatchData.drivers.filter(
    (driver) => !assignedDriverIds.has(driver.id)
  )

  const selectedMission =
    selectedMissionId !== null
      ? missions.find((mission) => mission.id === selectedMissionId) ?? null
      : null
  const selectedMissionPlacement = selectedMission
    ? placements[selectedMission.id]
    : null
  const selectedDriver = selectedMissionPlacement
    ? dispatchData.drivers.find(
        (driver) => driver.id === selectedMissionPlacement.driverId
      )
    : undefined
  const selectedTruck = selectedMissionPlacement
    ? dispatchData.trucks.find(
        (truck) => truck.id === selectedMissionPlacement.truckId
      )
    : undefined
  const selectedTrailer = selectedMissionPlacement
    ? dispatchData.trailers.find(
        (trailer) => trailer.id === selectedMissionPlacement.trailerId
      )
    : undefined

  /**
   * Applique une intention de localisation : semaine, onglet du bandeau,
   * filtre, puis mise en évidence. La recherche ne décide de rien elle-même,
   * elle relaie la classification déjà calculée côté serveur.
   */
  function handleLocatorSelect(
    result: SmartSearchResult,
    navigation: LocatorNavigation
  ) {
    if (navigation.weekStart) {
      const targetWeek = parseWeekStartParam(navigation.weekStart)
      if (targetWeek) handleWeekChange(targetWeek)
    }

    if (navigation.target.kind === 'mission') {
      setViewMode('planning')
    }

    if (navigation.poolMode) {
      setPoolLocatorRequest({
        mode: navigation.poolMode,
        bucket: navigation.poolBucket,
        trailerFilter: navigation.trailerFilter,
        nonce: Date.now(),
      })
    }

    requestHighlight(navigation.target)
  }

  function requestResourceEdit(type: ResourceEditRequest['type'], id: string) {
    setResourceEditRequest({
      type,
      id,
      nonce: Date.now(),
    })
  }

  /**
   * Applique localement le résultat d'une rotation de remorque : la colonne
   * Remorque et le pool se mettent à jour immédiatement, sans rechargement
   * complet du planning. La mission n'est jamais modifiée ici.
   */
  function handleTrailerRotated(
    result: {
      trailer?: { id: string; truckId?: string | null; loadStatus?: string }
    },
    toast: string
  ) {
    if (result.trailer) applyTrailerRotation(result.trailer)
    setImportsSyncVersion((version) => version + 1)
    setManualPlanningNotice({ kind: 'success', message: toast })
  }

  function bumpDispatchDataVersion() {
    setDispatchDataVersion((version) => version + 1)
  }

  function getMissionsForCell(rowId: string, day: DispatchDay) {
    return missions.filter((mission) => {
      const placement = placements[mission.id]
      return placement?.planningRowId === rowId && placement.day === day
    })
  }

  async function handleMissionStatusChange(
    missionId: string,
    status: MissionStatus
  ) {
    try {
      await postDispatchAction('/api/dispatch/update-mission-status', {
        missionId,
        status: dbStatusByMissionStatus[status],
      })

      setMissionStatuses((currentStatuses) => ({
        ...currentStatuses,
        [missionId]: status,
      }))
    } catch (error) {
      console.error('Unable to update mission status', error)
    }
  }

  async function handleUnassignMission(missionId: string) {
    try {
      await postDispatchAction('/api/dispatch/unassign-mission', {
        missionId,
      })

      setPlacements((currentPlacements) => ({
        ...currentPlacements,
        [missionId]: null,
      }))
      setMissionStatuses((currentStatuses) => ({
        ...currentStatuses,
        [missionId]: 'pending',
      }))
    } catch (error) {
      console.error('Unable to unassign mission', error)
    }
  }

  async function handleCreateMission(data: CreateMissionFormData) {
    const response = await fetch('/api/dispatch/create-mission', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(errorBody?.error ?? 'Impossible de créer la mission.')
    }

    const result = (await response.json()) as CreateMissionResponse
    const nextMission = mapApiMission(result.mission)

    setDispatchData((currentData) => ({
      ...currentData,
      missions: [...currentData.missions, nextMission],
    }))
    setPlacements((currentPlacements) => ({
      ...currentPlacements,
      [nextMission.id]: null,
    }))
    setMissionStatuses((currentStatuses) => ({
      ...currentStatuses,
      [nextMission.id]: nextMission.status,
    }))
    return {
      mission: {
        id: result.mission.id,
        reference: result.mission.reference,
        preparationStatus: result.preparationStatus,
      },
      warnings: result.warnings ?? [],
      preparationStatus: result.preparationStatus ?? 'PENDING',
    }
  }

  async function handleUpdateMission(data: CreateMissionFormData) {
    if (!selectedMission) {
      return
    }

    const response = await fetch('/api/dispatch/update-mission', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        missionId: selectedMission.id,
        ...data,
      }),
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(errorBody?.error ?? 'Impossible de modifier la mission.')
    }

    const result = (await response.json()) as CreateMissionResponse
    const updatedMission = mapApiMission(result.mission)

    setDispatchData((currentData) => ({
      ...currentData,
      missions: currentData.missions.map((mission) =>
        mission.id === updatedMission.id ? updatedMission : mission
      ),
    }))
    setMissionStatuses((currentStatuses) => ({
      ...currentStatuses,
      [updatedMission.id]: updatedMission.status,
    }))
    bumpDispatchDataVersion()
  }

  async function handleDeleteMission(missionId: string) {
    const response = await fetch(`/api/dispatch/missions/${missionId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(errorBody?.error ?? 'Impossible de supprimer la mission.')
    }

    setDispatchData((currentData) => ({
      ...currentData,
      missions: currentData.missions.filter(
        (mission) => mission.id !== missionId
      ),
    }))
    setPlacements((currentPlacements) => {
      const nextPlacements = { ...currentPlacements }
      delete nextPlacements[missionId]
      return nextPlacements
    })
    setMissionStatuses((currentStatuses) => {
      const nextStatuses = { ...currentStatuses }
      delete nextStatuses[missionId]
      return nextStatuses
    })
    setSelectedMissionId(null)
  }

  async function handleMarkPreAnnouncementSent(missionId: string) {
    const response = await fetch('/api/dispatch/mark-preannouncement-sent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        missionId,
      }),
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(
        errorBody?.error ?? 'Impossible de marquer la pré-annonce envoyée.'
      )
    }

    const result = (await response.json()) as CreateMissionResponse
    const updatedMission = mapApiMission(result.mission)

    setDispatchData((currentData) => ({
      ...currentData,
      missions: currentData.missions.map((mission) =>
        mission.id === updatedMission.id ? updatedMission : mission
      ),
    }))
  }

  async function handleCreateTruck(data: TruckFormData) {
    const response = await fetch('/api/dispatch/trucks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(errorBody?.error ?? 'Impossible de créer le camion.')
    }

    const result = (await response.json()) as TruckResponse
    const nextTruck = mapApiTruck(result.truck)

    setDispatchData((currentData) => ({
      ...currentData,
      trucks: [...currentData.trucks, nextTruck].sort(
        (firstTruck, secondTruck) =>
          firstTruck.plateNumber.localeCompare(secondTruck.plateNumber)
      ),
    }))
  }

  async function handleUpdateTruck(truckId: string, data: TruckFormData) {
    const response = await fetch(`/api/dispatch/trucks/${truckId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(errorBody?.error ?? 'Impossible de modifier le camion.')
    }

    const result = (await response.json()) as TruckResponse
    const updatedTruck = mapApiTruck(result.truck)

    setDispatchData((currentData) => ({
      ...currentData,
      trucks: currentData.trucks
        .map((truck) => (truck.id === updatedTruck.id ? updatedTruck : truck))
        .sort((firstTruck, secondTruck) =>
          firstTruck.plateNumber.localeCompare(secondTruck.plateNumber)
        ),
    }))
    bumpDispatchDataVersion()
  }

  async function handleDeleteTruck(truckId: string) {
    const response = await fetch(`/api/dispatch/trucks/${truckId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(errorBody?.error ?? 'Impossible de supprimer le camion.')
    }

    setDispatchData((currentData) => ({
      ...currentData,
      trucks: currentData.trucks.filter((truck) => truck.id !== truckId),
      trailers: currentData.trailers.map((trailer) =>
        trailer.truckId === truckId
          ? { ...trailer, truckId: null, status: 'AVAILABLE' }
          : trailer
      ),
      planningRows: currentData.planningRows.map((row) =>
        row.truckId === truckId ? { ...row, truckId: null } : row
      ),
      truckPositions: currentData.truckPositions.filter(
        (position) => position.truckId !== truckId
      ),
    }))
    setPlacements((currentPlacements) =>
      Object.fromEntries(
        Object.entries(currentPlacements).map(([missionId, placement]) => [
          missionId,
          placement?.truckId === truckId
            ? { ...placement, truckId: null }
            : placement,
        ])
      )
    )
  }

  async function handleCreateDriver(data: DriverFormData) {
    const response = await fetch('/api/dispatch/drivers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(errorBody?.error ?? 'Impossible de créer le chauffeur.')
    }

    const result = (await response.json()) as DriverResponse
    const nextDriver = mapApiDriver(result.driver)
    const nextTrucks = result.trucks?.map(mapApiTruck)

    setDispatchData((currentData) => ({
      ...currentData,
      drivers: [...currentData.drivers, nextDriver].sort(
        (firstDriver, secondDriver) =>
          firstDriver.name.localeCompare(secondDriver.name)
      ),
      trucks: nextTrucks ?? currentData.trucks,
    }))
  }

  async function handleUpdateDriver(driverId: string, data: DriverFormData) {
    const response = await fetch(`/api/dispatch/drivers/${driverId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(
        errorBody?.error ?? 'Impossible de modifier le chauffeur.'
      )
    }

    const result = (await response.json()) as DriverResponse
    const updatedDriver = mapApiDriver(result.driver)
    const nextTrucks = result.trucks?.map(mapApiTruck)

    setDispatchData((currentData) => ({
      ...currentData,
      drivers: currentData.drivers
        .map((driver) =>
          driver.id === updatedDriver.id ? updatedDriver : driver
        )
        .sort((firstDriver, secondDriver) =>
          firstDriver.name.localeCompare(secondDriver.name)
        ),
      trucks: nextTrucks ?? currentData.trucks,
    }))
    bumpDispatchDataVersion()
  }

  async function handleDeleteDriver(driverId: string) {
    const response = await fetch(`/api/dispatch/drivers/${driverId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(
        errorBody?.error ?? 'Impossible de supprimer le chauffeur.'
      )
    }

    setDispatchData((currentData) => ({
      ...currentData,
      drivers: currentData.drivers.filter((driver) => driver.id !== driverId),
      trucks: currentData.trucks.map((truck) =>
        truck.driverId === driverId
          ? { ...truck, driverId: null, status: 'AVAILABLE' }
          : truck
      ),
      planningRows: currentData.planningRows.map((row) =>
        row.driverId === driverId ? { ...row, driverId: null } : row
      ),
      truckPositions: currentData.truckPositions.filter(
        (position) => position.driverId !== driverId
      ),
    }))
    setPlacements((currentPlacements) =>
      Object.fromEntries(
        Object.entries(currentPlacements).map(([missionId, placement]) => [
          missionId,
          placement?.driverId === driverId
            ? { ...placement, driverId: null }
            : placement,
        ])
      )
    )
  }

  function updateTrailerState(
    currentTrailers: Trailer[],
    trailer: Trailer,
    detachedTrailer?: Trailer | null
  ) {
    const trailerById = new Map(currentTrailers.map((item) => [item.id, item]))
    trailerById.set(trailer.id, trailer)

    if (detachedTrailer) {
      trailerById.set(detachedTrailer.id, detachedTrailer)
    }

    return Array.from(trailerById.values()).sort(
      (firstTrailer, secondTrailer) =>
        firstTrailer.plateNumber.localeCompare(secondTrailer.plateNumber)
    )
  }

  async function assignTrailerToTruck(
    trailerId: string,
    truckId: string | null
  ) {
    const response = await fetch('/api/dispatch/assign-trailer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        trailerId,
        truckId,
      }),
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(errorBody?.error ?? "Impossible d'assigner la remorque.")
    }

    const result = (await response.json()) as TrailerResponse
    const trailer = mapApiTrailer(result.trailer)
    const detachedTrailer = result.detachedTrailer
      ? mapApiTrailer(result.detachedTrailer)
      : null

    setDispatchData((currentData) => ({
      ...currentData,
      trailers: updateTrailerState(
        currentData.trailers,
        trailer,
        detachedTrailer
      ),
    }))

    return trailer
  }

  async function handleCreateTrailer(data: TrailerFormData) {
    const response = await fetch('/api/dispatch/trailers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plateNumber: data.plateNumber,
        type: data.type,
        status: data.status,
        loadStatus: data.loadStatus,
        cargoType: data.cargoType,
        compatibleCargoTypes: data.compatibleCargoTypes,
        cargoDescription: data.cargoDescription,
        notes: data.notes,
        technicalInspectionDate: data.technicalInspectionDate,
        capacityKg: data.capacityKg,
        couplingType: data.couplingType,
      }),
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(errorBody?.error ?? 'Impossible de créer la remorque.')
    }

    const result = (await response.json()) as TrailerResponse
    const nextTrailer = mapApiTrailer(result.trailer)

    setDispatchData((currentData) => ({
      ...currentData,
      trailers: updateTrailerState(currentData.trailers, nextTrailer),
    }))

    if (data.truckId) {
      await assignTrailerToTruck(nextTrailer.id, data.truckId)
    }
  }

  async function handleUpdateTrailer(trailerId: string, data: TrailerFormData) {
    const currentTrailer =
      dispatchData.trailers.find((trailer) => trailer.id === trailerId) ?? null
    const nextTruckId = data.truckId ?? null
    const assignmentChanged = (currentTrailer?.truckId ?? null) !== nextTruckId

    const response = await fetch(`/api/dispatch/trailers/${trailerId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plateNumber: data.plateNumber,
        type: data.type,
        status: data.status,
        loadStatus: data.loadStatus,
        cargoType: data.cargoType,
        compatibleCargoTypes: data.compatibleCargoTypes,
        cargoDescription: data.cargoDescription,
        notes: data.notes,
        technicalInspectionDate: data.technicalInspectionDate,
        capacityKg: data.capacityKg,
        couplingType: data.couplingType,
      }),
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(errorBody?.error ?? 'Impossible de modifier la remorque.')
    }

    const result = (await response.json()) as TrailerResponse
    const updatedTrailer = mapApiTrailer(result.trailer)

    setDispatchData((currentData) => ({
      ...currentData,
      trailers: updateTrailerState(currentData.trailers, updatedTrailer),
    }))

    if (assignmentChanged) {
      await assignTrailerToTruck(updatedTrailer.id, nextTruckId)
    }
    bumpDispatchDataVersion()
  }

  async function handleDeleteTrailer(trailerId: string) {
    const response = await fetch(`/api/dispatch/trailers/${trailerId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(
        errorBody?.error ?? 'Impossible de supprimer la remorque.'
      )
    }

    setDispatchData((currentData) => ({
      ...currentData,
      trailers: currentData.trailers.filter(
        (trailer) => trailer.id !== trailerId
      ),
      planningRows: currentData.planningRows.map((row) =>
        row.trailerId === trailerId
          ? {
              ...row,
              trailerId: null,
            }
          : row
      ),
    }))
  }

  function handleMissionRouteUpdate(
    missionId: string,
    route: Pick<
      Mission,
      | 'routeDistanceMeters'
      | 'routeDurationSeconds'
      | 'routePolyline'
      | 'routeCalculatedAt'
      | 'routeProvider'
    >
  ) {
    setDispatchData((currentData) => ({
      ...currentData,
      missions: currentData.missions.map((mission) =>
        mission.id === missionId
          ? {
              ...mission,
              ...route,
            }
          : mission
      ),
    }))
  }

  function handleApproachRouteUpdate(
    missionId: string,
    approach: Pick<
      MissionPlacement,
      | 'approachDistanceMeters'
      | 'approachDurationSeconds'
      | 'approachPolyline'
      | 'approachCalculatedAt'
      | 'approachProvider'
    >
  ) {
    setPlacements((currentPlacements) => {
      const currentPlacement = currentPlacements[missionId]

      if (!currentPlacement) {
        return currentPlacements
      }

      return {
        ...currentPlacements,
        [missionId]: {
          ...currentPlacement,
          ...approach,
        },
      }
    })
  }

  function handleTruckReturnRouteUpdate(
    truckId: string,
    route: Pick<
      Truck,
      | 'returnToBaseDistanceMeters'
      | 'returnToBaseDurationSeconds'
      | 'returnToBasePolyline'
      | 'returnToBaseCalculatedAt'
      | 'returnToBaseProvider'
    >
  ) {
    setDispatchData((currentData) => ({
      ...currentData,
      trucks: currentData.trucks.map((truck) =>
        truck.id === truckId
          ? {
              ...truck,
              ...route,
            }
          : truck
      ),
    }))
  }

  function handleTruckStatusUpdate(
    truckId: string,
    status: TruckStatus,
    statusUpdatedAt?: string | null
  ) {
    setDispatchData((currentData) => ({
      ...currentData,
      trucks: currentData.trucks.map((truck) =>
        truck.id === truckId
          ? {
              ...truck,
              status,
              statusUpdatedAt: statusUpdatedAt ?? new Date().toISOString(),
            }
          : truck
      ),
    }))
  }

  function syncPlacementsForRow(row: PlanningRow) {
    setPlacements((currentPlacements) => {
      const nextPlacements = { ...currentPlacements }

      Object.entries(nextPlacements).forEach(([missionId, placement]) => {
        if (placement?.planningRowId === row.id) {
          nextPlacements[missionId] = {
            ...placement,
            driverId: row.driverId,
            truckId: row.truckId,
          }
        }
      })

      return nextPlacements
    })
  }

  function updatePlanningRowState(row: PlanningRow) {
    setDispatchData((currentData) => ({
      ...currentData,
      planningRows: currentData.planningRows
        .map((currentRow) => {
          if (currentRow.id === row.id) {
            return row
          }

          if (row.trailerId && currentRow.trailerId === row.trailerId) {
            return {
              ...currentRow,
              trailerId: null,
            }
          }

          return currentRow
        })
        .sort(
          (firstRow, secondRow) => firstRow.sortOrder - secondRow.sortOrder
        ),
    }))
    syncPlacementsForRow(row)
  }

  async function patchPlanningRow(
    rowId: string,
    data: {
      driverId?: string | null
      truckId?: string | null
      trailerId?: string | null
      pairLocked?: boolean
    }
  ) {
    const response = await fetch(`/api/dispatch/planning-rows/${rowId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      throw new Error(errorBody?.error ?? 'Impossible de modifier la ligne.')
    }

    const result = (await response.json()) as PlanningRowResponse
    const updatedRows = (result.affectedRows ?? [result.row]).map(
      mapApiPlanningRow
    )
    updatedRows.forEach(updatePlanningRowState)
    const updatedRow =
      updatedRows.find((planningRow) => planningRow.id === rowId) ??
      mapApiPlanningRow(result.row)
    return updatedRow
  }

  async function applyManualRowPatch(
    rowId: string,
    data: {
      driverId?: string | null
      truckId?: string | null
      trailerId?: string | null
    },
    successMessage: string
  ) {
    try {
      await patchPlanningRow(rowId, data)
      setManualPlanningNotice({ kind: 'success', message: successMessage })
    } catch (error) {
      setManualPlanningNotice({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Le déplacement a été refusé. La grille reste inchangée.',
      })
    }
  }

  /**
   * Applique le résultat serveur d'une rotation à l'état local.
   *
   * `Trailer.truckId` est la source de vérité : une fois corrigé,
   * `isTrailerVisibleOnPlanningRow` recalcule seul la colonne Remorque de
   * chaque ligne. On ne force jamais `row.trailerId` pour « faire apparaître »
   * une remorque.
   */
  function applyTrailerRotation(rotated: {
    id: string
    truckId?: string | null
    loadStatus?: string
  }) {
    setDispatchData((currentData) => ({
      ...currentData,
      trailers: currentData.trailers.map((trailer) =>
        trailer.id === rotated.id
          ? {
              ...trailer,
              truckId: rotated.truckId ?? null,
              loadStatus:
                (rotated.loadStatus as Trailer['loadStatus']) ??
                trailer.loadStatus,
            }
          : trailer
      ),
    }))
  }

  /** Attelage physique d'une remorque au tracteur d'une ligne du planning. */
  async function attachTrailerToRow(
    trailerId: string,
    targetRow: { id: string; truckId: string | null; driverId: string | null }
  ) {
    const trailer = dispatchData.trailers.find((item) => item.id === trailerId)
    const plate = trailer?.plateNumber ?? 'La remorque'

    if (!targetRow.truckId) {
      setManualPlanningNotice({
        kind: 'error',
        message: `Impossible d’atteler ${plate} : cette ligne n’a pas de tracteur.`,
      })
      return
    }

    const targetTruck = dispatchData.trucks.find(
      (truck) => truck.id === targetRow.truckId
    )
    const truckPlate = targetTruck?.plateNumber ?? 'ce tracteur'

    // Invariant 4 : un tracteur ne porte jamais deux remorques. On refuse
    // avant tout appel, sans aucune mutation partielle.
    const occupying = dispatchData.trailers.find(
      (item) => item.id !== trailerId && item.truckId === targetRow.truckId
    )
    if (occupying) {
      setManualPlanningNotice({
        kind: 'error',
        message: `Impossible d’atteler ${plate} : ${truckPlate} possède déjà la remorque ${occupying.plateNumber}. Décrochez-la avant d’en atteler une autre.`,
      })
      return
    }

    try {
      const result = (await postDispatchAction(
        '/api/dispatch/trailers/rotation',
        {
          action: 'ATTACH',
          trailerId,
          truckId: targetRow.truckId,
          driverId: targetRow.driverId,
        }
      )) as {
        trailer?: { id: string; truckId?: string | null; loadStatus?: string }
        resumedMissionReference?: string | null
      }

      if (result?.trailer) applyTrailerRotation(result.trailer)

      // `PlanningRow.trailerId` reste la remorque PRÉVUE au planning : on la
      // synchronise pour rester cohérent, sans jamais en faire la preuve
      // d'attelage.
      try {
        await patchPlanningRow(targetRow.id, { trailerId })
      } catch {
        // La synchronisation du planning est secondaire : l'attelage physique
        // a réussi et fait foi.
      }

      // Le toast n'est émis qu'après confirmation serveur.
      setManualPlanningNotice({
        kind: 'success',
        message: result?.resumedMissionReference
          ? `Mission ${result.resumedMissionReference} reprise avec ${plate} sur ${truckPlate}.`
          : `${plate} attelée à ${truckPlate}.`,
      })
    } catch (error) {
      setManualPlanningNotice({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : `Impossible d’atteler ${plate}.`,
      })
    }
  }

  /** Décrochage depuis la grille : la mission reste active. */
  async function detachTrailerFromGrid(trailerId: string) {
    const trailer = dispatchData.trailers.find((item) => item.id === trailerId)
    const plate = trailer?.plateNumber ?? 'La remorque'

    if (!trailer?.truckId) {
      setManualPlanningNotice({
        kind: 'error',
        message: `${plate} est déjà décrochée.`,
      })
      return
    }

    try {
      const result = (await postDispatchAction(
        '/api/dispatch/trailers/rotation',
        { action: 'DETACH', trailerId, location: 'BASE' }
      )) as {
        trailer?: { id: string; truckId?: string | null; loadStatus?: string }
        missionKeptActive?: string | null
      }

      if (result?.trailer) applyTrailerRotation(result.trailer)

      const sourceRow = dispatchData.planningRows.find(
        (row) => row.trailerId === trailerId
      )
      if (sourceRow) {
        try {
          await patchPlanningRow(sourceRow.id, { trailerId: null })
        } catch {
          // idem : l'état physique fait foi.
        }
      }

      setManualPlanningNotice({
        kind: 'success',
        message: result?.missionKeptActive
          ? `${plate} décrochée · mission toujours active.`
          : `${plate} décrochée.`,
      })
    } catch (error) {
      setManualPlanningNotice({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : `Impossible de décrocher ${plate}.`,
      })
    }
  }

  async function handleAddPlanningRow() {
    const response = await fetch('/api/dispatch/planning-rows', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        weekStart: formatDateParam(selectedWeekStartDate),
      }),
    })

    if (!response.ok) {
      console.error('Unable to create planning row', response.status)
      return
    }

    const result = (await response.json()) as PlanningRowResponse
    const nextRow = mapApiPlanningRow(result.row)

    setDispatchData((currentData) => ({
      ...currentData,
      planningRows: [...currentData.planningRows, nextRow].sort(
        (firstRow, secondRow) => firstRow.sortOrder - secondRow.sortOrder
      ),
    }))
  }

  async function handleInitializePlanningRows() {
    try {
      const response = await fetch('/api/dispatch/planning-rows/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart: formatDateParam(selectedWeekStartDate) }),
      })
      if (!response.ok) throw new Error(`Initialisation refusée (${response.status}).`)
      const result = (await response.json()) as PlanningInitializationResponse
      await loadOverview()
      setPlanningInitializationNotice(
        result.initialized
          ? getPlanningInitializationNotice(result.sourceWeekStartDate, result.createdRowCount)
          : 'Le planning de cette semaine est déjà initialisé.'
      )
    } catch (error) {
      setManualPlanningNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Initialisation impossible.',
      })
    }
  }

  async function handleRemovePlanningRow(rowId: string) {
    if (
      !window.confirm(
        'Supprimer cette ligne ? Les éléments seront retirés du planning mais resteront disponibles.'
      )
    ) {
      return
    }

    const response = await fetch(`/api/dispatch/planning-rows/${rowId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      console.error('Unable to delete planning row', response.status)
      return
    }

    setDispatchData((currentData) => ({
      ...currentData,
      planningRows: currentData.planningRows.filter((row) => row.id !== rowId),
    }))
    setPlacements((currentPlacements) => {
      const nextPlacements = { ...currentPlacements }

      Object.entries(nextPlacements).forEach(([missionId, placement]) => {
        if (placement?.planningRowId === rowId) {
          nextPlacements[missionId] = null
        }
      })

      return nextPlacements
    })
    setMissionStatuses((currentStatuses) => {
      const nextStatuses = { ...currentStatuses }

      Object.entries(placements).forEach(([missionId, placement]) => {
        if (placement?.planningRowId === rowId) {
          nextStatuses[missionId] = 'pending'
        }
      })

      return nextStatuses
    })
  }

  function handleDetachDriverFromRow(rowId: string) {
    void applyManualRowPatch(
      rowId,
      { driverId: null },
      'Chauffeur replacé dans son pool.'
    )
  }
  function handleDragStart(event: DragStartEvent) {
    if (!capabilities.canDragDrop) return
    const dragType = event.active.data.current?.type

    if (
      dragType === 'truck' ||
      dragType === 'mission' ||
      dragType === 'driver' ||
      dragType === 'trailer'
    ) {
      const id = String(event.active.id)
      lastDragDestinationRef.current = {
        key: null,
        repeatedCalls: 0,
        startedAt: performance.now(),
        warned: false,
      }
      setActiveDrag((currentDrag) =>
        currentDrag?.id === id && currentDrag.type === dragType
          ? currentDrag
          : { id, type: dragType }
      )
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const destinationKey = `${String(event.active.id)}:${String(
      event.over?.id ?? 'none'
    )}`
    const guard = lastDragDestinationRef.current
    const now = performance.now()

    if (guard.key !== destinationKey || now - guard.startedAt > 1000) {
      lastDragDestinationRef.current = {
        key: destinationKey,
        repeatedCalls: 1,
        startedAt: now,
        warned: false,
      }
      return
    }

    guard.repeatedCalls += 1
    if (
      process.env.NODE_ENV !== 'production' &&
      guard.repeatedCalls > 200 &&
      !guard.warned
    ) {
      guard.warned = true
      console.warn(
        '[Dispatch DnD] Nombre anormal de survols sans changement de destination.',
        { destinationKey, repeatedCalls: guard.repeatedCalls }
      )
    }
  }

  function cleanupDragState() {
    lastDragDestinationRef.current = {
      key: null,
      repeatedCalls: 0,
      startedAt: 0,
      warned: false,
    }
    setActiveDrag((currentDrag) => (currentDrag ? null : currentDrag))
  }

  async function handleDragEnd(event: DragEndEvent) {
    cleanupDragState()
    if (!capabilities.canDragDrop || !capabilities.canAssign) return
    const activeId = String(event.active.id)
    const dragType = event.active.data.current?.type
    const overId = event.over ? String(event.over.id) : null

    if (!overId) {
      return
    }

    if (dragType === 'driver') {
      if (overId === missionPoolDroppableId) {
        const sourceRow = dispatchData.planningRows.find(
          (row) => row.driverId === activeId
        )

        if (sourceRow) {
          await applyManualRowPatch(
            sourceRow.id,
            { driverId: null },
            'Chauffeur replacé dans son pool.'
          )
        }
        return
      }

      const targetRowId = parseDriverDropId(overId)

      if (!targetRowId) {
        return
      }

      const sourceRow = dispatchData.planningRows.find(
        (row) => row.driverId === activeId
      )
      const targetRow = rowById[targetRowId]

      if (!targetRow || sourceRow?.id === targetRow.id) {
        return
      }

      await applyManualRowPatch(
        targetRow.id,
        { driverId: activeId },
        targetRow.driverId
          ? 'Chauffeur remplacé. L’ancien chauffeur est revenu dans son pool.'
          : 'Chauffeur placé dans la grille.'
      )
      return
    }

    if (dragType === 'truck') {
      if (overId === missionPoolDroppableId) {
        const sourceRow = dispatchData.planningRows.find(
          (row) => row.truckId === activeId
        )

        if (sourceRow) {
          await applyManualRowPatch(
            sourceRow.id,
            { truckId: null },
            'Tracteur replacé dans son pool.'
          )
        }
        return
      }

      const targetRowId = parseTruckDropId(overId)

      if (!targetRowId) {
        return
      }

      const sourceRow = dispatchData.planningRows.find(
        (row) => row.truckId === activeId
      )
      const targetRow = rowById[targetRowId]

      if (!targetRow || sourceRow?.id === targetRow.id) {
        return
      }

      await applyManualRowPatch(
        targetRow.id,
        { truckId: activeId },
        targetRow.truckId
          ? 'Tracteur remplacé. L’ancien tracteur est revenu dans son pool.'
          : 'Tracteur placé dans la grille.'
      )
      return
    }

    if (dragType === 'trailer') {
      if (overId === missionPoolDroppableId) {
        await detachTrailerFromGrid(activeId)
        return
      }

      const targetCell = parseCellDroppableId(overId)
      const relayTrailer = dispatchData.trailers.find(
        (trailer) => trailer.id === activeId
      )

      if (targetCell && relayTrailer?.custodyState === 'RELAY_AVAILABLE') {
        const missionIds = Object.entries(placements)
          .filter(
            ([, placement]) =>
              placement?.planningRowId === targetCell.planningRowId &&
              placement.day === targetCell.day
          )
          .map(([missionId]) => missionId)
        if (missionIds.length !== 1) {
          setManualPlanningNotice({
            kind: 'error',
            message:
              missionIds.length === 0
                ? 'Déposez la remorque sur une cellule contenant la mission à reprendre.'
                : 'La cellule contient plusieurs missions. Ouvrez la mission pour choisir le relais.',
          })
          return
        }
        const targetMission = missions.find(
          (mission) => mission.id === missionIds[0]
        )
        if (
          !targetMission ||
          !window.confirm(
            `Confirmer la reprise de la remorque ${relayTrailer.plateNumber} pour la mission ${targetMission.reference} ?`
          )
        ) {
          return
        }
        try {
          await postDispatchAction('/api/dispatch/trailer-relays', {
            action: 'TAKE_OVER',
            missionId: targetMission.id,
            trailerId: relayTrailer.id,
            targetPlanningRowId: targetCell.planningRowId,
            targetDay: dbDayByDispatchDay[targetCell.day],
            expectedCustodyVersion: relayTrailer.custodyVersion ?? 0,
          })
          await loadOverview()
          setManualPlanningNotice({
            kind: 'success',
            message:
              'Relais repris. La mission conserve son identité et son historique.',
          })
        } catch (error) {
          setManualPlanningNotice({
            kind: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'La reprise de relais a été refusée.',
          })
        }
        return
      }

      const targetRowId = parseTrailerDropId(overId)

      if (!targetRowId) {
        return
      }

      const sourceRow = dispatchData.planningRows.find(
        (row) => row.trailerId === activeId
      )
      const targetRow = rowById[targetRowId]

      if (!targetRow || sourceRow?.id === targetRow.id) {
        return
      }

      // Déposer une remorque sur une ligne = ATTELAGE PHYSIQUE. Patcher
      // seulement PlanningRow.trailerId laissait `Trailer.truckId` inchangé :
      // le toast annonçait un succès alors que la grille, qui affiche
      // l'attelage réel, restait vide.
      await attachTrailerToRow(activeId, targetRow)
      return
    }

    if (dragType !== 'mission') {
      return
    }

    if (overId === missionPoolDroppableId) {
      try {
        await postDispatchAction('/api/dispatch/unassign-mission', {
          missionId: activeId,
        })
        setPlacements((currentPlacements) => ({
          ...currentPlacements,
          [activeId]: null,
        }))
        setMissionStatuses((currentStatuses) => ({
          ...currentStatuses,
          [activeId]: 'pending',
        }))
        setImportsSyncVersion((version) => version + 1)
        setManualPlanningNotice({
          kind: 'success',
          message: 'Mission replacée dans les missions à planifier.',
        })
      } catch (error) {
        setManualPlanningNotice({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Retrait refusé. La mission reste dans sa cellule.',
        })
      }
      return
    }

    const nextPlacementCell = parseCellDroppableId(overId)

    if (!nextPlacementCell) {
      return
    }
    const currentPlacement = placements[activeId]

    const targetRow = rowById[nextPlacementCell.planningRowId]

    if (!targetRow) {
      return
    }

    const nextScheduledDate = getScheduledDateForWeekDay(
      selectedWeekStartDate,
      nextPlacementCell.day
    )
    const draggedMission = missions.find((mission) => mission.id === activeId)
    const sourceOccupation = draggedMission
      ? getMissionOccupation({
          pickupDate: draggedMission.pickupDate,
          deliveryDate: draggedMission.deliveryDate,
          routeDurationSeconds: draggedMission.routeDurationSeconds,
        })
      : null
    const nextPlannedEndAt = sourceOccupation
      ? new Date(
          new Date(nextScheduledDate).getTime() +
            sourceOccupation.durationSeconds * 1000
        ).toISOString()
      : null
    const nextPlacement: MissionPlacement = {
      planningRowId: targetRow.id,
      driverId: targetRow.driverId,
      truckId: targetRow.truckId,
      day: nextPlacementCell.day,
      scheduledDate: nextScheduledDate,
      plannedEndAt: nextPlannedEndAt,
    }
    const targetCellMissions = getMissionsForCell(
      nextPlacement.planningRowId ?? targetRow.id,
      nextPlacement.day
    ).filter((mission) => mission.id !== activeId)
    const requestedSortOrder = getMissionDropIndex({
      activeTop: event.active.rect.current.translated?.top,
      activeHeight: event.active.rect.current.translated?.height,
      cellTop: event.over?.rect.top ?? 0,
      cellHeight: event.over?.rect.height ?? 0,
      missionCount: targetCellMissions.length,
    })
    if (
      currentPlacement?.planningRowId === nextPlacementCell.planningRowId &&
      currentPlacement.day === nextPlacementCell.day
    ) {
      const currentCellMissions = getMissionsForCell(
        currentPlacement.planningRowId,
        currentPlacement.day
      )
      const currentIndex = currentCellMissions.findIndex(
        (mission) => mission.id === activeId
      )
      if (currentIndex === requestedSortOrder) {
        return
      }
    }

    try {
      const assignmentResult = await postDispatchAction('/api/dispatch/assign-mission', {
        missionId: activeId,
        planningRowId: targetRow.id,
        driverId: nextPlacement.driverId,
        truckId: nextPlacement.truckId,
        day: dbDayByDispatchDay[nextPlacement.day],
        scheduledDate: nextScheduledDate,
        sortOrder: requestedSortOrder,
      })
      const assignmentWarnings = Array.isArray(assignmentResult?.warnings)
        ? assignmentResult.warnings.filter(
            (warning): warning is string => typeof warning === 'string'
          )
        : []

      // La mission est placée immédiatement : un avertissement n'annule jamais
      // le drop et ne provoque aucun rechargement de la grille.
      setPlacements((currentPlacements) => ({
        ...currentPlacements,
        [activeId]: nextPlacement,
      }))
      setMissionStatuses((currentStatuses) => ({
        ...currentStatuses,
        [activeId]:
          currentStatuses[activeId] === 'pending'
            ? 'assigned'
            : currentStatuses[activeId],
      }))
      setImportsSyncVersion((version) => version + 1)
      setManualPlanningNotice(
        assignmentWarnings.length > 0
          ? {
              kind: 'warning',
              message: `Mission assignée · ${assignmentWarnings.join(' · ')}`,
            }
          : { kind: 'success', message: 'Mission déplacée manuellement.' }
      )
    } catch (error) {
      setManualPlanningNotice({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Déplacement refusé. La mission reste à sa position précédente.',
      })
    }
  }

  if (viewMode === 'park' && initialParkOverview) {
    return (
      <div className="min-h-0 flex-1 pb-8 pt-3">
        <DispatchToolbar
          viewMode={viewMode}
          viewOptions={viewOptions}
          onViewChange={handleViewChange}
        />
        <ParkView initialOverview={initialParkOverview} />
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dispatchCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={cleanupDragState}
    >
      <div className={`min-h-0 flex-1 pt-3 ${viewMode === 'planning' ? 'pb-[212px]' : 'pb-8'}`}>
        <DispatchToolbar
          viewMode={viewMode}
          viewOptions={viewOptions}
          onViewChange={handleViewChange}
          selectedWeekStartDate={viewMode !== 'park' ? selectedWeekStartDate : undefined}
          onWeekChange={viewMode !== 'park' ? handleWeekChange : undefined}
          onOpenSearch={capabilities.canViewPlanning ? () => setIsSearchOpen(true) : undefined}
          onOpenAssistant={capabilities.canViewPlanning ? () => setIsAssistantOpen(true) : undefined}
          onOpenAutoPlanning={
            capabilities.canAssign && viewMode === 'planning'
              ? () => setIsAutoPlanningOpen(true)
              : undefined
          }
          onAnalyzePlanning={
            viewMode === 'planning' && capabilities.canViewPlanning
              ? () => analyzePlanningRef.current?.()
              : undefined
          }
          onCompletePlanningRows={
            viewMode === 'planning' &&
            capabilities.canAssign &&
            !isLoadingOverview &&
            !overviewError
              ? () => void handleInitializePlanningRows()
              : undefined
          }
          completePlanningRowsLabel={
            dispatchData.planningRows.length === 0
              ? 'Initialiser les lignes de cette semaine'
              : 'Compléter les lignes de cette semaine'
          }
          onOpenImports={capabilities.canViewImports ? () => setIsImportedMissionsOpen(true) : undefined}
          onOpenClientProfiles={
            capabilities.canManageCustomers ? () => setIsClientProfilesOpen(true) : undefined
          }
          onCreateMission={capabilities.canCreateMission ? () => setIsCreateMissionOpen(true) : undefined}
        />

        {viewMode === 'planning' && capabilities.canViewPlanning ? (
          <GerardSuggestionsPanel
            weekStart={formatDateParam(selectedWeekStartDate)}
            onApplied={() => loadOverview()}
            hideTrigger
            analyzeRef={analyzePlanningRef}
          />
        ) : null}

        {viewMode === 'planning' && !capabilities.canAssign ? (
          <p className="mx-3 mb-3 text-xs font-semibold text-[#7a8074]">
            {capabilities.canEditMission
              ? 'Affectation réservée au Dispatcher.'
              : 'Planning en lecture seule.'}
          </p>
        ) : null}

        {viewMode === 'planning' && planningInitializationNotice ? (
          <div className="mx-3 mb-3 rounded-2xl border border-lime-200 bg-lime-50 px-4 py-3 text-xs font-semibold text-[#49630b] shadow-[0_8px_24px_rgba(73,99,11,0.08)]">
            {planningInitializationNotice}
          </div>
        ) : null}

        {viewMode === 'planning' && manualPlanningNotice ? (
          <div
            role={manualPlanningNotice.kind === 'error' ? 'alert' : 'status'}
            className={[
              'mx-3 mb-3 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-xs font-semibold shadow-[0_8px_24px_rgba(17,18,15,0.06)]',
              manualPlanningNotice.kind === 'error'
                ? 'border border-red-200 bg-red-50 text-red-700'
                : manualPlanningNotice.kind === 'warning'
                ? 'border border-amber-200 bg-amber-50 text-amber-800'
                : 'border border-lime-200 bg-lime-50 text-[#49630b]',
            ].join(' ')}
          >
            <span>{manualPlanningNotice.message}</span>
            <button
              type="button"
              aria-label="Fermer le message"
              onClick={() => setManualPlanningNotice(null)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-sm"
              style={{ border: 0 }}
            >
              ×
            </button>
          </div>
        ) : null}

        {viewMode === 'planning' && autoPlanningPreview ? (
          <div className="mx-3 mb-3 flex items-center justify-between rounded-2xl bg-[#11130f] px-4 py-3 text-xs font-semibold text-white shadow-[0_12px_30px_rgba(17,19,15,0.14)]">
            <span>
              Mode simulation · {autoPlanningPreview.result.metrics.confirmedMissions}{' '}
              confirmée(s) · aucune donnée enregistrée
            </span>
            <button
              type="button"
              onClick={() => setAutoPlanningPreview(null)}
              className="rounded-xl bg-white/10 px-3 py-1.5 text-[10px] hover:bg-white/20"
              style={{ border: 0 }}
            >
              Quitter
            </button>
          </div>
        ) : null}

        {viewMode === 'planning' && autoPlanningNotice ? (
          <div className="mx-3 mb-3 rounded-2xl bg-lime-100 px-4 py-3 text-xs font-semibold text-[#405c08]">
            {autoPlanningNotice}
          </div>
        ) : null}

        {viewMode === 'planning' ? (
          <section
            className={[
              'overflow-hidden border-0 bg-[#f7f8f4] shadow-none ring-0',
              isPlanningFullscreen
                ? 'fixed inset-x-0 bottom-[196px] top-0 z-[60] h-auto'
                : 'relative h-[calc(100vh-390px)] rounded-none',
            ].join(' ')}
          >
            <button
              type="button"
              onClick={() => setIsPlanningFullscreen((current) => !current)}
              aria-label={
                isPlanningFullscreen
                  ? 'Quitter le plein écran'
                  : 'Afficher le planning en plein écran'
              }
              className="absolute right-3 top-2 z-30 rounded-xl border border-black/10 bg-white/95 px-3 py-2 text-[10px] font-bold text-[#4f5549] shadow-[0_6px_18px_rgba(17,18,15,0.08)] transition hover:border-lime-300 hover:text-[#314800] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300"
            >
              {isPlanningFullscreen ? 'Quitter' : 'Plein écran'}
            </button>
            <div className="h-full overflow-auto">
              <table className="w-full table-fixed border-collapse">
                <colgroup>
                  <col style={{ width: '158px' }} />
                  <col style={{ width: '142px' }} />
                  <col style={{ width: '142px' }} />
                  {planningDays.map((day) => (
                    <col key={day} style={{ width: `calc((100% - 442px) / ${planningDays.length})` }} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-10 bg-[#f7f8f4]">
                  <tr className="border-b border-black/10">
                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-[#62665b]">
                      <div className="flex items-center gap-2">
                        {capabilities.canAssign ? <AddPlanningRowButton onClick={handleAddPlanningRow} /> : null}
                        <span>Chauffeur</span>
                      </div>
                    </th>
                    <th className="border-l border-black/10 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-[#62665b]">
                      Camion
                    </th>
                    <th className="border-l border-black/10 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-[#62665b]">
                      Remorque
                    </th>
                    {planningDays.map((day) => (
                      <th
                        key={day}
                        className="border-l border-black/10 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-[#62665b]"
                      >
                        {dayLabels[day]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiblePlanningRows.map((row) => {
                    const driver = row.driverId
                      ? driversById[row.driverId]
                      : undefined
                    const truck = row.truckId ? trucksById[row.truckId] : null
                    // Invariant 2 : la colonne Remorque reflète l'attelage
                    // PHYSIQUE courant, pas la remorque prévue au planning.
                    // Une remorque décrochée disparaît immédiatement de la
                    // ligne, même si la mission reste active.
                    const plannedTrailer = row.trailerId
                      ? trailersById[row.trailerId]
                      : undefined
                    const trailer = isTrailerVisibleOnPlanningRow(
                      plannedTrailer,
                      row.truckId
                    )
                      ? plannedTrailer
                      : undefined

                    return (
                      <PlanningRowView
                        key={row.id}
                        row={row}
                        driver={driver}
                        truck={truck ?? undefined}
                        trailer={trailer}
                        missionsByDay={planningDays.reduce<
                          Record<DispatchDay, Mission[]>
                        >((missionsByDay, day) => {
                          missionsByDay[day] = getMissionsForCell(row.id, day)
                          return missionsByDay
                        }, {} as Record<DispatchDay, Mission[]>)}
                        onMissionClick={(mission) =>
                          setSelectedMissionId(mission.id)
                        }
                        onRemoveRow={handleRemovePlanningRow}
                        onDriverEdit={(selectedDriver) =>
                          requestResourceEdit('driver', selectedDriver.id)
                        }
                        onTruckEdit={(selectedTruck) =>
                          requestResourceEdit('truck', selectedTruck.id)
                        }
                        onTrailerEdit={(selectedTrailer) =>
                          requestResourceEdit('trailer', selectedTrailer.id)
                        }
                        dragDisabled={
                          !capabilities.canDragDrop ||
                          Boolean(autoPlanningPreview)
                        }
                        previewMissionsByDay={
                          previewMissionsByRowAndDay[row.id] as
                            | Record<
                                DispatchDay,
                                Array<{
                                  id: string
                                  reference: string
                                  conditional: boolean
                                  timeLabel: string
                                }>
                              >
                            | undefined
                        }
                        canManageDrivers={capabilities.canManageDrivers}
                        canManageTrucks={capabilities.canManageTrucks}
                        canManageTrailers={capabilities.canManageTrailers}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : viewMode === 'map' ? (
          <DispatchMapView
            drivers={dispatchData.drivers}
            trucks={dispatchData.trucks}
            missions={missions}
            placements={placements}
            truckAssignments={truckAssignments}
            truckPositions={dispatchData.truckPositions}
            weekStart={formatDateParam(selectedWeekStartDate)}
            onApproachRouteUpdate={handleApproachRouteUpdate}
            onMissionClick={(mission) => setSelectedMissionId(mission.id)}
            onTruckOpen={() => setSelectedMissionId(null)}
            onMissionRouteUpdate={handleMissionRouteUpdate}
            onTruckStatusUpdate={handleTruckStatusUpdate}
            onTruckReturnRouteUpdate={handleTruckReturnRouteUpdate}
          />
        ) : viewMode === 'profitability' ? (
          <ProfitabilityPanel weekStart={selectedWeekStartDate} />
        ) : viewMode === 'park' && initialParkOverview ? (
          <ParkView initialOverview={initialParkOverview} />
        ) : (
          <InvoicesPanel missions={missions} />
        )}
      </div>

      {viewMode === 'planning' ? (
        <MissionPool
          fullScreen={isPlanningFullscreen}
          missions={unassignedMissions}
          missionBuckets={missionBuckets}
          trailerActiveMissions={trailerActiveMissions}
          weekStartDate={selectedWeekStartDate}
          availableTrucks={availableTrucks}
          drivers={availableDrivers}
          driverCatalog={dispatchData.drivers}
          trucks={dispatchData.trucks}
          trailers={dispatchData.trailers}
          truckAssignments={truckAssignments}
          assignedTrailerIds={Array.from(assignedTrailerIds)}
          editRequest={resourceEditRequest}
          onEditRequestHandled={() => setResourceEditRequest(null)}
          locatorRequest={poolLocatorRequest}
          onLocatorRequestHandled={() => setPoolLocatorRequest(null)}
          onMissionClick={(mission) => setSelectedMissionId(mission.id)}
          onCreateTruck={handleCreateTruck}
          onUpdateTruck={handleUpdateTruck}
          onDeleteTruck={handleDeleteTruck}
          onCreateDriver={handleCreateDriver}
          onUpdateDriver={handleUpdateDriver}
          onDeleteDriver={handleDeleteDriver}
          onCreateTrailer={handleCreateTrailer}
          onUpdateTrailer={handleUpdateTrailer}
          onDeleteTrailer={handleDeleteTrailer}
          onOpenMissionById={(missionId) => setSelectedMissionId(missionId)}
          onTrailerRotated={handleTrailerRotated}
          onMaintenanceUpdated={loadOverview}
          dragDisabled={
            !capabilities.canDragDrop || Boolean(autoPlanningPreview)
          }
          canManageDrivers={capabilities.canManageDrivers}
          canManageDriverCredentials={capabilities.canManageDriverCredentials}
          canManageTrucks={capabilities.canManageTrucks}
          canManageTrailers={capabilities.canManageTrailers}
          canDeleteResources={capabilities.canDeleteResources}
          canRequestMaintenance={capabilities.canRequestMaintenance}
        />
      ) : null}

      <DispatchSmartSearchPanel
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        weekStart={formatDateParam(selectedWeekStartDate)}
        onSelect={handleLocatorSelect}
      />

      <GerardAssistantPanel
        open={isAssistantOpen}
        onClose={() => setIsAssistantOpen(false)}
        weekStart={formatDateParam(selectedWeekStartDate)}
        missionReference={selectedMission?.reference}
      />

      {(isLoadingOverview || overviewError) && (
        <div className="fixed left-5 top-20 z-40 rounded-2xl border border-black/10 bg-white/95 px-4 py-3 text-xs font-semibold text-[#4f5549] shadow-[0_8px_24px_rgba(17,18,15,0.08)]">
          {isLoadingOverview
            ? 'Chargement des données dispatch...'
            : `Données indisponibles · ${overviewError}`}
        </div>
      )}

      <MissionDetailPanel
        mission={selectedMission}
        clientProfiles={clientProfiles}
        driverName={selectedDriver?.name}
        truckLabel={
          selectedTruck
            ? `${selectedTruck.plateNumber}${
                selectedTruck.model ? ` · ${selectedTruck.model}` : ''
              }`
            : undefined
        }
        trailerLabel={selectedTrailer?.plateNumber}
        trailers={dispatchData.trailers}
        plannedTrailerId={selectedMissionPlacement?.trailerId}
        trailerChangePlanned={selectedMissionPlacement?.trailerChangePlanned}
        onPlannedTrailerChange={async (missionId, trailerId) => {
          const response = await fetch(
            `/api/dispatch/missions/${encodeURIComponent(missionId)}/planned-trailer`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ trailerId }),
            }
          )
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null
            throw new Error(body?.error ?? 'Impossible de modifier la remorque planifiée.')
          }
          await loadOverview()
        }}
        onMarkTrailerRelayAvailable={async (mission) => {
          if (!mission.trailerId) return
          await postDispatchAction('/api/dispatch/trailer-relays', {
            action: 'MARK_RELAY_AVAILABLE',
            missionId: mission.id,
            trailerId: mission.trailerId,
            location: 'Base',
          })
          await loadOverview()
        }}
        onCancelTrailerRelay={async (mission) => {
          if (!mission.trailerId) return
          await postDispatchAction('/api/dispatch/trailer-relays', {
            action: 'CANCEL_RELAY',
            missionId: mission.id,
            trailerId: mission.trailerId,
            location: 'Base',
          })
          await loadOverview()
        }}
        day={selectedMissionPlacement?.day}
        onClose={() => setSelectedMissionId(null)}
        onStatusChange={handleMissionStatusChange}
        onUnassign={handleUnassignMission}
        onUpdate={handleUpdateMission}
        onDelete={capabilities.canDeleteMission ? handleDeleteMission : undefined}
        onMarkPreAnnouncementSent={handleMarkPreAnnouncementSent}
        canEdit={capabilities.canEditMission}
        canAssign={capabilities.canAssign}
      />

      {capabilities.canCreateMission ? <CreateMissionPanel
        isOpen={isCreateMissionOpen}
        onClose={() => setIsCreateMissionOpen(false)}
        onCreate={handleCreateMission}
        clientProfiles={clientProfiles}
      /> : null}

      {capabilities.canViewImports && capabilities.canCreateMission ? <ImportedMissionsPanel
        isOpen={isImportedMissionsOpen}
        onClose={() => setIsImportedMissionsOpen(false)}
        onCreateMission={handleCreateMission}
        canManageImports={capabilities.canManageImports}
        syncVersion={importsSyncVersion}
        onOpenMission={(missionId) => {
          setIsImportedMissionsOpen(false)
          setSelectedMissionId(missionId)
        }}
      /> : null}

      {capabilities.canManageCustomers ? <ClientProfilesPanel
        isOpen={isClientProfilesOpen}
        onClose={() => setIsClientProfilesOpen(false)}
        profiles={clientProfiles}
        onProfilesChange={setClientProfiles}
      /> : null}

      {capabilities.canAssign ? (
        <AutoPlanningPanel
          isOpen={isAutoPlanningOpen}
          weekStart={formatDateParam(selectedWeekStartDate)}
          onClose={() => setIsAutoPlanningOpen(false)}
          onPreviewChange={setAutoPlanningPreview}
          dataVersion={dispatchDataVersion}
          onOpenResource={(type, id) => {
            setIsAutoPlanningOpen(false)
            requestResourceEdit(type, id)
          }}
          onOpenMission={(missionId) => {
            setIsAutoPlanningOpen(false)
            setSelectedMissionId(missionId)
          }}
          onApplied={(result) => {
            setAutoPlanningPreview(null)
            setAutoPlanningNotice(
              `${result.appliedMissionIds.length} mission(s) appliquée(s) sur ${result.pairRowIds.length} couple(s).`
            )
            void loadOverview()
          }}
        />
      ) : null}

      <DragOverlay>
        {activeMission ? (
          <div className="w-[280px]">
            <MissionCardVisual
              mission={activeMission}
              status={getVisibleStatus(
                activeMission,
                placements[activeMission.id] !== null
              )}
            />
          </div>
        ) : activeTruck ? (
          <DragPreviewCard
            label={activeTruck.plateNumber}
            detail={activeTruck.model ?? 'Tracteur'}
          />
        ) : activeDriver ? (
          <div className="w-[240px]">
            <DriverDragPreview driver={activeDriver} />
          </div>
        ) : activeTrailer ? (
          <DragPreviewCard
            label={activeTrailer.plateNumber}
            detail="Remorque"
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
