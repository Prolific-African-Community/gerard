'use client'

import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'

import type {
  Driver,
  DriverStatus,
  Mission,
  Trailer,
  TrailerCargoType,
  TrailerLoadStatus,
  TrailerStatus,
  TrailerType,
  Truck,
  TruckStatus,
} from '../../lib/dispatch/mock-data'
import {
  getTrailerCargoLabel,
  getTrailerCargoStyle,
  getTrailerLoadLabel,
  trailerCargoTypeLabels,
  trailerLoadStatusLabels,
} from '../../lib/dispatch/trailer-display'
import {
  formatTechnicalInspectionDateInput,
  formatTechnicalInspectionDisplayDate,
  getTechnicalInspectionAlertDate,
  getTechnicalInspectionExpiresAt,
  parseTechnicalInspectionDateInput,
} from '../../lib/dispatch/technical-inspection'
import {
  COUPLING_TYPE_VALUES,
  couplingTypeLabels,
  NOT_PROVIDED_LABEL,
  technicalFieldHints,
} from '../../lib/dispatch/technical-attributes'
import { normalizeCompatibleCargoTypes } from '../../lib/dispatch/form-normalization'
import { MissionCard } from './MissionCard'
import { TrailerCard as ResourceTrailerCard } from './TrailerCard'
import { TruckCard } from './TruckCard'
import { useResourceCardActivation } from './useResourceCardActivation'
import { VehicleMaintenanceSection } from './VehicleMaintenanceSection'
import { MaintenanceRequestDialog } from './MaintenanceRequestDialog'
import type { MaintenanceTarget } from './MaintenanceRequestDialog'
import { ResourcePoolControlPanel } from './ResourcePoolPrimitives'
import { TrailerRotationPanel } from './TrailerRotationPanel'
import type { TrailerRotationResult } from './TrailerRotationPanel'
import {
  isDragAllowedForBucket,
  planningBucketCardLabels,
  planningBucketEmptyLabels,
  planningBucketLabels,
  primaryPlanningBuckets,
  secondaryPlanningBuckets,
} from '../../lib/dispatch/planning-pool'
import type { PlanningPoolBucket } from '../../lib/dispatch/planning-pool'
import {
  countTrailerFilters,
  matchesTrailerFilter,
  resolveTrailerSituation,
  summarizeTrailerSituation,
  trailerFilterLabels,
  trailerFilterOrder,
} from '../../lib/dispatch/trailer-rotation'
import type {
  TrailerActiveMission,
  TrailerFilter,
  TrailerSituation,
} from '../../lib/dispatch/trailer-rotation'
import { DriverRegulatorySummary } from './DriverRegulatorySummary'
import { DriverOperationalCardContent } from './DriverOperationalCardContent'

export const missionPoolDroppableId = 'mission-pool'

export type BottomResourceMode = 'missions' | 'trucks' | 'drivers' | 'trailers'

type MissionPoolProps = {
  fullScreen?: boolean
  missions: Mission[]
  availableTrucks: Truck[]
  drivers: Driver[]
  driverCatalog?: Driver[]
  trucks: Truck[]
  trailers: Trailer[]
  truckAssignments: Record<string, string | null>
  assignedTrailerIds?: string[]
  /**
   * Missions regroupées par bucket. Le rail affiche celui qui est sélectionné,
   * les compteurs viennent du même regroupement : aucune logique parallèle.
   */
  missionBuckets?: Record<PlanningPoolBucket, Mission[]>
  /**
   * Mission réellement en cours portée par chaque remorque, indexée par
   * identifiant de remorque. Sert à dériver l'engagement mission sans créer
   * de statut persisté supplémentaire.
   */
  trailerActiveMissions?: Record<string, TrailerActiveMission>
  /** Semaine consultée, utilisée pour exprimer le retard sur les cartes. */
  weekStartDate?: Date
  editRequest?: ResourceEditRequest | null
  onEditRequestHandled?: () => void
  /**
   * Demande de localisation issue de la recherche : sélectionne l'onglet, la
   * catégorie et le filtre qui contiennent réellement la carte visée.
   */
  locatorRequest?: PoolLocatorRequest | null
  onLocatorRequestHandled?: () => void
  onMissionClick: (mission: Mission) => void
  onCreateTruck: (data: TruckFormData) => Promise<void>
  onUpdateTruck: (truckId: string, data: TruckFormData) => Promise<void>
  onDeleteTruck: (truckId: string) => Promise<void>
  onCreateDriver: (data: DriverFormData) => Promise<void>
  onUpdateDriver: (driverId: string, data: DriverFormData) => Promise<void>
  onDeleteDriver: (driverId: string) => Promise<void>
  onCreateTrailer: (data: TrailerFormData) => Promise<void>
  onUpdateTrailer: (trailerId: string, data: TrailerFormData) => Promise<void>
  onDeleteTrailer: (trailerId: string) => Promise<void>
  onMaintenanceUpdated?: () => Promise<void> | void
  /** Ouvre la fiche mission existante depuis la remorque. */
  onOpenMissionById?: (missionId: string) => void
  /** Applique localement le résultat d'une rotation, sans refresh global. */
  onTrailerRotated?: (result: TrailerRotationResult, toast: string) => void
  dragDisabled?: boolean
  canManageDrivers?: boolean
  canManageDriverCredentials?: boolean
  canManageTrucks?: boolean
  canManageTrailers?: boolean
  canDeleteResources?: boolean
  canRequestMaintenance?: boolean
}

/**
 * Sélection pilotée par la recherche locator. `nonce` permet de rejouer la
 * même demande (même mission, même filtre) sans changer d'état.
 */
export type PoolLocatorRequest = {
  mode: BottomResourceMode
  bucket?: PlanningPoolBucket | null
  trailerFilter?: TrailerFilter | null
  nonce: number
}

export type ResourceEditRequest = {
  type: 'driver' | 'truck' | 'trailer'
  id: string
  nonce: number
}

export function resolveDriverEditTarget(
  request: ResourceEditRequest | null | undefined,
  drivers: Driver[]
) {
  if (request?.type !== 'driver') return null
  return drivers.find((driver) => driver.id === request.id) ?? null
}

export type TruckFormData = {
  plateNumber: string
  brand?: string
  model?: string
  status?: TruckStatus
  gpsDeviceId?: string
  technicalInspectionDate?: string | null
  category?: string | null
  capacityKg?: number | null
  couplingType?: string | null
}

export type DriverFormData = {
  name: string
  phone?: string | null
  email?: string | null
  username?: string | null
  password?: string | null
  hourlyCostAmount?: number | null
  hourlyCostCurrency?: string | null
  status?: DriverStatus
  truckId?: string | null
}

export type TrailerFormData = {
  plateNumber: string
  type: TrailerType
  status: TrailerStatus
  loadStatus: TrailerLoadStatus
  cargoType?: TrailerCargoType | null
  compatibleCargoTypes?: TrailerCargoType[] | null
  cargoDescription?: string | null
  notes?: string | null
  truckId?: string | null
  technicalInspectionDate?: string | null
  capacityKg?: number | null
  couplingType?: string | null
}

const truckStatusOptions: TruckStatus[] = [
  'AVAILABLE',
  'ASSIGNED',
  'EN_ROUTE_TO_PICKUP',
  'AT_PICKUP',
  'ON_MISSION',
  'RETURNING_TO_BASE',
  'AT_BASE',
  'IN_MAINTENANCE',
  'MAINTENANCE_EXT',
  'OUT_OF_SERVICE',
]

