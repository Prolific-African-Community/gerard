'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'

import {
  formatDateParam,
  getScheduledDateForWeekDay,
  getWeekEndDate,
  getWeekStartDate,
  parseWeekStartParam,
} from '../../../lib/dispatch/date-utils'
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
} from '../../../lib/dispatch/mock-data'
import { CreateMissionPanel } from '../CreateMissionPanel'
import type { CreateMissionFormData } from '../CreateMissionPanel'
import { ImportedMissionsPanel } from '../ImportedMissionsPanel'
import { InvoicesPanel } from '../InvoicesPanel'
import { MissionDetailPanel } from '../MissionDetailPanel'
import { ProfitabilityPanel } from '../ProfitabilityPanel'
import { MobileAssignmentSheet } from './MobileAssignmentSheet'
import { MobileDispatchHeader } from './MobileDispatchHeader'
import { MobileDriverList } from './MobileDriverList'
import { MobileMapPanel } from './MobileMapPanel'
import { MobileMissionQueue } from './MobileMissionQueue'
import { MobileResourceFormSheet } from './MobileResourceFormSheet'
import { DispatchSmartSearchPanel } from '../DispatchSmartSearch'
import { useLocatorHighlight } from '../useLocatorHighlight'
import type {
  LocatorNavigation,
  SmartSearchResult,
} from '../../../lib/dispatch/smart-search-navigation'
import type {
  DriverPayload,
  TrailerPayload,
  TruckPayload,
} from './MobileResourceFormSheet'
import { MobileTrailerList } from './MobileTrailerList'
import { MobileTruckList } from './MobileTruckList'
import type {
  MissionPlacement,
  MobileDispatchData,
  MobileTab,
  PlanningRow,
  TruckPosition,
} from './types'
import type { DispatchCapabilities } from '../../../lib/auth/dispatch-capabilities'
import { buildTrailerActiveMissions } from '../../../lib/dispatch/trailer-rotation'
import { MaintenanceRequestDialog } from '../MaintenanceRequestDialog'
import type { MaintenanceTarget } from '../MaintenanceRequestDialog'
import { ParkView } from '../../park/ParkView'
import type { ParkOverviewDTO } from '../../../lib/park/types'
import type { ViewMode } from '../WeeklyDispatchBoard'
import { AutoPlanningPanel } from '../auto-planning/AutoPlanningPanel'
import type { AutoPlanningPreview } from '../auto-planning/AutoPlanningPanel'

type DbMissionStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'ISSUE'
  | 'CANCELLED'
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
}

type ApiTruck = {
  id: string
  plateNumber: string
  brand: string | null
  model: string | null
  driverId: string | null
  gpsDeviceId: string | null
  status: TruckStatus
  statusUpdatedAt: string | null
  technicalInspectionDate: string | null
  technicalInspectionExpiresAt: string | null
  returnToBaseDistanceMeters: number | null
  returnToBaseDurationSeconds: number | null
  returnToBasePolyline: string | null
  returnToBaseCalculatedAt: string | null
  returnToBaseProvider: string | null
  category: string | null
  capacityKg: number | null
  couplingType: string | null
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
}

type ApiAssignment = {
  id: string
  missionId: string
  planningRowId: string | null
  driverId: string | null
  truckId: string | null
  trailerId: string | null
  day: DbPlanningDay
  approachDistanceMeters: number | null
  approachDurationSeconds: number | null
  approachPolyline: string | null
  approachCalculatedAt: string | null
  approachProvider: string | null
}

type ApiPlanningRow = {
  id: string
  weekStartDate: string
  sortOrder: number
  driverId: string | null
  truckId: string | null
  trailerId?: string | null
}

type DispatchOverviewResponse = {
  drivers: ApiDriver[]
  trucks: ApiTruck[]
  trailers: ApiTrailer[]
  missions: ApiMission[]
  assignments: ApiAssignment[]
  planningRows: ApiPlanningRow[]
  truckPositions: TruckPosition[]
}

type MissionResponse = {
  mission: ApiMission
}

type PlanningRowResponse = {
  row: ApiPlanningRow
}

