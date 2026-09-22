'use client'

import { controlPanelClass } from '../ui/ControlKit'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type {
  CollisionDetection,
  DragEndEvent,
  DragStartEvent,
} from '@dnd-kit/core'
import { ParkVehicleType } from '@prisma/client'

import type {
  ParkOverviewDTO,
  ParkSpotDTO,
  ParkVehicleDTO,
} from '../../lib/park/types'
import type { ParkInspectionSummaryDTO } from '../../lib/park/inspection-types'
import { ParkGridBoard } from './ParkGridBoard'
import { ResourcePanel } from './ResourcePanel'
import { DetailPanel } from './DetailPanel'
import type { ParkSelection } from './DetailPanel'
import { HistoryPanel } from './HistoryPanel'
import { STATUS_META, VehicleTypeIcon } from './parkKit'
import { InspectionDrawer } from './InspectionDrawer'

const MIN_SCALE = 0.35
const MAX_SCALE = 1.4

// Les places poids lourds sont volontairement étroites sur le plan. La
// position du pointeur désigne donc prioritairement la cellule, puis la
// collision rectangulaire sert de repli au clavier et aux capteurs sans
// coordonnées de pointeur.
const parkGridCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  return pointerCollisions.length > 0
    ? pointerCollisions
    : rectIntersection(args)
}

type ParkViewProps = {
  initialOverview: ParkOverviewDTO
}

type ActiveParkDrag =
  | { kind: 'vehicle'; vehicle: ParkVehicleDTO }
  | {
      kind: 'ensemble'
      truck: ParkVehicleDTO
      trailer: ParkVehicleDTO | null
    }