const truckStatusLabels: Record<TruckStatus, string> = {
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

const driverStatusOptions: DriverStatus[] = [
  'ACTIVE',
  'UNAVAILABLE',
  'ON_LEAVE',
  'INACTIVE',
]

const driverStatusLabels: Record<DriverStatus, string> = {
  ACTIVE: 'Actif',
  UNAVAILABLE: 'Indisponible',
  ON_LEAVE: 'Congé',
  INACTIVE: 'Inactif',
}

const trailerTypeOptions: TrailerType[] = [
  'CURTAINSIDER',
  'FLATBED',
  'REFRIGERATED',
  'CONTAINER',
  'BOX',
  'OTHER',
]

const trailerTypeLabels: Record<TrailerType, string> = {
  CURTAINSIDER: 'Bâchée',
  FLATBED: 'Plateau',
  REFRIGERATED: 'Frigorifique',
  CONTAINER: 'Container',
  BOX: 'Fourgon',
  OTHER: 'Autre',
}

const trailerStatusOptions: TrailerStatus[] = [
  'AVAILABLE',
  'ASSIGNED',
  'AT_BASE',
  'IN_MAINTENANCE',
  'MAINTENANCE_EXT',
  'OUT_OF_SERVICE',
]

const trailerStatusLabels: Record<TrailerStatus, string> = {
  AVAILABLE: 'Disponible',
  ASSIGNED: 'Assignée',
  AT_BASE: 'À la Base',
  IN_MAINTENANCE: 'Maintenance à la base',
  MAINTENANCE_EXT: 'Maintenance extérieure',
  OUT_OF_SERVICE: 'Hors service',
}

const trailerLoadStatusOptions: TrailerLoadStatus[] = ['EMPTY', 'LOADED']

const trailerCargoTypeOptions: TrailerCargoType[] = [
  'WOOD',
  'ALUMINIUM',
  'STEEL',
  'PALLETS',
  'CONSTRUCTION_MATERIALS',
  'FOOD',
  'MACHINERY',
  'TEXTILE',
  'CHEMICALS',
  'OTHER',
]

const emptyTruckForm = {
  plateNumber: '',
  brand: '',
  model: '',
  status: 'AVAILABLE' as TruckStatus,
  gpsDeviceId: '',
  technicalInspectionDate: '',
  category: '',
  capacityKg: '',
  couplingType: '',
}

const emptyDriverForm = {
  name: '',
  phone: '',
  email: '',
  username: '',
  password: '',
  hourlyCostAmount: '',
  status: 'ACTIVE' as DriverStatus,
}

const emptyTrailerForm = {
  plateNumber: '',
  type: 'CURTAINSIDER' as TrailerType,
  status: 'AVAILABLE' as TrailerStatus,
  loadStatus: 'EMPTY' as TrailerLoadStatus,
  cargoType: '' as TrailerCargoType | '',
  compatibleCargoTypes: '',
  cargoDescription: '',
  notes: '',
  truckId: '',
  technicalInspectionDate: '',
  capacityKg: '',
  couplingType: '',
}

function generateDriverUsername(name: string) {
  const parts = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) {
    return ''
  }

  if (parts.length === 1) {
    return parts[0].replace(/[^a-z0-9]/g, '')
  }

  return `${parts[0][0] ?? ''}${parts[parts.length - 1]}`.replace(
    /[^a-z0-9]/g,
    ''
  )
}

const resourceOptions: Array<{
  mode: BottomResourceMode
  label: string
  shortLabel: string
  icon: 'tasks' | 'truck' | 'driver' | 'trailer'
}> = [
  {
    mode: 'missions',
    label: 'Missions à planifier',
    shortLabel: 'Missions',
    icon: 'tasks',
  },
  {
    mode: 'trucks',
    label: 'Camions disponibles',
    shortLabel: 'Camions',
    icon: 'truck',
  },
  {
    mode: 'drivers',
    label: 'Chauffeurs',
    shortLabel: 'Chauffeurs',
    icon: 'driver',
  },
  {
    mode: 'trailers',
    label: 'Remorques',
    shortLabel: 'Remorques',
    icon: 'trailer',
  },
]