const missionStatusByDbStatus: Record<DbMissionStatus, MissionStatus> = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  ISSUE: 'issue',
  CANCELLED: 'cancelled',
}

const dbStatusByMissionStatus: Record<MissionStatus, DbMissionStatus> = {
  pending: 'PENDING',
  assigned: 'ASSIGNED',
  in_progress: 'IN_PROGRESS',
  done: 'DONE',
  issue: 'ISSUE',
  cancelled: 'CANCELLED',
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

const dbDayByDispatchDay: Record<DispatchDay, DbPlanningDay> = {
  monday: 'MONDAY',
  tuesday: 'TUESDAY',
  wednesday: 'WEDNESDAY',
  thursday: 'THURSDAY',
  friday: 'FRIDAY',
  saturday: 'SATURDAY',
  sunday: 'SUNDAY',
}

const emptyData: MobileDispatchData = {
  drivers: [],
  trucks: [],
  trailers: [],
  missions: [],
  planningRows: [],
  truckPositions: [],
  placements: {},
  truckAssignments: {},
}

export function MobileDispatchView({
  displayName,
  capabilities,
  initialView,
  initialParkOverview,
}: {
  displayName: string
  capabilities: DispatchCapabilities
  initialView: ViewMode
  initialParkOverview: ParkOverviewDTO | null
}) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<MobileTab>(
    initialView === 'park'
      ? 'park'
      : initialView === 'map'
        ? 'map'
        : initialView === 'profitability'
          ? 'profitability'
          : initialView === 'invoices'
            ? 'invoices'
            : 'missions'
  )
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
  const [data, setData] = useState<MobileDispatchData>(emptyData)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(
    null
  )
  const [assignmentMissionId, setAssignmentMissionId] = useState<string | null>(
    null
  )
  const [isAssignmentSaving, setIsAssignmentSaving] = useState(false)
  const [isCreateMissionOpen, setIsCreateMissionOpen] = useState(false)
  const [isImportedMissionsOpen, setIsImportedMissionsOpen] = useState(false)
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null)
  const [editingTruckId, setEditingTruckId] = useState<string | null>(null)
  const [editingTrailerId, setEditingTrailerId] = useState<string | null>(null)
  const [maintenanceTarget, setMaintenanceTarget] = useState<MaintenanceTarget | null>(null)
  const [isAutoPlanningOpen, setIsAutoPlanningOpen] = useState(false)
  const [autoPlanningPreview, setAutoPlanningPreview] =
    useState<AutoPlanningPreview | null>(null)
  const [rotationNotice, setRotationNotice] = useState<string | null>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const { requestHighlight } = useLocatorHighlight()
  const [autoPlanningNotice, setAutoPlanningNotice] = useState<string | null>(
    null
  )
  const visibleTabs: MobileTab[] = [
    ...(capabilities.canViewPlanning
      ? (['missions', 'drivers', 'trucks', 'trailers'] as const)
      : []),
    ...(capabilities.canViewMap ? (['map'] as const) : []),
    ...(capabilities.canViewProfitability ? (['profitability'] as const) : []),
    ...(capabilities.canViewInvoices ? (['invoices'] as const) : []),
    ...(capabilities.canViewPark ? (['park'] as const) : []),
  ]

  /**
   * Même logique locator que sur desktop : seule la cible d'affichage change
   * (onglet plein écran au lieu du bandeau). Aucune règle métier n'est
   * dupliquée ici.
   */
  function handleLocatorSelect(
    result: SmartSearchResult,
    navigation: LocatorNavigation
  ) {
    if (navigation.weekStart) {
      const targetWeek = parseWeekStartParam(navigation.weekStart)
      if (targetWeek) handleWeekChange(targetWeek)
    }

    const tab: MobileTab =
      navigation.target.kind === 'mission'
        ? 'missions'
        : navigation.target.kind === 'truck'
          ? 'trucks'
          : 'trailers'

    if (visibleTabs.includes(tab)) handleTabChange(tab)
    requestHighlight(navigation.target)
  }

  function handleTabChange(tab: MobileTab) {
    setActiveTab(tab)
    const view =
      tab === 'park' || tab === 'map' || tab === 'profitability' || tab === 'invoices'
        ? tab
        : 'planning'
    void router.replace(
      { pathname: router.pathname, query: { ...router.query, view } },
      undefined,
      { shallow: true, scroll: false }
    )
  }

  const selectedMission =
    data.missions.find((mission) => mission.id === selectedMissionId) ?? null
  const assignmentMission =
    data.missions.find((mission) => mission.id === assignmentMissionId) ?? null
  const editingDriver =
    data.drivers.find((driver) => driver.id === editingDriverId) ?? null
  const editingTruck =
    data.trucks.find((truck) => truck.id === editingTruckId) ?? null
  // Engagement mission dérivé des affectations réelles, comme sur desktop.
  const trailerActiveMissions = useMemo(
    () =>
      buildTrailerActiveMissions(
        data.missions,
        (mission) => data.placements[mission.id]?.trailerId
      ),
    [data.missions, data.placements]
  )

  /**
   * Même comportement que le desktop : correction locale immédiate, aucun
   * rechargement global, mission jamais modifiée ici.
   */
  function handleTrailerRotated(
    result: {
      trailer?: { id: string; truckId?: string | null; loadStatus?: string }
    },
    toast: string
  ) {
    const rotated = result.trailer
    if (rotated) {
      setData((currentData) => ({
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
    setRotationNotice(toast)
  }

  const editingTrailer =
    data.trailers.find((trailer) => trailer.id === editingTrailerId) ?? null

  async function refreshOverview(signal?: AbortSignal) {
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
    setData(mapOverview(overview))
  }

  useEffect(() => {
    if (!capabilities.canViewPlanning) {
      setIsLoading(false)
      return
    }
    const controller = new AbortController()

    async function load() {
      try {
        setIsLoading(true)
        setError(null)
        await refreshOverview(controller.signal)
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === 'AbortError'
        ) {
          return
        }

        console.error('Unable to load mobile dispatch overview', loadError)
        setError('Impossible de charger le dispatch mobile.')
      } finally {
        setIsLoading(false)
      }
    }

    load()

    return () => controller.abort()
  }, [capabilities.canViewPlanning, selectedWeekStartDate])

  const selectedMissionPlacement = selectedMission
    ? data.placements[selectedMission.id]
    : null
  const selectedDriver = selectedMissionPlacement?.driverId
    ? data.drivers.find(
        (driver) => driver.id === selectedMissionPlacement.driverId
      )
    : undefined
  const selectedTruck = selectedMissionPlacement?.truckId
    ? data.trucks.find((truck) => truck.id === selectedMissionPlacement.truckId)
    : undefined

  async function handleCreateMission(formData: CreateMissionFormData) {
    const response = await fetch('/api/dispatch/create-mission', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...formData,
        status: formData.status
          ? dbStatusByMissionStatus[formData.status]
          : undefined,
      }),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      throw new Error(body?.error ?? 'Impossible de créer la mission.')
    }

    const result = (await response.json()) as {
      mission: { id: string; reference: string; preparationStatus?: string }
      warnings?: string[]
      preparationStatus?: string
    }
    await refreshOverview()
    return {
      mission: result.mission,
      warnings: result.warnings ?? [],
      preparationStatus:
        result.preparationStatus ??
        result.mission.preparationStatus ??
        'PENDING',
    }
  }

  async function handleUpdateMission(formData: CreateMissionFormData) {
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
        ...formData,
        status: formData.status
          ? dbStatusByMissionStatus[formData.status]
          : undefined,
      }),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      throw new Error(body?.error ?? 'Impossible de modifier la mission.')
    }

    const result = (await response.json()) as MissionResponse
    const mission = mapApiMission(result.mission)
    setData((currentData) => ({
      ...currentData,
      missions: currentData.missions.map((currentMission) =>
        currentMission.id === mission.id ? mission : currentMission
      ),
    }))
  }

  async function handleDeleteMission(missionId: string) {
    await deleteJson(`/api/dispatch/missions/${missionId}`)
    await refreshOverview()
    setSelectedMissionId(null)
  }

  async function handleMissionStatusChange(
    missionId: string,
    status: MissionStatus
  ) {
    const response = await fetch('/api/dispatch/update-mission-status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        missionId,
        status: dbStatusByMissionStatus[status],
      }),
    })

    if (!response.ok) {
      return
    }

    await refreshOverview()
  }

  async function handleUnassignMission(missionId: string) {
    const response = await fetch('/api/dispatch/unassign-mission', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ missionId }),
    })

    if (response.ok) {
      await refreshOverview()
    }
  }

  async function handleMarkPreAnnouncementSent(missionId: string) {
    const response = await fetch('/api/dispatch/mark-preannouncement-sent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ missionId }),
    })

    if (!response.ok) {
      throw new Error('Pré-annonce impossible à marquer.')
    }

    await refreshOverview()
  }

  async function handleAssignMission({
    day,
    driverId,
    truckId,
    trailerId,
  }: {
    day: DispatchDay
    driverId: string | null
    truckId: string | null
    trailerId: string | null
  }) {
    if (!assignmentMission) {
      return
    }

    try {
      setIsAssignmentSaving(true)
      let row =
        (driverId
          ? data.planningRows.find((item) => item.driverId === driverId)
          : undefined) ??
        (truckId
          ? data.planningRows.find((item) => item.truckId === truckId)
          : undefined) ??
        data.planningRows.find((item) => !item.driverId && !item.truckId)

      if (!row) {
        row = await createPlanningRow(selectedWeekStartDate)
      }

      if (
        row.driverId !== driverId ||
        row.truckId !== truckId ||
        row.trailerId !== trailerId
      ) {
        row = await patchPlanningRow(row.id, {
          driverId,
          truckId,
          trailerId,
        })
      }

      await postJson('/api/dispatch/assign-mission', {
        missionId: assignmentMission.id,
        planningRowId: row.id,
        driverId,
        truckId,
        day: dbDayByDispatchDay[day],
        scheduledDate: getScheduledDateForWeekDay(selectedWeekStartDate, day),
        sortOrder: 0,
      })

      await refreshOverview()
      setAssignmentMissionId(null)
    } finally {
      setIsAssignmentSaving(false)
    }
  }

  async function handleSaveDriver(driverId: string, payload: DriverPayload) {
    await patchJson(`/api/dispatch/drivers/${driverId}`, payload)
    await refreshOverview()
    setEditingDriverId(null)
  }

  async function handleDeleteDriver(driverId: string) {
    await deleteJson(`/api/dispatch/drivers/${driverId}`)
    await refreshOverview()
    setEditingDriverId(null)
  }

  async function handleSaveTruck(truckId: string, payload: TruckPayload) {
    await patchJson(`/api/dispatch/trucks/${truckId}`, payload)
    await refreshOverview()
    setEditingTruckId(null)
  }

  async function handleDeleteTruck(truckId: string) {
    await deleteJson(`/api/dispatch/trucks/${truckId}`)
    await refreshOverview()
    setEditingTruckId(null)
  }

  async function handleSaveTrailer(trailerId: string, payload: TrailerPayload) {
    await patchJson(`/api/dispatch/trailers/${trailerId}`, {
      plateNumber: payload.plateNumber,
      type: payload.type,
      status: payload.status,
      loadStatus: payload.loadStatus,
      cargoType: payload.cargoType,
      compatibleCargoTypes: payload.compatibleCargoTypes,
      cargoDescription: payload.cargoDescription,
      notes: payload.notes,
      technicalInspectionDate: payload.technicalInspectionDate,
      capacityKg: payload.capacityKg,
      couplingType: payload.couplingType,
    })

    if (typeof payload.truckId !== 'undefined') {
      await postJson('/api/dispatch/assign-trailer', {
        trailerId,
        truckId: payload.truckId,
      })
    }

    await refreshOverview()
    setEditingTrailerId(null)
  }

  async function handleDeleteTrailer(trailerId: string) {
    await deleteJson(`/api/dispatch/trailers/${trailerId}`)
    await refreshOverview()
    setEditingTrailerId(null)
  }

  return (
    <section className="min-h-screen bg-[#F4F5F1] text-[#171814]">
      <MobileDispatchHeader
        activeTab={activeTab}
        selectedWeekStartDate={selectedWeekStartDate}
        onCreateMission={() => setIsCreateMissionOpen(true)}
        onOpenImports={() => setIsImportedMissionsOpen(true)}
        onTabChange={handleTabChange}
        onWeekChange={handleWeekChange}
        displayName={displayName}
        visibleTabs={visibleTabs}
        canCreateMission={capabilities.canCreateMission}
        canViewImports={capabilities.canViewImports}
        canAutoPlan={capabilities.canAssign}
        onOpenAutoPlanning={() => setIsAutoPlanningOpen(true)}
        onOpenSearch={
          capabilities.canViewPlanning ? () => setIsSearchOpen(true) : undefined
        }
      />

      <DispatchSmartSearchPanel
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        weekStart={formatDateParam(selectedWeekStartDate)}
        onSelect={handleLocatorSelect}
        variant="mobile"
      />

      {rotationNotice ? (
        <p
          data-rotation-notice
          className="mx-4 mt-3 rounded-2xl border border-lime-200 bg-lime-50 px-4 py-3 text-xs font-semibold text-[#49630b]"
        >
          {rotationNotice}
        </p>
      ) : null}

      {autoPlanningNotice ? (
        <p className="mx-4 mt-3 rounded-2xl bg-[#11130f] px-4 py-3 text-xs font-semibold text-white">
          {autoPlanningNotice}
        </p>
      ) : null}

      {autoPlanningPreview && activeTab !== 'park' ? (
        <p className="mx-4 mt-3 rounded-2xl bg-[#eaffc8] px-4 py-3 text-xs font-semibold text-[#263115]">
          Prévisualisation ·{' '}
          {autoPlanningPreview.result.metrics.confirmedMissions} mission(s)
          confirmée(s). Les données réelles ne sont pas modifiées.
        </p>
      ) : null}

      {activeTab !== 'park' && !capabilities.canAssign ? (
        <p className="px-4 pt-3 text-xs font-semibold text-[#747a6f]">
          {capabilities.canEditMission
            ? 'Affectation réservée au Dispatcher.'
            : 'Planning en lecture seule.'}
        </p>
      ) : null}

      {error ? (
        <div className="px-4 pt-4">
          <p className="rounded-[24px] border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </p>
        </div>
      ) : null}

      {isLoading ? (
        <div className="px-4 pt-4">
          <p className="rounded-[24px] bg-white px-4 py-5 text-sm font-semibold text-[#747a6f] shadow-[0_10px_30px_rgba(17,18,15,0.05)]">
            Chargement du dispatch...
          </p>
        </div>
      ) : null}

      {!isLoading && activeTab === 'missions' ? (
        <MobileMissionQueue
          drivers={data.drivers}
          missions={data.missions}
          placements={data.placements}
          trailers={data.trailers}
          trucks={data.trucks}
          onAssign={(mission) => setAssignmentMissionId(mission.id)}
          onDetails={(mission) => setSelectedMissionId(mission.id)}
          onEdit={(mission) => setSelectedMissionId(mission.id)}
          canAssign={capabilities.canAssign}
          canEdit={capabilities.canEditMission}
          weekStartDate={selectedWeekStartDate}
          weekEndDate={getWeekEndDate(selectedWeekStartDate)}
        />
      ) : null}

      {!isLoading && activeTab === 'drivers' ? (
        <MobileDriverList
          drivers={data.drivers}
          onEdit={capabilities.canManageDrivers ? (driver) => setEditingDriverId(driver.id) : undefined}
        />
      ) : null}

      {!isLoading && activeTab === 'trucks' ? (
        <MobileTruckList
          drivers={data.drivers}
          missions={data.missions}
          placements={data.placements}
          trailers={data.trailers}
          trucks={data.trucks}
          truckPositions={data.truckPositions}
          onEdit={capabilities.canManageTrucks ? (truck) => setEditingTruckId(truck.id) : undefined}
          onShowMap={() => setActiveTab('map')}
          onMaintenance={!capabilities.canManageTrucks && capabilities.canRequestMaintenance
            ? (truck) => setMaintenanceTarget({ id: truck.id, type: 'TRUCK', label: truck.plateNumber })
            : undefined}
        />
      ) : null}

      {!isLoading && activeTab === 'trailers' ? (
        <MobileTrailerList
          trailers={data.trailers}
          trucks={data.trucks}
          onEdit={capabilities.canManageTrailers ? (trailer) => setEditingTrailerId(trailer.id) : undefined}
          onMaintenance={!capabilities.canManageTrailers && capabilities.canRequestMaintenance
            ? (trailer) => setMaintenanceTarget({ id: trailer.id, type: 'TRAILER', label: trailer.plateNumber })
            : undefined}
        />
      ) : null}

      {!isLoading && activeTab === 'map' ? (
        <MobileMapPanel
          drivers={data.drivers}
          missions={data.missions}
          placements={data.placements}
          trailers={data.trailers}
          trucks={data.trucks}
          truckPositions={data.truckPositions}
          onRefresh={refreshOverview}
        />
      ) : null}

      {!isLoading && activeTab === 'profitability' ? (
        <ProfitabilityPanel weekStart={selectedWeekStartDate} compact />
      ) : null}

      {!isLoading && activeTab === 'invoices' ? (
        <div className="px-4">
          <InvoicesPanel missions={data.missions} />
        </div>
      ) : null}

      {activeTab === 'park' && initialParkOverview ? (
        <div className="px-3 pt-3">
          <ParkView initialOverview={initialParkOverview} />
        </div>
      ) : null}

      <AutoPlanningPanel
        isOpen={isAutoPlanningOpen}
        weekStart={formatDateParam(selectedWeekStartDate)}
        onClose={() => setIsAutoPlanningOpen(false)}
        onPreviewChange={setAutoPlanningPreview}
        onApplied={(result) => {
          setAutoPlanningPreview(null)
          setAutoPlanningNotice(
            `${result.appliedMissionIds.length} mission(s) appliquée(s) au planning.`
          )
          void refreshOverview()
        }}
      />

      {capabilities.canAssign ? <MobileAssignmentSheet
        drivers={data.drivers}
        isSaving={isAssignmentSaving}
        mission={assignmentMission}
        placement={
          assignmentMission ? data.placements[assignmentMission.id] : null
        }
        trailers={data.trailers}
        trucks={data.trucks}
        onAssign={handleAssignMission}
        onClose={() => setAssignmentMissionId(null)}
      /> : null}

      {capabilities.canCreateMission ? <CreateMissionPanel
        isOpen={isCreateMissionOpen}
        onClose={() => setIsCreateMissionOpen(false)}
        onCreate={handleCreateMission}
      /> : null}

      {capabilities.canViewImports && capabilities.canCreateMission ? <ImportedMissionsPanel
        isOpen={isImportedMissionsOpen}
        onClose={() => setIsImportedMissionsOpen(false)}
        onCreateMission={handleCreateMission}
      /> : null}

      <MissionDetailPanel
        mission={selectedMission}
        trailers={data.trailers}
        plannedTrailerId={selectedMission?.trailerId}
        driverName={selectedDriver?.name}
        truckLabel={selectedTruck?.plateNumber}
        day={selectedMissionPlacement?.day}
        onClose={() => setSelectedMissionId(null)}
        onMarkPreAnnouncementSent={handleMarkPreAnnouncementSent}
        onStatusChange={handleMissionStatusChange}
        onUnassign={handleUnassignMission}
        onUpdate={handleUpdateMission}
        onPlannedTrailerChange={async (missionId, trailerId) => {
          const response = await fetch(
            `/api/dispatch/missions/${encodeURIComponent(missionId)}/planned-trailer`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ trailerId }),
            },
          )
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null
            throw new Error(body?.error ?? 'Impossible de modifier la remorque planifiée.')
          }
          await refreshOverview()
        }}
        onDelete={capabilities.canDeleteMission ? handleDeleteMission : undefined}
        canEdit={capabilities.canEditMission}
        canAssign={capabilities.canAssign}
      />

      <MobileResourceFormSheet
        driver={editingDriver}
        trailer={editingTrailer}
        truck={editingTruck}
        trucks={data.trucks}
        onClose={() => {
          setEditingDriverId(null)
          setEditingTruckId(null)
          setEditingTrailerId(null)
        }}
        onSaveDriver={handleSaveDriver}
        onDeleteDriver={capabilities.canDeleteResources ? handleDeleteDriver : undefined}
        onSaveTrailer={handleSaveTrailer}
        onDeleteTrailer={capabilities.canDeleteResources ? handleDeleteTrailer : undefined}
        onSaveTruck={handleSaveTruck}
        onDeleteTruck={capabilities.canDeleteResources ? handleDeleteTruck : undefined}
        canManageDriverCredentials={capabilities.canManageDriverCredentials}
        trailerActiveMission={
          editingTrailer ? trailerActiveMissions[editingTrailer.id] ?? null : null
        }
        availableTrucks={data.trucks.filter(
          (truck) => !data.trailers.some((item) => item.truckId === truck.id)
        )}
        canManageTrailers={capabilities.canManageTrailers}
        onOpenMission={(missionId) => {
          setEditingTrailerId(null)
          setSelectedMissionId(missionId)
        }}
        onTrailerRotated={handleTrailerRotated}
      />
      <MaintenanceRequestDialog
        target={maintenanceTarget}
        onClose={() => setMaintenanceTarget(null)}
        onUpdated={refreshOverview}
      />
    </section>
  )
}