export function ParkView({ initialOverview }: ParkViewProps) {
  const [overview, setOverview] = useState<ParkOverviewDTO>(initialOverview)
  const [selection, setSelection] = useState<ParkSelection | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [resourcesOpen, setResourcesOpen] = useState(true)
  const [scale, setScale] = useState(0.6)
  const [recenterToken, setRecenterToken] = useState(0)
  const [activeDrag, setActiveDrag] = useState<ActiveParkDrag | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [inspectionVehicle, setInspectionVehicle] =
    useState<ParkVehicleDTO | null>(null)
  const [inspectionSummaries, setInspectionSummaries] = useState<
    Map<string, ParkInspectionSummaryDTO>
  >(new Map())

  const { capabilities } = overview
  const canMove = capabilities.canMove

  const { spotsById, vehiclesById, vehiclesBySpot } = useMemo(() => {
    const spotsById = new Map(overview.spots.map((spot) => [spot.id, spot]))
    const vehiclesById = new Map(
      overview.vehicles.map((vehicle) => [vehicle.id, vehicle])
    )
    const vehiclesBySpot = new Map<string, ParkVehicleDTO[]>()
    for (const vehicle of overview.vehicles) {
      if (!vehicle.spotId) continue
      const list = vehiclesBySpot.get(vehicle.spotId) ?? []
      list.push(vehicle)
      vehiclesBySpot.set(vehicle.spotId, list)
    }
    return { spotsById, vehiclesById, vehiclesBySpot }
  }, [overview])

  const kpis = useMemo(() => deriveKpis(overview), [overview])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 140, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  )

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/park/overview')
      const data = await response.json()
      if (response.ok) setOverview(data)
    } catch {
      /* silencieux — l'état optimiste reste affiché */
    }
  }, [])

  const refreshInspectionSummaries = useCallback(async () => {
    if (!capabilities.canViewInspections) return
    try {
      const response = await fetch('/api/park/inspections?summary=true')
      const data = (await response.json()) as {
        summaries?: ParkInspectionSummaryDTO[]
      }
      if (response.ok) {
        setInspectionSummaries(
          new Map(
            (data.summaries ?? []).map((summary) => [
              `${summary.vehicleType}:${summary.vehicleId}`,
              summary,
            ])
          )
        )
      }
    } catch {
      /* Le Parc reste utilisable si l'historique des contrôles est indisponible. */
    }
  }, [capabilities.canViewInspections])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void refreshInspectionSummaries()
  }, [refreshInspectionSummaries])

  useEffect(() => {
    if (window.innerWidth < 640) {
      setScale(0.35)
    } else if (window.innerHeight < 850) {
      setScale(0.68)
    } else {
      setScale(0.82)
    }
  }, [])

  async function performMove(
    vehicle: ParkVehicleDTO,
    toSpotId: string,
    note: string
  ) {
    if (!canMove) return
    const snapshot = overview
    setBusy(true)
    setError('')
    setNotice('')
    setOverview((current) => applyMoveLocally(current, vehicle.id, vehicle.type, toSpotId))
    try {
      const response = await fetch('/api/park/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleType: vehicle.type,
          vehicleId: vehicle.id,
          toSpotId,
          note: note || undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setOverview(snapshot)
        setError(data.error ?? 'Déplacement impossible.')
        return
      }
      const target = spotsById.get(toSpotId)
      setNotice(
        `${vehicle.plateNumber} déplacé vers ${target?.code ?? 'l’emplacement'}.`
      )
      await refresh()
    } catch {
      setOverview(snapshot)
      setError('Déplacement impossible.')
    } finally {
      setBusy(false)
    }
  }

  async function performUnlocate(vehicle: ParkVehicleDTO, note: string) {
    if (!canMove || !vehicle.spotId) return
    const snapshot = overview
    setBusy(true)
    setError('')
    setNotice('')
    setOverview((current) => applyUnlocateLocally(current, vehicle.id, vehicle.type))
    try {
      const response = await fetch('/api/park/unlocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleType: vehicle.type,
          vehicleId: vehicle.id,
          note: note || undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setOverview(snapshot)
        setError(data.error ?? 'Retrait impossible.')
        return
      }
      setNotice(`${vehicle.plateNumber} retiré du parc.`)
      await refresh()
    } catch {
      setOverview(snapshot)
      setError('Retrait impossible.')
    } finally {
      setBusy(false)
    }
  }

  async function performNote(spot: ParkSpotDTO, note: string) {
    if (!canMove) return
    const snapshot = overview
    setBusy(true)
    setError('')
    setOverview((current) => ({
      ...current,
      spots: current.spots.map((item) =>
        item.id === spot.id ? { ...item, note: note.trim() || null } : item
      ),
    }))
    try {
      const response = await fetch('/api/park/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotId: spot.id, note: note.trim() || null }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Note impossible à enregistrer.')
      setNotice('Note de positionnement enregistrée.')
      await refresh()
    } catch (saveError) {
      setOverview(snapshot)
      setError(saveError instanceof Error ? saveError.message : 'Note impossible à enregistrer.')
    } finally {
      setBusy(false)
    }
  }

  async function performEnsembleMove(truck: ParkVehicleDTO, toSpotId: string) {
    if (!canMove) return
    const trailer = truck.linkedTrailerId
      ? vehiclesById.get(truck.linkedTrailerId) ?? null
      : null
    const snapshot = overview
    setBusy(true)
    setError('')
    setNotice('')
    if (trailer) {
      setOverview((current) =>
        applyEnsembleMoveLocally(current, truck.id, trailer.id, toSpotId)
      )
    }
    try {
      const response = await fetch('/api/park/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleType: 'ENSEMBLE',
          vehicleId: truck.id,
          toSpotId,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Positionnement de l’ensemble impossible.')
      setNotice(`${truck.plateNumber} et ${truck.linkedPlateNumber ?? 'sa remorque'} positionnés.`)
      await refresh()
    } catch (moveError) {
      setOverview(snapshot)
      setError(moveError instanceof Error ? moveError.message : 'Positionnement de l’ensemble impossible.')
    } finally {
      setBusy(false)
    }
  }

  function handleDragStart(event: DragStartEvent) {
    if (!canMove) return
    const data = event.active.data.current
    if (data?.kind === 'vehicle') {
      const vehicle = vehiclesById.get(data.vehicleId as string)
      if (vehicle) setActiveDrag({ kind: 'vehicle', vehicle })
    } else if (data?.kind === 'ensemble') {
      const truck = vehiclesById.get(data.truckId as string)
      if (!truck) return
      const trailer = data.trailerId
        ? vehiclesById.get(data.trailerId as string) ?? null
        : truck.linkedTrailerId
        ? vehiclesById.get(truck.linkedTrailerId) ?? null
        : null
      setActiveDrag({ kind: 'ensemble', truck, trailer })
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeData = event.active.data.current
    const overData = event.over?.data.current
    setActiveDrag(null)
    if (!activeData || !overData) return
    if (activeData.kind === 'ensemble') {
      const truck = vehiclesById.get(activeData.truckId as string)
      if (truck && overData.kind === 'spot') {
        void performEnsembleMove(truck, overData.spotId as string)
      }
      return
    }
    if (activeData.kind !== 'vehicle') return
    const vehicle = vehiclesById.get(activeData.vehicleId as string)
    if (!vehicle) return
    if (overData.kind === 'spot') {
      if (vehicle.spotId === overData.spotId) return
      void performMove(vehicle, overData.spotId as string, '')
    } else if (overData.kind === 'unlocate') {
      void performUnlocate(vehicle, '')
    }
  }

  const historyForSelection = useMemo(() => {
    if (!selection) return overview.recentHistory
    if (selection.kind === 'vehicle') {
      return overview.recentHistory.filter(
        (movement) =>
          movement.truckId === selection.vehicleId ||
          movement.trailerId === selection.vehicleId
      )
    }
    const spot = spotsById.get(selection.spotId)
    if (!spot) return overview.recentHistory
    return overview.recentHistory.filter(
      (movement) =>
        movement.fromSpotCode === spot.code || movement.toSpotCode === spot.code
    )
  }, [selection, overview.recentHistory, spotsById])

  return (
    <DndContext
      sensors={canMove && !busy ? sensors : []}
      collisionDetection={parkGridCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
      <div
        className={`mx-auto flex w-full max-w-[1920px] flex-col ${
          resourcesOpen ? 'pb-[224px] md:pb-[168px]' : 'pb-4'
        }`}
      >
        <div className="flex min-h-0 flex-col">
          <section
            aria-label="Plan interactif du parc"
            className="relative h-[calc(100dvh-404px)] min-h-[360px] max-h-[560px] overflow-hidden rounded-[26px] border border-black/[.06] bg-[#f6f7f4] shadow-[0_18px_50px_rgba(17,19,15,.07)] sm:h-[calc(100dvh-370px)] sm:min-h-[440px] sm:max-h-[680px]"
          >
            <ParkGridBoard
              spots={overview.spots}
              vehiclesBySpot={vehiclesBySpot}
              canMove={canMove && !busy}
              scale={scale}
              recenterToken={recenterToken}
              selectedSpotId={selection?.kind === 'spot' ? selection.spotId : null}
              selectedVehicleId={
                selection?.kind === 'vehicle' ? selection.vehicleId : null
              }
              draggingVehicleType={
                activeDrag?.kind === 'ensemble'
                  ? 'ENSEMBLE'
                  : activeDrag?.vehicle.type ?? null
              }
              onSelectSpot={(spot) =>
                setSelection({ kind: 'spot', spotId: spot.id })
              }
              onSelectVehicle={(vehicle) =>
                setSelection({
                  kind: 'vehicle',
                  vehicleId: vehicle.id,
                  vehicleType: vehicle.type,
                })
              }
            />
            <ParkSummary kpis={kpis} />
            <ParkMapToolbar
              canViewHistory={capabilities.canViewHistory}
              scale={scale}
              resourcesOpen={resourcesOpen}
              onZoomIn={() =>
                setScale((current) =>
                  Math.min(MAX_SCALE, +(current + 0.12).toFixed(2))
                )
              }
              onZoomOut={() =>
                setScale((current) =>
                  Math.max(MIN_SCALE, +(current - 0.12).toFixed(2))
                )
              }
              onRecenter={() => setRecenterToken((token) => token + 1)}
              onOpenHistory={() => setHistoryOpen(true)}
              onToggleResources={() => setResourcesOpen((open) => !open)}
            />
            <div className="pointer-events-none absolute left-1/2 top-[116px] z-30 w-[min(92%,520px)] -translate-x-1/2 space-y-2 sm:top-16">
              {notice ? (
                <Banner tone="success" onDismiss={() => setNotice('')}>
                  {notice}
                </Banner>
              ) : null}
              {error ? (
                <Banner tone="error" onDismiss={() => setError('')}>
                  {error}
                </Banner>
              ) : null}
            </div>
            <MapLegend />
          </section>

          {resourcesOpen ? (
            <ResourcePanel
              vehicles={overview.vehicles}
              canMove={canMove && !busy}
              isDraggingLocated={Boolean(
                activeDrag?.kind === 'vehicle'
                  ? activeDrag.vehicle.spotId
                  : activeDrag?.truck.spotId || activeDrag?.trailer?.spotId
              )}
              selectedVehicleId={
                selection?.kind === 'vehicle' ? selection.vehicleId : null
              }
              onSelectVehicle={(vehicle) =>
                setSelection({
                  kind: 'vehicle',
                  vehicleId: vehicle.id,
                  vehicleType: vehicle.type,
                })
              }
              canViewInspections={capabilities.canViewInspections}
              canManageInspections={capabilities.canManageInspections}
              inspectionSummaries={inspectionSummaries}
              onInspectVehicle={(vehicle) => setInspectionVehicle(vehicle)}
            />
          ) : null}
        </div>
      </div>

      <DetailPanel
        selection={selection}
        spots={overview.spots}
        spotsById={spotsById}
        vehiclesById={vehiclesById}
        vehiclesBySpot={vehiclesBySpot}
        history={historyForSelection}
        canMove={canMove}
        busy={busy}
        canViewInspections={capabilities.canViewInspections}
        canManageInspections={capabilities.canManageInspections}
        inspectionSummaries={inspectionSummaries}
        onClose={() => setSelection(null)}
        onMove={(vehicle, toSpotId, note) => performMove(vehicle, toSpotId, note)}
        onUnlocate={(vehicle, note) => performUnlocate(vehicle, note)}
        onUpdateNote={(spot, note) => performNote(spot, note)}
        onShowHistory={() => setHistoryOpen(true)}
        onInspectVehicle={(vehicle) => setInspectionVehicle(vehicle)}
      />

      <HistoryPanel
        open={historyOpen}
        canViewHistory={capabilities.canViewHistory}
        onClose={() => setHistoryOpen(false)}
      />

      <InspectionDrawer
        vehicle={inspectionVehicle}
        canManage={capabilities.canManageInspections}
        onClose={() => setInspectionVehicle(null)}
        onUpdated={async () => {
          await Promise.all([refresh(), refreshInspectionSummaries()])
        }}
      />

      <DragOverlay dropAnimation={null}>
        {activeDrag ? <ParkDragPreview drag={activeDrag} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function ParkDragPreview({ drag }: { drag: ActiveParkDrag }) {
  const primary = drag.kind === 'vehicle' ? drag.vehicle : drag.truck
  return (
    <div
      className="w-[236px] rounded-lg border border-black/10 bg-white px-3 py-2.5 shadow-[0_22px_60px_rgba(17,18,15,.22)]"
      style={{ borderLeft: `4px solid ${STATUS_META[primary.status].ring}` }}
    >
      <div className="flex items-center gap-2">
        {drag.kind === 'ensemble' ? (
          <span className="flex h-7 w-10 items-center justify-center rounded-lg bg-lime-100 text-[9px] font-black text-lime-900">
            T+R
          </span>
        ) : (
          <span className="flex h-7 w-10 items-center justify-center rounded-lg bg-black/[.045] text-[#687064]">
            <VehicleTypeIcon
              type={drag.vehicle.type}
              className="h-4 w-6"
            />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[12px] font-black uppercase tracking-[.1em] text-[#171914]">
            {primary.plateNumber}
          </p>
          <p className="truncate text-[10px] font-semibold text-[#747a6f]">
            {drag.kind === 'ensemble'
              ? `+ ${drag.trailer?.plateNumber ?? primary.linkedPlateNumber ?? 'Remorque'}`
              : 'Déplacement dans le parc'}
          </p>
        </div>
      </div>
    </div>
  )
}

/* --------------------------- Carte et contrôles --------------------------- */

function ParkMapToolbar({
  canViewHistory,
  scale,
  resourcesOpen,
  onZoomIn,
  onZoomOut,
  onRecenter,
  onOpenHistory,
  onToggleResources,
}: {
  canViewHistory: boolean
  scale: number
  resourcesOpen: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onRecenter: () => void
  onOpenHistory: () => void
  onToggleResources: () => void
}) {
  return (
    <div className={`absolute right-3 top-3 z-30 flex items-center gap-1 p-1.5 sm:right-4 sm:top-4 ${controlPanelClass}`}>
      <MapAction label={`Dézoomer · ${Math.round(scale * 100)} %`} onClick={onZoomOut}>
        <MinusIcon />
      </MapAction>
      <MapAction label={`Zoomer · ${Math.round(scale * 100)} %`} onClick={onZoomIn}>
        <PlusIcon />
      </MapAction>
      <MapAction label="Recentrer le plan" onClick={onRecenter}>
        <TargetIcon />
      </MapAction>
      <MapAction
        label={resourcesOpen ? 'Masquer les ressources' : 'Afficher les ressources'}
        onClick={onToggleResources}
        active={resourcesOpen}
      >
        <ResourcesIcon />
      </MapAction>
      {canViewHistory ? (
        <MapAction label="Historique du parc" onClick={onOpenHistory}>
          <HistoryIcon />
        </MapAction>
      ) : null}
    </div>
  )
}

function MapAction({
  label,
  onClick,
  children,
  active = false,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-[13px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c8ff00] ${
        active
          ? 'bg-[#11130f] text-white'
          : 'text-[#4f5549] hover:bg-[#eef0eb] hover:text-black'
      }`}
    >
      {children}
    </button>
  )
}

function ParkSummary({ kpis }: { kpis: ReturnType<typeof deriveKpis> }) {
  return (
    <div className={`absolute left-4 top-4 z-20 hidden px-3 py-2.5 sm:block ${controlPanelClass}`}>
      <h1 className="text-sm font-black tracking-tight text-[#171914] sm:text-base">
        Parc automobile
      </h1>
      <div className="mt-1.5 flex items-center gap-2.5 text-[9px] font-bold text-[#697065] sm:text-[10px]">
        <SummaryValue value={kpis.vehiclesOnPark} label="positionnés" />
        <SummaryValue value={kpis.vehiclesToPosition} label="à positionner" />
        <SummaryValue value={kpis.spotsAvailable} label="places libres" />
      </div>
    </div>
  )
}

function SummaryValue({ value, label }: { value: number; label: string }) {
  return (
    <span className="whitespace-nowrap">
      <strong className="mr-1 font-black tabular-nums text-[#11130f]">{value}</strong>
      {label}
    </span>
  )
}

function MinusIcon() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 12h12" /></svg>
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg>
}

function TargetIcon() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
}

function ResourcesIcon() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M7 17v2M17 17v2M7 9h10" /></svg>
}

function HistoryIcon() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" /><path d="M4 4v4.6h4.6M12 8v4l3 2" /></svg>
}

function MapLegend() {
  const entries = [
    ['ON_PARK', 'Positionné'],
    ['MAINTENANCE', 'Maintenance à la Base'],
    ['TO_POSITION', 'À positionner'],
  ] as const
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-xl bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
      {entries.map(([status, label]) => (
        <span
          key={status}
          className="flex items-center gap-1.5 text-[10px] font-bold text-[#4a4d45]"
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: STATUS_META[status].ring }}
          />
          {label}
        </span>
      ))}
    </div>
  )
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: 'success' | 'error'
  children: React.ReactNode
  onDismiss: () => void
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex items-center justify-between gap-4 rounded-2xl px-4 py-3 text-sm font-semibold shadow-sm ${
        tone === 'success'
          ? 'bg-lime-50 text-lime-900'
          : 'bg-red-50 text-red-800'
      }`}
    >
      <span>{children}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fermer"
        className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  )
}

/* --------------------------- Mutations locales ---------------------------- */

function applyMoveLocally(
  overview: ParkOverviewDTO,
  vehicleId: string,
  vehicleType: ParkVehicleType,
  toSpotId: string
): ParkOverviewDTO {
  const field = vehicleType === ParkVehicleType.TRUCK ? 'truckId' : 'trailerId'
  const previousSpotId =
    overview.vehicles.find((vehicle) => vehicle.id === vehicleId)?.spotId ?? null
  const target = overview.spots.find((spot) => spot.id === toSpotId)

  const spots = overview.spots.map((spot) => {
    if (spot.id === previousSpotId && spot.id !== toSpotId) {
      return { ...spot, [field]: null }
    }
    if (spot.id === toSpotId) {
      return { ...spot, [field]: vehicleId }
    }
    return spot
  })

  const vehicles = overview.vehicles.map((vehicle) =>
    vehicle.id === vehicleId
      ? { ...vehicle, spotId: toSpotId, spotCode: target?.code ?? null }
      : vehicle
  )

  return { ...overview, spots, vehicles }
}

function applyEnsembleMoveLocally(
  overview: ParkOverviewDTO,
  truckId: string,
  trailerId: string,
  toSpotId: string
): ParkOverviewDTO {
  const truck = overview.vehicles.find((vehicle) => vehicle.id === truckId)
  const trailer = overview.vehicles.find((vehicle) => vehicle.id === trailerId)
  const target = overview.spots.find((spot) => spot.id === toSpotId)
  const previousTruckSpotId = truck?.spotId ?? null
  const previousTrailerSpotId = trailer?.spotId ?? null

  const spots = overview.spots.map((spot) => {
    if (spot.id === toSpotId) {
      return { ...spot, truckId, trailerId }
    }
    if (spot.id === previousTruckSpotId || spot.id === previousTrailerSpotId) {
      return {
        ...spot,
        ...(spot.id === previousTruckSpotId ? { truckId: null } : {}),
        ...(spot.id === previousTrailerSpotId ? { trailerId: null } : {}),
      }
    }
    return spot
  })
  const vehicles = overview.vehicles.map((vehicle) =>
    vehicle.id === truckId || vehicle.id === trailerId
      ? { ...vehicle, spotId: toSpotId, spotCode: target?.code ?? null }
      : vehicle
  )
  return { ...overview, spots, vehicles }
}

function applyUnlocateLocally(
  overview: ParkOverviewDTO,
  vehicleId: string,
  vehicleType: ParkVehicleType
): ParkOverviewDTO {
  const field = vehicleType === ParkVehicleType.TRUCK ? 'truckId' : 'trailerId'
  const previousSpotId =
    overview.vehicles.find((vehicle) => vehicle.id === vehicleId)?.spotId ?? null

  const spots = overview.spots.map((spot) =>
    spot.id === previousSpotId ? { ...spot, [field]: null } : spot
  )
  const vehicles = overview.vehicles.map((vehicle) =>
    vehicle.id === vehicleId
      ? { ...vehicle, spotId: null, spotCode: null }
      : vehicle
  )
  return { ...overview, spots, vehicles }
}

function deriveKpis(overview: ParkOverviewDTO) {
  const activeSpots = overview.spots.filter((spot) => spot.isActive)
  const occupied = activeSpots.filter(
    (spot) => spot.truckId || spot.trailerId
  ).length
  const onPark = overview.vehicles.filter((vehicle) => vehicle.spotId)
  return {
    vehiclesAtBase: overview.vehicles.length,
    vehiclesOnPark: onPark.length,
    trucksOnPark: onPark.filter((v) => v.type === ParkVehicleType.TRUCK).length,
    trailersOnPark: onPark.filter((v) => v.type === ParkVehicleType.TRAILER)
      .length,
    spotsOccupied: occupied,
    spotsAvailable: activeSpots.length - occupied,
    spotsTotal: activeSpots.length,
    vehiclesOnMission: overview.kpis.vehiclesOnMission,
    vehiclesInMaintenance: overview.kpis.vehiclesInMaintenance,
    vehiclesToPosition: overview.vehicles.filter((vehicle) => !vehicle.spotId)
      .length,
  }
}