export function MissionPool({
  fullScreen = false,
  missions,
  availableTrucks,
  drivers,
  driverCatalog = drivers,
  trucks,
  trailers,
  truckAssignments,
  assignedTrailerIds = [],
  missionBuckets,
  trailerActiveMissions,
  weekStartDate,
  editRequest = null,
  onEditRequestHandled,
  locatorRequest = null,
  onLocatorRequestHandled,
  onMissionClick,
  onCreateTruck,
  onUpdateTruck,
  onDeleteTruck,
  onCreateDriver,
  onUpdateDriver,
  onDeleteDriver,
  onCreateTrailer,
  onUpdateTrailer,
  onDeleteTrailer,
  onMaintenanceUpdated,
  onOpenMissionById,
  onTrailerRotated,
  dragDisabled = false,
  canManageDrivers = false,
  canManageDriverCredentials = false,
  canManageTrucks = false,
  canManageTrailers = false,
  canDeleteResources = false,
  canRequestMaintenance = false,
}: MissionPoolProps) {
  const [mode, setMode] = useState<BottomResourceMode>('missions')
  const [activeBucket, setActiveBucket] =
    useState<PlanningPoolBucket>('PLANNABLE')
  const [isSecondaryOpen, setIsSecondaryOpen] = useState(false)
  const [trailerFilter, setTrailerFilter] = useState<TrailerFilter>('ALL')
  const [truckModalMode, setTruckModalMode] = useState<
    { type: 'create' } | { type: 'edit'; truck: Truck } | null
  >(null)
  const [driverModalMode, setDriverModalMode] = useState<
    { type: 'create' } | { type: 'edit'; driver: Driver } | null
  >(null)
  const [trailerModalMode, setTrailerModalMode] = useState<
    { type: 'create' } | { type: 'edit'; trailer: Trailer } | null
  >(null)
  const [maintenanceTarget, setMaintenanceTarget] = useState<MaintenanceTarget | null>(null)

  useEffect(() => {
    if (!editRequest) {
      return
    }

    if (editRequest.type === 'driver') {
      const driver = resolveDriverEditTarget(editRequest, driverCatalog)

      if (driver) {
        setDriverModalMode({ type: 'edit', driver })
        setMode('drivers')
      }
    }

    if (editRequest.type === 'truck') {
      const truck = trucks.find((item) => item.id === editRequest.id)

      if (truck) {
        setTruckModalMode({ type: 'edit', truck })
        setMode('trucks')
      }
    }

    if (editRequest.type === 'trailer') {
      const trailer = trailers.find((item) => item.id === editRequest.id)

      if (trailer) {
        setTrailerModalMode({ type: 'edit', trailer })
        setMode('trailers')
      }
    }

    onEditRequestHandled?.()
  }, [
    driverCatalog,
    editRequest,
    onEditRequestHandled,
    trailers,
    trucks,
  ])

  // La recherche n'invente aucune catégorie : elle réutilise le bucket et le
  // filtre calculés par le système central et se contente de les activer.
  useEffect(() => {
    if (!locatorRequest) return

    setMode(locatorRequest.mode)

    if (locatorRequest.mode === 'missions' && locatorRequest.bucket) {
      setActiveBucket(locatorRequest.bucket)
      if (secondaryPlanningBuckets.includes(locatorRequest.bucket)) {
        setIsSecondaryOpen(true)
      }
    }

    if (locatorRequest.mode === 'trailers' && locatorRequest.trailerFilter) {
      setTrailerFilter(locatorRequest.trailerFilter)
    }

    onLocatorRequestHandled?.()
  }, [locatorRequest, onLocatorRequestHandled])

  const { setNodeRef, isOver } = useDroppable({
    id: missionPoolDroppableId,
    disabled: dragDisabled,
  })

  // Les compteurs proviennent exclusivement du regroupement fourni : le rail
  // et le sélecteur ne peuvent donc jamais diverger.
  const buckets: Record<PlanningPoolBucket, Mission[]> = missionBuckets ?? {
    PLANNABLE: missions,
    BACKLOG: [],
    TO_VERIFY: [],
    UPCOMING: [],
    ANOMALY: [],
    SCHEDULED: [],
    HISTORY: [],
  }
  const bucketMissions = buckets[activeBucket] ?? []
  const bucketDragDisabled =
    dragDisabled || !isDragAllowedForBucket(activeBucket)
  const missionCount = buckets.PLANNABLE.length
  const truckCount = availableTrucks.length
  const activeDriverCount = drivers.filter(
    (driver) => (driver.status ?? 'ACTIVE') === 'ACTIVE'
  ).length
  const assignedTrailerIdSet = useMemo(
    () => new Set(assignedTrailerIds),
    [assignedTrailerIds]
  )
  // La situation de chaque remorque est dérivée des champs existants :
  // attelage (truckId), chargement (loadStatus), mission active et
  // localisation. Aucun nouveau statut n'est persisté.
  const trailerEntries = useMemo(
    () =>
      trailers.map((trailer) => ({
        item: trailer,
        situation: resolveTrailerSituation({
          id: trailer.id,
          plateNumber: trailer.plateNumber,
          truckId: trailer.truckId,
          truckPlate: trucks.find((truck) => truck.id === trailer.truckId)
            ?.plateNumber,
          loadStatus: trailer.loadStatus,
          status: trailer.status,
          activeMission: trailerActiveMissions?.[trailer.id] ?? null,
        }) as TrailerSituation,
      })),
    [trailers, trucks, trailerActiveMissions]
  )
  const trailerFilterCounts = useMemo(
    () => countTrailerFilters(trailerEntries),
    [trailerEntries]
  )
  const availableTrailers = trailerEntries
    .filter((entry) => matchesTrailerFilter(entry.situation, trailerFilter))
    .map((entry) => entry.item)
  const trailerSituationById = useMemo(
    () =>
      new Map(trailerEntries.map((entry) => [entry.item.id, entry.situation])),
    [trailerEntries]
  )
  // Le compteur d'onglet reflète le travail réellement disponible.
  const activeTrailerCount = trailerFilterCounts.AVAILABLE

  const visibleCount =
    mode === 'missions'
      ? missionCount
      : mode === 'trucks'
      ? truckCount
      : mode === 'drivers'
      ? activeDriverCount
      : activeTrailerCount

  const title =
    mode === 'missions'
      ? 'Missions à planifier'
      : mode === 'trucks'
      ? 'Camions disponibles'
      : mode === 'drivers'
      ? 'Chauffeurs'
      : 'Remorques'

  const emptyLabel =
    mode === 'missions'
      ? 'Toutes les missions sont déjà placées dans le planning.'
      : mode === 'trucks'
      ? 'Tous les camions sont actuellement affectés.'
      : mode === 'drivers'
      ? 'Aucun chauffeur disponible.'
      : 'Aucune remorque disponible.'

  function getTruckForDriver(driverId: string) {
    return trucks.find((truck) => truckAssignments[truck.id] === driverId)
  }

  function getDriverForTruck(truckId: string) {
    return drivers.find((driver) => truckAssignments[truckId] === driver.id)
  }

  function getTrailerForTruck(truckId: string | undefined) {
    if (!truckId) {
      return undefined
    }

    return trailers.find((trailer) => trailer.truckId === truckId)
  }

  return (
    <section
      ref={setNodeRef}
      className={[
        'fixed inset-x-0 bottom-0 border-t border-black/[0.06] bg-[#f7f8f4] px-6 pb-3 pt-3 shadow-[0_-18px_50px_rgba(17,18,15,0.08)]',
        fullScreen ? 'z-[70]' : 'z-40',
        'h-[196px] overflow-hidden',
      ].join(' ')}
    >
      <div className="mx-auto flex h-full w-full items-stretch gap-5 overflow-hidden">
        <ResourcePoolControlPanel
          title={title}
          activeValue={mode}
          onChange={setMode}
          highlighted={isOver}
          footer={
            mode === 'trailers' ? (
              <TrailerFilterBar
                counts={trailerFilterCounts}
                active={trailerFilter}
                onChange={setTrailerFilter}
              />
            ) : mode === 'missions' ? (
              <PlanningBucketSelector
                buckets={buckets}
                activeBucket={activeBucket}
                onChange={setActiveBucket}
                isSecondaryOpen={isSecondaryOpen}
                onToggleSecondary={() =>
                  setIsSecondaryOpen((value) => !value)
                }
              />
            ) : undefined
          }
          options={resourceOptions.map((option) => ({
            value: option.mode,
            label: option.label,
            shortLabel: option.shortLabel,
            count:
              option.mode === 'missions'
                ? missionCount
                : option.mode === 'trucks'
                ? truckCount
                : option.mode === 'drivers'
                ? activeDriverCount
                : activeTrailerCount,
            icon: <ResourceIcon type={option.icon} />,
          }))}
        />

        <div className="min-w-0 flex-1 overflow-hidden">
          {mode === 'missions' && bucketMissions.length > 0 ? (
            <div className="dispatch-pool-scrollbar overscroll-x-contain pb-4">
              <div className="flex w-max items-start gap-5 pr-12">
                {bucketMissions.map((mission) => (
                  <MissionCard
                    key={mission.id}
                    mission={mission}
                    className="h-auto min-h-[104px] w-[300px] shrink-0"
                    onClick={onMissionClick}
                    dragDisabled={bucketDragDisabled}
                    bucketBadge={{
                      label: planningBucketCardLabels[activeBucket],
                      className: bucketBadgeClass[activeBucket],
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {mode === 'trucks' ? (
            <div className="dispatch-pool-scrollbar overscroll-x-contain pb-4">
              <div className="flex w-max items-start gap-4 pr-12">
                {availableTrucks.length > 0 ? (
                  availableTrucks.map((truck) => {
                    return (
                      <TruckCard
                        key={truck.id}
                        truck={truck}
                        driver={getDriverForTruck(truck.id)}
                        trailer={getTrailerForTruck(truck.id)}
                        showAssignmentDetails
                        showTrailerDetails={false}
                        statusLabel={
                          truckStatusLabels[truck.status ?? 'AVAILABLE']
                        }
                        wrapContent
                        className="h-[128px] w-[268px] shrink-0 overflow-y-auto"
                        dragDisabled={dragDisabled}
                        onEdit={canManageTrucks
                          ? (selectedTruck) => setTruckModalMode({ type: 'edit', truck: selectedTruck })
                          : canRequestMaintenance
                            ? (selectedTruck) => setMaintenanceTarget({ id: selectedTruck.id, type: 'TRUCK', label: selectedTruck.plateNumber })
                            : undefined}
                      />
                    )
                  })
                ) : (
                  <div className="flex h-[128px] w-[300px] shrink-0 items-center justify-center rounded-[26px] bg-[#F4F5F1] px-5 text-center text-sm font-semibold text-[#777D72] shadow-[0_18px_50px_rgba(17,18,15,0.06)]">
                    {emptyLabel}
                  </div>
                )}
                {canManageTrucks ? <button
                  type="button"
                  aria-label="Ajouter camion"
                  onClick={() => setTruckModalMode({ type: 'create' })}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] bg-[#11130F] text-xl font-semibold leading-none text-white shadow-[0_12px_32px_rgba(17,18,15,0.14)] transition hover:-translate-y-0.5 hover:bg-[#B9FF4A] hover:text-[#11130F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/70"
                  style={{ border: 0 }}
                >
                  +
                </button> : null}
              </div>
            </div>
          ) : null}

          {mode === 'drivers' ? (
            <div className="dispatch-pool-scrollbar overscroll-x-contain pb-4">
              <div className="flex w-max items-start gap-4 pr-12">
                {drivers.length > 0 ? (
                  drivers.map((driver) => (
                    <DriverCard
                      key={driver.id}
                      driver={driver}
                      dragDisabled={dragDisabled}
                      onEdit={canManageDrivers ? (selectedDriver) =>
                        setDriverModalMode({
                          type: 'edit',
                          driver: selectedDriver,
                        })
                      : undefined}
                    />
                  ))
                ) : (
                  <div className="flex h-[128px] w-[300px] shrink-0 items-center justify-center rounded-[26px] bg-[#F4F5F1] px-5 text-center text-sm font-semibold text-[#777D72] shadow-[0_18px_50px_rgba(17,18,15,0.06)]">
                    {emptyLabel}
                  </div>
                )}
                {canManageDrivers && canManageDriverCredentials ? <button
                  type="button"
                  aria-label="Ajouter chauffeur"
                  onClick={() => setDriverModalMode({ type: 'create' })}
                  className="flex h-12 w-12 shrink-0 items-center justify-center self-center rounded-[18px] bg-[#11130F] text-xl font-semibold leading-none text-white shadow-[0_12px_32px_rgba(17,18,15,0.14)] transition hover:-translate-y-0.5 hover:bg-[#B9FF4A] hover:text-[#11130F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/70"
                  style={{ border: 0 }}
                >
                  +
                </button> : null}
              </div>
            </div>
          ) : null}

          {mode === 'trailers' ? (
            <div className="dispatch-pool-scrollbar overscroll-x-contain pb-4">
              <div className="flex w-max items-start gap-4 pr-12">
                {availableTrailers.length > 0 ? (
                  availableTrailers.map((trailer) => (
                    <ResourceTrailerCard
                      key={trailer.id}
                      trailer={trailer}
                      truck={trucks.find(
                        (truck) => truck.id === trailer.truckId
                      )}
                      showTruckAssignment
                      wrapContent
                      situationSummary={
                        trailerSituationById.has(trailer.id)
                          ? summarizeTrailerSituation(
                              trailerSituationById.get(trailer.id)!
                            )
                          : null
                      }
                      className="h-[128px] w-[268px] shrink-0 overflow-y-auto rounded-[24px] px-4 py-3 shadow-[0_12px_30px_rgba(17,18,15,0.055)]"
                      dragDisabled={dragDisabled}
                      onEdit={canManageTrailers
                        ? (selectedTrailer) => setTrailerModalMode({ type: 'edit', trailer: selectedTrailer })
                        : canRequestMaintenance
                          ? (selectedTrailer) => setMaintenanceTarget({ id: selectedTrailer.id, type: 'TRAILER', label: selectedTrailer.plateNumber })
                          : undefined}
                    />
                  ))
                ) : (
                  <div className="flex h-[128px] w-[300px] shrink-0 items-center justify-center rounded-[26px] bg-[#F4F5F1] px-5 text-center text-sm font-semibold text-[#777D72] shadow-[0_18px_50px_rgba(17,18,15,0.06)]">
                    {trailerFilter === 'ALL'
                      ? emptyLabel
                      : `Aucune remorque · ${trailerFilterLabels[trailerFilter].toLowerCase()}.`}
                  </div>
                )}
                {canManageTrailers ? <button
                  type="button"
                  aria-label="Ajouter remorque"
                  onClick={() => setTrailerModalMode({ type: 'create' })}
                  className="flex h-12 w-12 shrink-0 items-center justify-center self-center rounded-[18px] bg-[#11130F] text-xl font-semibold leading-none text-white shadow-[0_12px_32px_rgba(17,18,15,0.14)] transition hover:-translate-y-0.5 hover:bg-[#B9FF4A] hover:text-[#11130F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/70"
                  style={{ border: 0 }}
                >
                  +
                </button> : null}
              </div>
            </div>
          ) : null}

          {mode === 'missions' && bucketMissions.length === 0 ? (
            <div className="flex h-[128px] items-center justify-center rounded-[34px] bg-[#F4F5F1] px-6 text-center text-sm font-semibold text-[#777D72] shadow-[0_22px_70px_rgba(17,18,15,0.07)]">
              {planningBucketEmptyLabels[activeBucket]}
            </div>
          ) : null}
        </div>
      </div>

      {truckModalMode ? (
        <TruckFormModal
          truck={truckModalMode.type === 'edit' ? truckModalMode.truck : null}
          onMaintenanceUpdated={onMaintenanceUpdated}
          onClose={() => setTruckModalMode(null)}
          onDelete={
            truckModalMode.type === 'edit' && canDeleteResources
              ? async () => {
                  await onDeleteTruck(truckModalMode.truck.id)
                  setTruckModalMode(null)
                }
              : undefined
          }
          onSubmit={async (data) => {
            if (truckModalMode.type === 'edit') {
              await onUpdateTruck(truckModalMode.truck.id, data)
            } else {
              await onCreateTruck(data)
            }

            setTruckModalMode(null)
          }}
        />
      ) : null}

      {driverModalMode ? (
        <DriverFormModal
          driver={
            driverModalMode.type === 'edit' ? driverModalMode.driver : null
          }
          onClose={() => setDriverModalMode(null)}
          canManageCredentials={canManageDriverCredentials}
          truck={
            driverModalMode.type === 'edit'
              ? getTruckForDriver(driverModalMode.driver.id)
              : undefined
          }
          onDelete={
            driverModalMode.type === 'edit' && canDeleteResources
              ? async () => {
                  await onDeleteDriver(driverModalMode.driver.id)
                  setDriverModalMode(null)
                }
              : undefined
          }
          onSubmit={async (data) => {
            if (driverModalMode.type === 'edit') {
              await onUpdateDriver(driverModalMode.driver.id, data)
            } else {
              await onCreateDriver(data)
            }

            setDriverModalMode(null)
          }}
        />
      ) : null}

      {trailerModalMode ? (
        <TrailerFormModal
          trailer={
            trailerModalMode.type === 'edit' ? trailerModalMode.trailer : null
          }
          trucks={trucks}
          activeMission={
            trailerModalMode.type === 'edit'
              ? trailerActiveMissions?.[trailerModalMode.trailer.id] ?? null
              : null
          }
          availableTrucks={trucks.filter(
            (truck) => !trailers.some((item) => item.truckId === truck.id)
          )}
          canManage={canManageTrailers}
          onOpenMission={onOpenMissionById}
          onRotated={onTrailerRotated}
          onMaintenanceUpdated={onMaintenanceUpdated}
          onClose={() => setTrailerModalMode(null)}
          onDelete={
            trailerModalMode.type === 'edit' && canDeleteResources
              ? async () => {
                  await onDeleteTrailer(trailerModalMode.trailer.id)
                  setTrailerModalMode(null)
                }
              : undefined
          }
          onSubmit={async (data) => {
            if (trailerModalMode.type === 'edit') {
              await onUpdateTrailer(trailerModalMode.trailer.id, data)
            } else {
              await onCreateTrailer(data)
            }

            setTrailerModalMode(null)
          }}
        />
      ) : null}
      <MaintenanceRequestDialog
        target={maintenanceTarget}
        onClose={() => setMaintenanceTarget(null)}
        onUpdated={onMaintenanceUpdated}
      />
    </section>
  )
}

/**
 * Filtres remorques, tous dérivés des dimensions réelles : aucun n'ajoute un
 * statut persisté. Même vocabulaire visuel que le sélecteur de missions.
 */
function TrailerFilterBar({
  counts,
  active,
  onChange,
}: {
  counts: Record<TrailerFilter, number>
  active: TrailerFilter
  onChange: (filter: TrailerFilter) => void
}) {
  return (
    <div className="flex max-w-full items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {trailerFilterOrder.map((filter) => {
        const isActive = active === filter
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={isActive}
            data-trailer-filter={filter}
            onClick={() => onChange(filter)}
            className={[
              'flex h-7 shrink-0 items-center gap-1.5 rounded-[13px] px-2.5 text-[11px] font-semibold transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/70',
              isActive
                ? 'bg-[#11130F] text-white shadow-[0_8px_20px_rgba(17,18,15,0.14)]'
                : 'text-[#687064] hover:bg-white/80 hover:text-[#11130F]',
            ].join(' ')}
            style={{ border: 0 }}
          >
            <span className="whitespace-nowrap">
              {trailerFilterLabels[filter]}
            </span>
            <span
              className={[
                'rounded-full px-1.5 text-[9px] font-bold leading-[1.5]',
                isActive
                  ? 'bg-[#B9FF4A] text-[#11130F]'
                  : 'bg-white text-[#5f665b]',
              ].join(' ')}
            >
              {counts[filter]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const bucketBadgeClass: Record<PlanningPoolBucket, string> = {
  PLANNABLE: 'border-lime-300 bg-lime-100 text-[#49630b]',
  BACKLOG: 'border-amber-200 bg-amber-50 text-amber-800',
  TO_VERIFY: 'border-black/10 bg-[#f4f5f1] text-[#5f665b]',
  ANOMALY: 'border-red-200 bg-red-50 text-red-700',
  UPCOMING: 'border-sky-200 bg-sky-50 text-sky-800',
  SCHEDULED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  HISTORY: 'border-black/10 bg-[#eceee8] text-[#5f665b]',
}

/** Pastille de compteur : l'accent porte la sémantique, pas la carte. */
const bucketCountClass: Record<PlanningPoolBucket, string> = {
  PLANNABLE: 'bg-[#B9FF4A] text-[#11130F]',
  BACKLOG: 'bg-amber-200 text-amber-900',
  TO_VERIFY: 'bg-[#e6e8e1] text-[#4f5549]',
  ANOMALY: 'bg-red-200 text-red-800',
  UPCOMING: 'bg-sky-200 text-sky-900',
  SCHEDULED: 'bg-emerald-200 text-emerald-900',
  HISTORY: 'bg-[#e6e8e1] text-[#4f5549]',
}

/**
 * Sélecteur compact des catégories du bandeau. Il reprend le vocabulaire
 * visuel des onglets ressources : pilule sombre active, pastille de compteur
 * accentuée. Les quatre catégories principales sont mutuellement exclusives ;
 * les vues de consultation vivent derrière le bouton « … ».
 */
function PlanningBucketSelector({
  buckets,
  activeBucket,
  onChange,
  isSecondaryOpen,
  onToggleSecondary,
}: {
  buckets: Record<PlanningPoolBucket, Mission[]>
  activeBucket: PlanningPoolBucket
  onChange: (bucket: PlanningPoolBucket) => void
  isSecondaryOpen: boolean
  onToggleSecondary: () => void
}) {
  const isSecondaryActive = secondaryPlanningBuckets.includes(activeBucket)
  const visibleBuckets = isSecondaryOpen
    ? [...primaryPlanningBuckets, ...secondaryPlanningBuckets]
    : isSecondaryActive
      ? [...primaryPlanningBuckets, activeBucket]
      : primaryPlanningBuckets

  return (
    <div className="flex max-w-full items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {visibleBuckets.map((bucket) => {
        const isActive = activeBucket === bucket
        return (
          <button
            key={bucket}
            type="button"
            aria-pressed={isActive}
            data-bucket={bucket}
            onClick={() => onChange(bucket)}
            className={[
              'flex h-7 shrink-0 items-center gap-1.5 rounded-[13px] px-2.5 text-[11px] font-semibold transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/70',
              isActive
                ? 'bg-[#11130F] text-white shadow-[0_8px_20px_rgba(17,18,15,0.14)]'
                : 'text-[#687064] hover:bg-white/80 hover:text-[#11130F]',
            ].join(' ')}
            style={{ border: 0 }}
          >
            <span className="whitespace-nowrap">
              {planningBucketLabels[bucket]}
            </span>
            <span
              className={[
                'rounded-full px-1.5 text-[9px] font-bold leading-[1.5]',
                isActive ? bucketCountClass[bucket] : 'bg-white text-[#5f665b]',
              ].join(' ')}
            >
              {buckets[bucket].length}
            </span>
          </button>
        )
      })}

      <button
        type="button"
        aria-label="Afficher les vues de consultation"
        aria-expanded={isSecondaryOpen}
        onClick={onToggleSecondary}
        className={[
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-[13px] text-[13px] font-bold leading-none transition',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/70',
          isSecondaryOpen
            ? 'bg-black/[0.08] text-[#11130F]'
            : 'text-[#687064] hover:bg-white/80 hover:text-[#11130F]',
        ].join(' ')}
        style={{ border: 0 }}
      >
        …
      </button>
    </div>
  )
}

function DriverCard({
  driver,
  dragDisabled = false,
  onEdit,
}: {
  driver: Driver
  dragDisabled?: boolean
  onEdit?: (driver: Driver) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: driver.id,
      data: {
        type: 'driver',
      },
      disabled: dragDisabled,
    })

  const style = {
    transform: CSS.Translate.toString(transform),
  }
  const activation = useResourceCardActivation(driver, isDragging, onEdit)

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      {...activation}
      role={onEdit ? 'button' : undefined}
      tabIndex={onEdit ? 0 : undefined}
      aria-label={onEdit ? `Ouvrir la fiche de ${driver.name}` : undefined}
      className={[
        'relative flex h-[128px] w-[240px] shrink-0 flex-col justify-center overflow-y-auto rounded-[20px] border border-black/[0.05] bg-white px-4 py-3 shadow-[0_10px_24px_rgba(17,18,15,0.05)] transition',
        onEdit
          ? 'cursor-pointer touch-none hover:ring-1 hover:ring-black/10'
          : dragDisabled
            ? ''
            : 'cursor-grab touch-none active:cursor-grabbing',
        isDragging ? 'opacity-35' : 'opacity-100',
      ].join(' ')}
    >
      <DriverOperationalCardContent minimal driver={driver} />
    </article>
  )
}

function TrailerCard({
  onEdit,
  trailer,
  truck,
}: {
  onEdit: (trailer: Trailer) => void
  trailer: Trailer
  truck?: Truck
}) {
  const cargoStyle = getTrailerCargoStyle(trailer)
  const cargoLabel = getTrailerCargoLabel(trailer)
  const loadLabel = getTrailerLoadLabel(trailer)

  return (
    <article
      onClick={() => onEdit(trailer)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onEdit(trailer)
        }
      }}
      role="button"
      tabIndex={0}
      className={[
        'relative flex h-auto min-h-0 w-[280px] shrink-0 cursor-pointer flex-col rounded-[24px] border px-5 py-3.5 shadow-[0_12px_30px_rgba(17,18,15,0.055)] transition hover:ring-1 hover:ring-black/10',
        cargoStyle.card,
      ].join(' ')}
    >
      <button
        type="button"
        aria-label={`Modifier ${trailer.plateNumber}`}
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onEdit(trailer)
        }}
        className="hidden"
        style={{ border: 0 }}
      >
        <PencilIcon />
      </button>

      <div className="min-w-0 pr-10">
        <p className="truncate text-[17px] font-semibold tracking-[-0.02em] text-[#11130F]">
          {trailer.plateNumber}
        </p>
        <p className="mt-1 truncate text-xs font-semibold text-[#72786d]">
          {trailerTypeLabels[trailer.type]}
        </p>
      </div>

      <div className="mt-2.5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-xs font-bold text-[#4e554b]">
            {truck ? `Assignée à ${truck.plateNumber}` : 'Aucun camion'}
          </p>
          <span className="shrink-0 rounded-full bg-[#F4F5F1] px-2.5 py-1 text-[11px] font-bold text-[#4f5549]">
            {trailerStatusLabels[trailer.status]}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span
            className={[
              'rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em]',
              cargoStyle.badge,
            ].join(' ')}
          >
            {loadLabel}
          </span>
          {cargoLabel ? (
            <span
              className={[
                'rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em]',
                cargoStyle.badge,
              ].join(' ')}
            >
              {cargoLabel}
            </span>
          ) : null}
        </div>
        {trailer.cargoDescription ? (
          <p className={['line-clamp-2 text-[11px] font-semibold', cargoStyle.text].join(' ')}>
            {trailer.cargoDescription}
          </p>
        ) : null}
      </div>
    </article>
  )
}

function DriverFormModal({
  driver,
  truck,
  canManageCredentials,
  onClose,
  onDelete,
  onSubmit,
}: {
  driver: Driver | null
  truck?: Truck
  canManageCredentials: boolean
  onClose: () => void
  onDelete?: () => Promise<void>
  onSubmit: (data: DriverFormData) => Promise<void>
}) {
  const [formState, setFormState] = useState(() =>
    driver
      ? {
          name: driver.name,
          phone: driver.phone ?? '',
          email: driver.email ?? '',
          username: driver.username ?? '',
          password: '',
          hourlyCostAmount:
            typeof driver.hourlyCostAmount === 'number'
              ? String(driver.hourlyCostAmount)
              : '',
          status: driver.status ?? 'ACTIVE',
        }
      : emptyDriverForm
  )
  const [isUsernameTouched, setIsUsernameTouched] = useState(Boolean(driver))
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (driver || isUsernameTouched) {
      return
    }

    setFormState((currentFormState) => ({
      ...currentFormState,
      username: generateDriverUsername(currentFormState.name),
    }))
  }, [driver, formState.name, isUsernameTouched])

  function updateField(field: keyof typeof emptyDriverForm, value: string) {
    setFormState((currentFormState) => ({
      ...currentFormState,
      [field]: value,
    }))
  }

  function handleNameChange(value: string) {
    setFormState((currentFormState) => ({
      ...currentFormState,
      name: value,
      username:
        driver || isUsernameTouched
          ? currentFormState.username
          : generateDriverUsername(value),
    }))
  }

  function handleUsernameChange(value: string) {
    setIsUsernameTouched(true)
    updateField('username', value.toLowerCase().replace(/\s+/g, ''))
  }

  function getOptionalValue(value: string) {
    const trimmedValue = value.trim()
    return trimmedValue.length > 0 ? trimmedValue : null
  }

  function getOptionalNumber(value: string) {
    const trimmedValue = value.trim()

    if (!trimmedValue) {
      return undefined
    }

    const numberValue = Number(trimmedValue.replace(',', '.'))

    return Number.isFinite(numberValue) ? numberValue : null
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!formState.name.trim()) {
      setError('Le nom chauffeur est obligatoire.')
      return
    }

    if (canManageCredentials && !formState.username.trim()) {
      setError("Le nom d'utilisateur chauffeur est obligatoire.")
      return
    }

    if (canManageCredentials && !driver && formState.password.length < 8) {
      setError('Le mot de passe chauffeur doit contenir au moins 8 caractères.')
      return
    }

    if (canManageCredentials && driver && !driver.username && formState.password.length < 8) {
      setError('Ajoutez un mot de passe pour créer cet accès chauffeur.')
      return
    }

    if (
      canManageCredentials &&
      driver &&
      driver.username &&
      formState.password &&
      formState.password.length < 8
    ) {
      setError('Le nouveau mot de passe doit contenir au moins 8 caractères.')
      return
    }

    const hourlyCostAmount = getOptionalNumber(formState.hourlyCostAmount)

    if (
      hourlyCostAmount === null ||
      (typeof hourlyCostAmount === 'undefined' &&
        Boolean(formState.hourlyCostAmount.trim()))
    ) {
      setError('Le coût horaire doit être un nombre valide.')
      return
    }

    if (typeof hourlyCostAmount === 'number' && hourlyCostAmount < 0) {
      setError('Le coût horaire doit être positif.')
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)

      await onSubmit({
        name: formState.name.trim(),
        phone: getOptionalValue(formState.phone),
        email: getOptionalValue(formState.email),
        username: canManageCredentials
          ? formState.username.trim().toLowerCase()
          : undefined,
        password: canManageCredentials && formState.password.trim()
          ? formState.password.trim()
          : undefined,
        hourlyCostAmount:
          typeof hourlyCostAmount === 'number' ? hourlyCostAmount : null,
        hourlyCostCurrency: 'EUR',
        status: formState.status,
      })
    } catch (submitError) {
      console.error('Unable to save driver', submitError)
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Impossible d'enregistrer le chauffeur."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!onDelete) {
      return
    }

    const confirmed = window.confirm(
      'Supprimer cet élément ? Cette action est définitive.'
    )

    if (!confirmed) {
      return
    }

    try {
      setIsDeleting(true)
      setError(null)
      await onDelete()
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Impossible de supprimer le chauffeur.'
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center px-0 sm:items-center sm:px-5">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/10"
      />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 flex max-h-[94dvh] w-full max-w-[1180px] flex-col overflow-hidden rounded-t-[28px] border border-black/10 bg-white shadow-[0_24px_80px_rgba(17,18,15,0.18)] sm:max-h-[92vh] sm:rounded-[32px]"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-black/[0.06] bg-white/95 px-5 py-4 backdrop-blur-xl sm:px-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#73796d]">
              Chauffeur
            </p>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight text-[#11130f]">
              {driver ? 'Modifier chauffeur' : 'Ajouter chauffeur'}
            </h3>
            {driver ? (
              <div className="mt-3 min-w-[260px]">
                <DriverOperationalCardContent
                  compact
                  driver={driver}
                  truck={truck}
                />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] transition hover:border-lime-300 hover:text-[#405c08]"
          >
            Annuler
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto">
          <div className="grid min-h-full lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
            <div className="p-5 sm:p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TruckField
            label="Nom chauffeur"
            value={formState.name}
            onChange={handleNameChange}
            placeholder="Jean Muller"
          />
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Statut
            </span>
            <select
              value={formState.status}
              onChange={(event) =>
                updateField('status', event.target.value as DriverStatus)
              }
              className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
            >
              {driverStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {driverStatusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <TruckField
            label="Téléphone"
            value={formState.phone}
            onChange={(value) => updateField('phone', value)}
            placeholder="+352 ..."
          />
          <TruckField
            label="Email"
            value={formState.email}
            onChange={(value) => updateField('email', value)}
            placeholder="Adresse réelle (optionnelle)"
          />
          <TruckField
            label="Coût horaire"
            value={formState.hourlyCostAmount}
            onChange={(value) => updateField('hourlyCostAmount', value)}
            placeholder="20 €/h"
          />
        </div>

        {canManageCredentials ? <div className="mt-5 rounded-[24px] border border-black/5 bg-[#F7F8F4] p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Accès chauffeur
            </p>
            <p className="mt-1 text-xs font-semibold text-[#7b8075]">
              Identifiants utilisés sur la page de connexion Gerard.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TruckField
              label="Username"
              value={formState.username}
              onChange={handleUsernameChange}
              placeholder="jmuller"
            />
            <TruckField
              label={driver ? 'Nouveau password' : 'Password'}
              value={formState.password}
              onChange={(value) => updateField('password', value)}
              placeholder={
                driver ? 'Laisser vide pour conserver' : '8 caractères min.'
              }
              type="password"
            />
          </div>
        </div> : null}

        {error ? (
          <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            {error}
          </p>
        ) : null}

        <FormActions
          canDelete={Boolean(onDelete)}
          deleteLabel="Supprimer chauffeur"
          isDeleting={isDeleting}
          isSubmitting={isSubmitting}
          submitLabel={driver ? 'Enregistrer' : 'Créer'}
          onDelete={handleDelete}
        />
            </div>
            <aside className="border-t border-black/[0.06] bg-[#f7f8f4] p-4 sm:p-5 lg:border-l lg:border-t-0 lg:p-6">
              {driver ? (
                <DriverRegulatorySummary
                  driverId={driver.id}
                  canCorrect={canManageCredentials}
                />
              ) : (
                <div className="flex min-h-[220px] items-center justify-center rounded-[24px] bg-white px-5 text-center text-xs font-semibold text-[#777d72]">
                  Le résumé opérationnel sera disponible après la création du chauffeur.
                </div>
              )}
            </aside>
          </div>
        </div>
      </form>
    </div>
  )
}

function TrailerFormModal({
  onMaintenanceUpdated,
  onClose,
  onDelete,
  onSubmit,
  trailer,
  trucks,
  activeMission,
  availableTrucks,
  canManage = true,
  onOpenMission,
  onRotated,
}: {
  onMaintenanceUpdated?: () => Promise<void> | void
  onClose: () => void
  onDelete?: () => Promise<void>
  onSubmit: (data: TrailerFormData) => Promise<void>
  trailer: Trailer | null
  activeMission?: TrailerActiveMission | null
  availableTrucks?: Truck[]
  canManage?: boolean
  onOpenMission?: (missionId: string) => void
  onRotated?: (result: TrailerRotationResult, toast: string) => void
  trucks: Truck[]
}) {
  const [formState, setFormState] = useState(() =>
    trailer
      ? {
          plateNumber: trailer.plateNumber,
          type: trailer.type,
          status: trailer.status,
          loadStatus: trailer.loadStatus ?? 'EMPTY',
          cargoType: trailer.cargoType ?? '',
          compatibleCargoTypes:
            trailer.compatibleCargoTypes?.join(', ') ?? '',
          cargoDescription: trailer.cargoDescription ?? '',
          notes: trailer.notes ?? '',
          truckId: trailer.truckId ?? '',
          technicalInspectionDate: formatTechnicalInspectionDateInput(
            trailer.technicalInspectionDate
          ),
          capacityKg:
            typeof trailer.capacityKg === 'number'
              ? String(trailer.capacityKg)
              : '',
          couplingType: trailer.couplingType ?? '',
        }
      : emptyTrailerForm
  )
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  function updateField(field: keyof typeof emptyTrailerForm, value: string) {
    setFormState((currentFormState) => ({
      ...currentFormState,
      [field]: value,
    }))
  }

  function getOptionalValue(value: string) {
    const trimmedValue = value.trim()
    return trimmedValue.length > 0 ? trimmedValue : null
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!formState.plateNumber.trim()) {
      setError('La plaque remorque est obligatoire.')
      return
    }

    const capacityRaw = formState.capacityKg.trim()
    let capacityKg: number | null = null
    if (capacityRaw !== '') {
      const parsed = Number(capacityRaw)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setError(
          'La capacité doit être un nombre entier de kilogrammes strictement positif.'
        )
        return
      }
      capacityKg = parsed
    }
    const compatibleCargoTypes = normalizeCompatibleCargoTypes(
      formState.compatibleCargoTypes
    )
    if (typeof compatibleCargoTypes === 'undefined') {
      setError(
        'Un type de marchandise compatible ne correspond pas à une valeur autorisée.'
      )
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)

      await onSubmit({
        plateNumber: formState.plateNumber.trim(),
        type: formState.type,
        status: formState.status,
        loadStatus: formState.loadStatus,
        cargoType:
          formState.loadStatus === 'LOADED'
            ? (formState.cargoType as TrailerCargoType | '') || null
            : null,
        compatibleCargoTypes:
          compatibleCargoTypes?.length ? compatibleCargoTypes : null,
        cargoDescription: getOptionalValue(formState.cargoDescription),
        notes: getOptionalValue(formState.notes),
        truckId: formState.truckId || null,
        technicalInspectionDate: formState.technicalInspectionDate || null,
        // Compatibilité technique : null = « Non renseigné » (jamais zéro).
        capacityKg,
        couplingType: formState.couplingType ? formState.couplingType : null,
      })
    } catch (submitError) {
      console.error('Unable to save trailer', submitError)
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Impossible d'enregistrer la remorque."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!onDelete) {
      return
    }

    const confirmed = window.confirm(
      'Supprimer cet élément ? Cette action est définitive.'
    )

    if (!confirmed) {
      return
    }

    try {
      setIsDeleting(true)
      setError(null)
      await onDelete()
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Impossible de supprimer la remorque.'
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center px-5 pb-32 sm:items-center sm:pb-0">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/10"
      />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 max-h-[86vh] w-full max-w-[560px] overflow-y-auto rounded-[32px] border border-black/10 bg-white p-6 shadow-[0_24px_80px_rgba(17,18,15,0.18)]"
      >
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#73796d]">
              Remorque
            </p>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight text-[#11130f]">
              {trailer ? trailer.plateNumber : 'Ajouter remorque'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] transition hover:border-lime-300 hover:text-[#405c08]"
          >
            Annuler
          </button>
        </div>

        {trailer ? (
          <div className="mt-4">
            <TrailerRotationPanel
              trailer={trailer}
              trucks={trucks}
              activeMission={activeMission ?? null}
              availableTrucks={availableTrucks}
              canManage={canManage}
              onOpenMission={onOpenMission}
              onRotated={onRotated}
            />
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TruckField
            label="Plaque remorque"
            value={formState.plateNumber}
            onChange={(value) => updateField('plateNumber', value)}
            placeholder="REM-NTX-705"
          />
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Type
            </span>
            <select
              value={formState.type}
              onChange={(event) =>
                updateField('type', event.target.value as TrailerType)
              }
              className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
            >
              {trailerTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {trailerTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Statut
            </span>
            <select
              value={formState.status}
              onChange={(event) =>
                updateField('status', event.target.value as TrailerStatus)
              }
              className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
            >
              {trailerStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {trailerStatusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Camion assigné
            </span>
            <select
              value={formState.truckId}
              onChange={(event) => updateField('truckId', event.target.value)}
              className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
            >
              <option value="">Aucun camion</option>
              {trucks.map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.plateNumber}
                  {truck.model ? ` · ${truck.model}` : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-[24px] border border-black/5 bg-[#F7F8F4] p-4 sm:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#73796d]">
                  Chargement
                </p>
                <p className="mt-1 text-xs font-semibold text-[#7a8074]">
                  État et nature de la marchandise transportée.
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label>
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
                  État
                </span>
                <select
                  value={formState.loadStatus}
                  onChange={(event) =>
                    updateField(
                      'loadStatus',
                      event.target.value as TrailerLoadStatus
                    )
                  }
                  className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:ring-4"
                >
                  {trailerLoadStatusOptions.map((loadStatus) => (
                    <option key={loadStatus} value={loadStatus}>
                      {trailerLoadStatusLabels[loadStatus]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
                  Type de chargement
                </span>
                <select
                  value={formState.cargoType}
                  disabled={formState.loadStatus === 'EMPTY'}
                  onChange={(event) =>
                    updateField(
                      'cargoType',
                      event.target.value as TrailerCargoType | ''
                    )
                  }
                  className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:ring-4 disabled:cursor-not-allowed disabled:bg-black/[0.04] disabled:text-[#9aa090]"
                >
                  <option value="">Aucun type</option>
                  {trailerCargoTypeOptions.map((cargoType) => (
                    <option key={cargoType} value={cargoType}>
                      {trailerCargoTypeLabels[cargoType]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
                  Description chargement
                </span>
                <input
                  value={formState.cargoDescription}
                  onChange={(event) =>
                    updateField('cargoDescription', event.target.value)
                  }
                  placeholder="Profilés aluminium Hydro, bois de construction..."
                  className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-sm font-semibold text-[#171814] outline-none transition placeholder:text-[#9aa090] focus:border-lime-300 focus:ring-4"
                />
              </label>
            </div>
          </div>
          <label className="sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Notes
            </span>
            <textarea
              value={formState.notes}
              onChange={(event) => updateField('notes', event.target.value)}
              placeholder="Optionnel"
              className="focus:ring-lime-200/35 mt-2 min-h-[84px] w-full resize-none rounded-2xl border border-black/10 bg-black/[0.025] px-4 py-3 text-sm font-semibold text-[#171814] outline-none transition placeholder:text-[#9aa090] focus:border-lime-300 focus:bg-white focus:ring-4"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Dernier contrôle technique
            </span>
            <input
              type="date"
              value={formState.technicalInspectionDate}
              onChange={(event) =>
                updateField('technicalInspectionDate', event.target.value)
              }
              className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
            />
            <TechnicalInspectionHelp
              value={formState.technicalInspectionDate}
            />
          </label>
        </div>

        <section className="mt-6 rounded-2xl border border-black/10 bg-black/[0.015] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
            Capacités et compatibilité
          </p>
          <p className="mt-1 text-xs text-[#8a9085]">
            Utilisées par la planification automatique. Laissez «{' '}
            {NOT_PROVIDED_LABEL} » si l’information n’est pas connue. Le camion
            attelé n’est jamais modifié depuis ici.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label>
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
                Capacité utile (kg)
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={formState.capacityKg}
                onChange={(event) =>
                  updateField('capacityKg', event.target.value)
                }
                placeholder={NOT_PROVIDED_LABEL}
                className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
              />
              <span className="mt-1 block text-[10px] text-[#9aa094]">
                {technicalFieldHints.trailerCapacity}
              </span>
            </label>
            <label className="sm:col-span-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
                Marchandises compatibles
              </span>
              <input
                value={formState.compatibleCargoTypes}
                onChange={(event) =>
                  updateField('compatibleCargoTypes', event.target.value)
                }
                placeholder="PALLETS, FOOD, STEEL"
                className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
              />
              <span className="mt-1 block text-[10px] text-[#9aa094]">
                Valeurs séparées par des virgules. Vide signifie « Non renseigné ».
              </span>
            </label>
            <label>
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
                Type d’attelage
              </span>
              <select
                value={formState.couplingType}
                onChange={(event) =>
                  updateField('couplingType', event.target.value)
                }
                className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
              >
                <option value="">{NOT_PROVIDED_LABEL}</option>
                {COUPLING_TYPE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {couplingTypeLabels[value]}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[10px] text-[#9aa094]">
                {technicalFieldHints.couplingType}
              </span>
            </label>
          </div>
        </section>

        {trailer ? (
          <VehicleMaintenanceSection
            vehicleId={trailer.id}
            vehicleType="TRAILER"
            plateNumber={trailer.plateNumber}
            onMaintenanceUpdated={onMaintenanceUpdated}
          />
        ) : null}

        {error ? (
          <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            {error}
          </p>
        ) : null}

        <FormActions
          canDelete={Boolean(onDelete)}
          deleteLabel="Supprimer remorque"
          isDeleting={isDeleting}
          isSubmitting={isSubmitting}
          submitLabel={trailer ? 'Enregistrer' : 'Créer'}
          onDelete={handleDelete}
        />
      </form>
    </div>
  )
}

function TruckFormModal({
  truck,
  onMaintenanceUpdated,
  onClose,
  onDelete,
  onSubmit,
}: {
  truck: Truck | null
  onMaintenanceUpdated?: () => Promise<void> | void
  onClose: () => void
  onDelete?: () => Promise<void>
  onSubmit: (data: TruckFormData) => Promise<void>
}) {
  const [formState, setFormState] = useState(() =>
    truck
      ? {
          plateNumber: truck.plateNumber,
          brand: truck.brand ?? '',
          model: truck.model ?? '',
          status: truck.status ?? 'AVAILABLE',
          gpsDeviceId: truck.gpsDeviceId ?? '',
          technicalInspectionDate: formatTechnicalInspectionDateInput(
            truck.technicalInspectionDate
          ),
          category: truck.category ?? '',
          capacityKg:
            typeof truck.capacityKg === 'number'
              ? String(truck.capacityKg)
              : '',
          couplingType: truck.couplingType ?? '',
        }
      : emptyTruckForm
  )
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  function updateField(field: keyof typeof emptyTruckForm, value: string) {
    setFormState((currentFormState) => ({
      ...currentFormState,
      [field]: value,
    }))
  }

  function getOptionalValue(value: string) {
    const trimmedValue = value.trim()
    return trimmedValue.length > 0 ? trimmedValue : undefined
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!formState.plateNumber.trim()) {
      setError('La plaque camion est obligatoire.')
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)

      await onSubmit({
        plateNumber: formState.plateNumber.trim(),
        brand: getOptionalValue(formState.brand),
        model: getOptionalValue(formState.model),
        status: formState.status,
        gpsDeviceId: getOptionalValue(formState.gpsDeviceId),
        technicalInspectionDate: formState.technicalInspectionDate || null,
        couplingType: formState.couplingType ? formState.couplingType : null,
      })
    } catch (submitError) {
      console.error('Unable to save truck', submitError)
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Impossible d'enregistrer le camion."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!onDelete) {
      return
    }

    const confirmed = window.confirm(
      'Supprimer cet élément ? Cette action est définitive.'
    )

    if (!confirmed) {
      return
    }

    try {
      setIsDeleting(true)
      setError(null)
      await onDelete()
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Impossible de supprimer le camion.'
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center px-5 pb-32 sm:items-center sm:pb-0">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/10"
      />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 max-h-[86vh] w-full max-w-[520px] overflow-y-auto rounded-[32px] border border-black/10 bg-white p-6 shadow-[0_24px_80px_rgba(17,18,15,0.18)]"
      >
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#73796d]">
              Camion
            </p>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight text-[#11130f]">
              {truck ? 'Modifier camion' : 'Ajouter camion'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] transition hover:border-lime-300 hover:text-[#405c08]"
          >
            Annuler
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TruckField
            label="Plaque camion"
            value={formState.plateNumber}
            onChange={(value) => updateField('plateNumber', value)}
            placeholder="LU-NTX-406"
          />
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Statut
            </span>
            <select
              value={formState.status}
              onChange={(event) =>
                updateField('status', event.target.value as TruckStatus)
              }
              className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
            >
              {truckStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {truckStatusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <TruckField
            label="Marque"
            value={formState.brand}
            onChange={(value) => updateField('brand', value)}
            placeholder="Mercedes"
          />
          <TruckField
            label="Modèle"
            value={formState.model}
            onChange={(value) => updateField('model', value)}
            placeholder="Actros"
          />
          <TruckField
            label="GPS device ID"
            value={formState.gpsDeviceId}
            onChange={(value) => updateField('gpsDeviceId', value)}
            placeholder="GPS-NTX-406"
          />
          <label className="sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Dernier contrôle technique
            </span>
            <input
              type="date"
              value={formState.technicalInspectionDate}
              onChange={(event) =>
                updateField('technicalInspectionDate', event.target.value)
              }
              className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
            />
            <TechnicalInspectionHelp
              value={formState.technicalInspectionDate}
            />
          </label>
        </div>

        <section className="mt-6 rounded-2xl border border-black/10 bg-black/[0.015] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
            Attelage du tracteur
          </p>
          <p className="mt-1 text-xs text-[#8a9085]">
            Caractéristique propre au tracteur. Les capacités de transport sont
            renseignées sur la remorque.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
                Type d’attelage
              </span>
              <select
                value={formState.couplingType}
                onChange={(event) =>
                  updateField('couplingType', event.target.value)
                }
                className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4"
              >
                <option value="">{NOT_PROVIDED_LABEL}</option>
                {COUPLING_TYPE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {couplingTypeLabels[value]}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[10px] text-[#9aa094]">
                {technicalFieldHints.couplingType}
              </span>
            </label>
          </div>
        </section>

        {truck ? (
          <VehicleMaintenanceSection
            vehicleId={truck.id}
            vehicleType="TRUCK"
            plateNumber={truck.plateNumber}
            onMaintenanceUpdated={onMaintenanceUpdated}
          />
        ) : null}

        {error ? (
          <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            {error}
          </p>
        ) : null}

        <FormActions
          canDelete={Boolean(onDelete)}
          deleteLabel="Supprimer camion"
          isDeleting={isDeleting}
          isSubmitting={isSubmitting}
          submitLabel={truck ? 'Enregistrer' : 'Créer'}
          onDelete={handleDelete}
        />
      </form>
    </div>
  )
}

function FormActions({
  canDelete,
  deleteLabel,
  isDeleting,
  isSubmitting,
  onDelete,
  submitLabel,
}: {
  canDelete: boolean
  deleteLabel: string
  isDeleting: boolean
  isSubmitting: boolean
  onDelete: () => void
  submitLabel: string
}) {
  return (
    <div className="mt-6 flex flex-col gap-2 sm:flex-row">
      {canDelete ? (
        <button
          type="button"
          disabled={isDeleting || isSubmitting}
          onClick={onDelete}
          className="h-12 rounded-2xl bg-red-50 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-[180px]"
        >
          {isDeleting ? 'Suppression...' : deleteLabel}
        </button>
      ) : null}
      <button
        type="submit"
        disabled={isSubmitting || isDeleting}
        className="h-12 flex-1 rounded-2xl bg-[#11130f] px-4 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(17,18,15,0.15)] transition hover:bg-[#B9FF4A] hover:text-[#11130F] disabled:cursor-not-allowed disabled:bg-black/20 disabled:text-white"
      >
        {isSubmitting ? 'Enregistrement...' : submitLabel}
      </button>
    </div>
  )
}

function TechnicalInspectionHelp({ value }: { value: string }) {
  const parsedDate = parseTechnicalInspectionDateInput(value)

  if (!value || parsedDate === null) {
    return (
      <p className="mt-2 text-xs font-semibold text-[#8a9085]">
        Aucune date de contrôle technique renseignée.
      </p>
    )
  }

  if (typeof parsedDate === 'undefined') {
    return (
      <p className="mt-2 text-xs font-semibold text-red-700">
        Date de contrôle technique invalide.
      </p>
    )
  }

  const expiresAt = getTechnicalInspectionExpiresAt(parsedDate)
  const alertDate = getTechnicalInspectionAlertDate(expiresAt)
  const expiresLabel = formatTechnicalInspectionDisplayDate(expiresAt)
  const alertLabel = formatTechnicalInspectionDisplayDate(alertDate)

  return (
    <p className="mt-2 text-xs font-semibold text-[#6f756a]">
      Valide jusqu’au : {expiresLabel ?? 'à calculer'} · Alerte à partir du :{' '}
      {alertLabel ?? 'à calculer'}
    </p>
  )
}

function TruckField({
  label,
  onChange,
  placeholder,
  type = 'text',
  value,
}: {
  label: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  value: string
}) {
  return (
    <label>
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition placeholder:text-[#9aa090] focus:border-lime-300 focus:bg-white focus:ring-4"
      />
    </label>
  )
}

function PencilIcon() {
  return null
}

type ResourceIconProps = {
  type: 'tasks' | 'truck' | 'driver' | 'trailer'
}

function ResourceIcon({ type }: ResourceIconProps) {
  if (type === 'trailer') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-[15px] w-[15px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.25 8.25h12.5v6.45H4.25z" />
        <path d="M16.75 11.5h2.95" />
        <path d="M7.2 18a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z" />
        <path d="M15.05 18a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z" />
      </svg>
    )
  }

  if (type === 'driver') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-[15px] w-[15px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 11.25a3.35 3.35 0 1 0 0-6.7 3.35 3.35 0 0 0 0 6.7z" />
        <path d="M5.25 19.45c.85-3.35 3.1-5.15 6.75-5.15s5.9 1.8 6.75 5.15" />
      </svg>
    )
  }

  if (type === 'truck') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-[15px] w-[15px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3.75 7.75h9.9v7.15h-9.9z" />
        <path d="M13.65 10.15h3.15l2.45 2.7v2.05h-5.6z" />
        <path d="M6.35 18a1.85 1.85 0 1 0 0-3.7 1.85 1.85 0 0 0 0 3.7z" />
        <path d="M17.25 18a1.85 1.85 0 1 0 0-3.7 1.85 1.85 0 0 0 0 3.7z" />
        <path d="M8.2 15.15h7.25" />
      </svg>
    )
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[15px] w-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.2 6.25h10.05" />
      <path d="M8.2 12h10.05" />
      <path d="M8.2 17.75h7.4" />
      <path d="M4.75 6.25h.01" />
      <path d="M4.75 12h.01" />
      <path d="M4.75 17.75h.01" />
    </svg>
  )
}