function mapOverview(overview: DispatchOverviewResponse): MobileDispatchData {
  const missions = overview.missions.map(mapApiMission)
  const placements = overview.assignments.reduce<
    Record<string, MissionPlacement | null>
  >((items, assignment) => {
    items[assignment.missionId] = {
      assignmentId: assignment.id,
      planningRowId: assignment.planningRowId,
      driverId: assignment.driverId,
      trailerId: assignment.trailerId,
      truckId: assignment.truckId,
      day: dispatchDayByDbDay[assignment.day],
      approachDistanceMeters: assignment.approachDistanceMeters ?? undefined,
      approachDurationSeconds: assignment.approachDurationSeconds ?? undefined,
      approachPolyline: assignment.approachPolyline ?? undefined,
      approachCalculatedAt: assignment.approachCalculatedAt ?? undefined,
      approachProvider: assignment.approachProvider ?? undefined,
    }
    return items
  }, {})

  missions.forEach((mission) => {
    if (!(mission.id in placements)) {
      placements[mission.id] = null
    }
  })

  const trucks = overview.trucks.map(mapApiTruck)

  return {
    drivers: overview.drivers.map(mapApiDriver),
    trucks,
    trailers: overview.trailers.map(mapApiTrailer),
    missions,
    planningRows: overview.planningRows.map(mapApiPlanningRow),
    truckPositions: overview.truckPositions,
    placements,
    truckAssignments: trucks.reduce<Record<string, string | null>>(
      (items, truck) => {
        items[truck.id] = truck.driverId ?? null
        return items
      },
      {}
    ),
  }
}

function mapApiMission(mission: ApiMission): Mission {
  return {
    id: mission.id,
    reference: mission.reference,
    shortLabel: mission.title ?? mission.clientName ?? 'Mission à compléter',
    clientName: mission.clientName ?? 'Client à compléter',
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
    category: truck.category,
    capacityKg: truck.capacityKg,
    couplingType: truck.couplingType,
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
    capacityKg: trailer.capacityKg,
    couplingType: trailer.couplingType,
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
  }
}

async function postJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(errorBody?.error ?? `Request failed: ${path}`)
  }

  return response
}

async function patchJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(errorBody?.error ?? `Request failed: ${path}`)
  }

  return response
}

async function deleteJson(path: string) {
  const response = await fetch(path, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error ?? 'Suppression impossible.')
  }
}

async function createPlanningRow(weekStartDate: Date) {
  const response = await postJson('/api/dispatch/planning-rows', {
    weekStart: formatDateParam(weekStartDate),
  })
  const result = (await response.json()) as PlanningRowResponse
  return mapApiPlanningRow(result.row)
}

async function patchPlanningRow(
  rowId: string,
  body: {
    driverId?: string | null
    truckId?: string | null
    trailerId?: string | null
  }
) {
  const response = await fetch(`/api/dispatch/planning-rows/${rowId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(errorBody?.error ?? 'Impossible de modifier la ligne.')
  }

  const result = (await response.json()) as PlanningRowResponse
  return mapApiPlanningRow(result.row)
}
