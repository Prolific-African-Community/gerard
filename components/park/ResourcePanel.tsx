'use client'

import { useMemo, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ParkVehicleType } from '@prisma/client'

import {
  defaultResourceCardAppearanceClassName,
  resourceCardShellClassName,
} from '../dispatch/ResourcePoolPrimitives'
import type { ParkVehicleDTO } from '../../lib/park/types'
import type { ParkInspectionSummaryDTO } from '../../lib/park/inspection-types'
import { STATUS_META, VehicleTypeIcon } from './parkKit'
import { InspectionIcon } from './InspectionStatus'

type ResourcePanelProps = {
  vehicles: ParkVehicleDTO[]
  canMove: boolean
  isDraggingLocated: boolean
  selectedVehicleId: string | null
  onSelectVehicle: (vehicle: ParkVehicleDTO) => void
  canViewInspections: boolean
  canManageInspections: boolean
  inspectionSummaries: Map<string, ParkInspectionSummaryDTO>
  onInspectVehicle: (vehicle: ParkVehicleDTO) => void
}

type TypeFilter = ParkVehicleType

export function ResourcePanel({
  vehicles,
  canMove,
  isDraggingLocated,
  selectedVehicleId,
  onSelectVehicle,
  canViewInspections,
  canManageInspections,
  inspectionSummaries,
  onInspectVehicle,
}: ResourcePanelProps) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(ParkVehicleType.TRUCK)
  const byId = useMemo(
    () => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])),
    [vehicles]
  )
  const toPosition = useMemo(
    () => vehicles.filter((vehicle) => !vehicle.spotId),
    [vehicles]
  )
  const ensembleTrucks = useMemo(
    () =>
      toPosition.filter((vehicle) => {
        if (vehicle.type !== ParkVehicleType.TRUCK || !vehicle.linkedTrailerId)
          return false
        const trailer = byId.get(vehicle.linkedTrailerId)
        return Boolean(trailer && !trailer.spotId)
      }),
    [byId, toPosition]
  )
  const ensembleVehicleIds = useMemo(
    () =>
      new Set(
        ensembleTrucks.flatMap((truck) => [
          truck.id,
          ...(truck.linkedTrailerId ? [truck.linkedTrailerId] : []),
        ])
      ),
    [ensembleTrucks]
  )
  const standaloneVehicles = useMemo(
    () => toPosition.filter((vehicle) => !ensembleVehicleIds.has(vehicle.id)),
    [ensembleVehicleIds, toPosition]
  )
  const counts = {
    [ParkVehicleType.TRUCK]:
      ensembleTrucks.length +
      standaloneVehicles.filter((vehicle) => vehicle.type === ParkVehicleType.TRUCK)
        .length,
    [ParkVehicleType.TRAILER]: standaloneVehicles.filter(
      (vehicle) => vehicle.type === ParkVehicleType.TRAILER
    ).length,
  }
  const query = search.trim().toLowerCase()
  const visibleEnsembles =
    typeFilter === ParkVehicleType.TRUCK
      ? ensembleTrucks.filter((truck) => {
          const trailer = truck.linkedTrailerId
            ? byId.get(truck.linkedTrailerId)
            : null
          return (
            !query ||
            truck.plateNumber.toLowerCase().includes(query) ||
            trailer?.plateNumber.toLowerCase().includes(query)
          )
        })
      : []
  const visibleVehicles = standaloneVehicles
    .filter(
      (vehicle) =>
        vehicle.type === typeFilter &&
        (!query || vehicle.plateNumber.toLowerCase().includes(query))
    )
    .sort((left, right) => left.plateNumber.localeCompare(right.plateNumber))
  const visibleCount = visibleEnsembles.length + visibleVehicles.length

  return (
    <section
      aria-label="Ressources du parc à positionner"
      className="fixed inset-x-0 bottom-0 z-40 px-2 pb-2 sm:px-5 sm:pb-4"
    >
      <div className="relative mx-auto flex max-w-[1920px] flex-col gap-2 rounded-[24px] bg-[#f4f5f1]/95 p-2.5 shadow-[0_-16px_52px_rgba(17,18,15,.11)] ring-1 ring-black/[.045] backdrop-blur-2xl md:flex-row md:items-stretch md:gap-3 md:rounded-[28px] md:p-3">
        {canMove ? <UnlocateDropZone active={isDraggingLocated} /> : null}

        <aside className="flex shrink-0 items-center justify-between gap-3 rounded-[18px] bg-white/80 px-3 py-2 ring-1 ring-black/[.035] md:w-[184px] md:flex-col md:items-stretch md:justify-center">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[.2em] text-[#73796d]">
              À positionner
            </p>
            <p className="mt-0.5 text-[11px] font-semibold text-[#5e6459]">
              {canMove ? 'Glissez vers une place' : 'Consultation du parc'}
            </p>
          </div>
          <div className="flex items-center gap-2" role="group" aria-label="Filtrer les ressources">
            <FilterButton
              active={typeFilter === ParkVehicleType.TRUCK}
              count={counts[ParkVehicleType.TRUCK]}
              label="Camions et ensembles"
              onClick={() => setTypeFilter(ParkVehicleType.TRUCK)}
              type={ParkVehicleType.TRUCK}
            />
            <FilterButton
              active={typeFilter === ParkVehicleType.TRAILER}
              count={counts[ParkVehicleType.TRAILER]}
              label="Remorques"
              onClick={() => setTypeFilter(ParkVehicleType.TRAILER)}
              type={ParkVehicleType.TRAILER}
            />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2 px-1">
            <p className="min-w-0 text-[10px] font-black uppercase tracking-[.18em] text-[#646a60]">
              <span className="sm:hidden">
                {typeFilter === ParkVehicleType.TRUCK ? 'Camions' : 'Remorques'}
              </span>
              <span className="hidden sm:inline">
                {typeFilter === ParkVehicleType.TRUCK
                  ? 'Camions à positionner'
                  : 'Remorques à positionner'}
              </span>
            </p>
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black tabular-nums text-[#4f5549] shadow-sm">
              {visibleCount}
            </span>
            <label className="relative ml-auto block w-[150px] sm:w-[210px]">
              <span className="sr-only">Rechercher une plaque</span>
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a9082]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher"
                className="h-8 w-full rounded-xl border border-transparent bg-white pl-8 pr-2 text-[11px] font-semibold text-[#171914] outline-none ring-1 ring-black/[.055] transition placeholder:text-[#9aa090] focus:border-[#8eb800] focus:ring-2 focus:ring-lime-200/60"
              />
            </label>
          </div>

          {visibleCount ? (
            <div className="dispatch-pool-scrollbar overflow-x-auto overscroll-x-contain pb-1.5">
              <div className="flex w-max items-stretch gap-3 pr-6">
                {visibleEnsembles.map((truck) => (
                  <EnsembleCard
                    key={`ensemble-${truck.id}`}
                    truck={truck}
                    trailer={
                      truck.linkedTrailerId
                        ? byId.get(truck.linkedTrailerId) ?? null
                        : null
                    }
                    draggable={canMove}
                    selected={selectedVehicleId === truck.id}
                    onSelect={onSelectVehicle}
                    canViewInspections={canViewInspections}
                    canManageInspections={canManageInspections}
                    truckSummary={inspectionSummaries.get(
                      `${truck.type}:${truck.id}`
                    )}
                    trailerSummary={
                      truck.linkedTrailerId
                        ? inspectionSummaries.get(
                            `${ParkVehicleType.TRAILER}:${truck.linkedTrailerId}`
                          )
                        : undefined
                    }
                    onInspect={onInspectVehicle}
                  />
                ))}
                {visibleVehicles.map((vehicle) => (
                  <VehicleCard
                    key={`${vehicle.type}-${vehicle.id}`}
                    vehicle={vehicle}
                    draggable={canMove}
                    selected={selectedVehicleId === vehicle.id}
                    onSelect={onSelectVehicle}
                    canViewInspections={canViewInspections}
                    canManageInspections={canManageInspections}
                    inspectionSummary={inspectionSummaries.get(
                      `${vehicle.type}:${vehicle.id}`
                    )}
                    onInspect={onInspectVehicle}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-[82px] items-center justify-center rounded-[18px] border border-dashed border-black/10 bg-white/60 px-4 text-center text-xs font-semibold text-[#777d72]">
              Aucune ressource à positionner.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function FilterButton({
  active,
  count,
  label,
  onClick,
  type,
}: {
  active: boolean
  count: number
  label: string
  onClick: () => void
  type: ParkVehicleType
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`relative flex h-11 w-11 items-center justify-center rounded-[15px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c8ff00] ${
        active
          ? 'bg-[#11130f] text-white shadow-[0_10px_22px_rgba(17,18,15,.18)]'
          : 'bg-[#f2f3ef] text-[#687064] hover:bg-lime-100 hover:text-black'
      }`}
    >
      <VehicleTypeIcon type={type} className="h-4 w-6" />
      <span
        className={`absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-black ${
          active ? 'bg-[#c8ff00] text-black' : 'bg-white text-[#62685e] shadow-sm'
        }`}
      >
        {count}
      </span>
    </button>
  )
}

function EnsembleCard({
  truck,
  trailer,
  draggable,
  selected,
  onSelect,
  canViewInspections,
  canManageInspections,
  truckSummary,
  trailerSummary,
  onInspect,
}: {
  truck: ParkVehicleDTO
  trailer: ParkVehicleDTO | null
  draggable: boolean
  selected: boolean
  onSelect: (vehicle: ParkVehicleDTO) => void
  canViewInspections: boolean
  canManageInspections: boolean
  truckSummary?: ParkInspectionSummaryDTO
  trailerSummary?: ParkInspectionSummaryDTO
  onInspect: (vehicle: ParkVehicleDTO) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `park:ensemble:${truck.id}`,
    data: {
      kind: 'ensemble',
      vehicleType: 'ENSEMBLE',
      truckId: truck.id,
      trailerId: trailer?.id ?? null,
    },
    disabled: !draggable,
  })
  const status =
    truck.status === 'MAINTENANCE' || trailer?.status === 'MAINTENANCE'
      ? 'MAINTENANCE'
      : 'TO_POSITION'

  const hasActions = canViewInspections
  const trailerPlate = trailer?.plateNumber ?? truck.linkedPlateNumber ?? 'Remorque'

  return (
    <CompactCard
      setNodeRef={setNodeRef}
      listeners={draggable ? listeners : undefined}
      attributes={draggable ? attributes : undefined}
      draggable={draggable}
      dragging={isDragging}
      selected={selected}
      onClick={() => onSelect(truck)}
      dataType="ensemble"
      contentPadClass={hasActions ? (trailer ? 'pr-[68px]' : 'pr-9') : ''}
      actions={
        canViewInspections ? (
          <>
            <InspectionCardAction
              vehicle={truck}
              label={canManageInspections ? 'Contrôler camion' : 'Contrôles camion'}
              summary={truckSummary}
              onInspect={onInspect}
            />
            {trailer ? (
              <InspectionCardAction
                vehicle={trailer}
                label={canManageInspections ? 'Contrôler remorque' : 'Contrôles remorque'}
                summary={trailerSummary}
                onInspect={onInspect}
              />
            ) : null}
          </>
        ) : null
      }
    >
      <div className="flex items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-[12px] font-black uppercase tracking-[.12em] text-[#171814]">
          {truck.plateNumber}
        </p>
        <PoolStatusPill status={status} label="Ensemble" />
      </div>
      <MetaLine icon={<CoupleIcon />}>+ {trailerPlate}</MetaLine>
    </CompactCard>
  )
}

function VehicleCard({
  vehicle,
  draggable,
  selected,
  onSelect,
  canViewInspections,
  canManageInspections,
  inspectionSummary,
  onInspect,
}: {
  vehicle: ParkVehicleDTO
  draggable: boolean
  selected: boolean
  onSelect: (vehicle: ParkVehicleDTO) => void
  canViewInspections: boolean
  canManageInspections: boolean
  inspectionSummary?: ParkInspectionSummaryDTO
  onInspect: (vehicle: ParkVehicleDTO) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `park:vehicle:${vehicle.type}:${vehicle.id}`,
    data: {
      kind: 'vehicle',
      vehicleType: vehicle.type,
      vehicleId: vehicle.id,
      fromSpotId: null,
    },
    disabled: !draggable,
  })
  const isTruck = vehicle.type === ParkVehicleType.TRUCK
  const typeLabel = isTruck
    ? vehicle.driverName ?? 'Camion'
    : vehicle.trailerType ?? 'Remorque'

  return (
    <CompactCard
      setNodeRef={setNodeRef}
      listeners={draggable ? listeners : undefined}
      attributes={draggable ? attributes : undefined}
      draggable={draggable}
      dragging={isDragging}
      selected={selected}
      onClick={() => onSelect(vehicle)}
      dataType={vehicle.type.toLowerCase()}
      contentPadClass={canViewInspections ? 'pr-9' : ''}
      actions={
        canViewInspections ? (
          <InspectionCardAction
            vehicle={vehicle}
            label={canManageInspections ? 'Contrôler' : 'Contrôles'}
            summary={inspectionSummary}
            onInspect={onInspect}
          />
        ) : null
      }
    >
      <div className="flex items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-[12px] font-black uppercase tracking-[.12em] text-[#171814]">
          {vehicle.plateNumber}
        </p>
        <PoolStatusPill
          status={vehicle.status}
          label={isTruck ? 'Camion' : 'Remorque'}
        />
      </div>
      <MetaLine icon={<VehicleTypeIcon type={vehicle.type} className="h-3.5 w-3.5" />}>
        {typeLabel}
      </MetaLine>
    </CompactCard>
  )
}

function CompactCard({
  children,
  setNodeRef,
  listeners,
  attributes,
  draggable,
  dragging,
  selected,
  onClick,
  dataType,
  actions,
  contentPadClass = '',
}: {
  children: React.ReactNode
  setNodeRef: (node: HTMLElement | null) => void
  listeners?: ReturnType<typeof useDraggable>['listeners']
  attributes?: ReturnType<typeof useDraggable>['attributes']
  draggable: boolean
  dragging: boolean
  selected: boolean
  onClick: () => void
  dataType: string
  actions?: React.ReactNode
  contentPadClass?: string
}) {
  return (
    <article
      ref={setNodeRef}
      data-park-resource={dataType}
      data-park-draggable={draggable ? 'true' : 'false'}
      className={[
        resourceCardShellClassName,
        defaultResourceCardAppearanceClassName,
        'relative h-[78px] w-[236px] shrink-0 px-3 py-2.5',
        selected ? 'ring-2 ring-[#b9ff4a]' : '',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        dragging ? 'opacity-35' : 'opacity-100',
      ].join(' ')}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        onClick={onClick}
        className={[
          'flex h-full w-full appearance-none flex-col justify-center gap-1 border-0 bg-transparent p-0 text-left',
          contentPadClass,
        ].join(' ')}
        style={{ background: 'transparent', border: 0 }}
      >
        {children}
      </button>
      {actions ? (
        <div className="absolute right-2 top-2 flex items-center gap-1">{actions}</div>
      ) : null}
    </article>
  )
}

function InspectionCardAction({
  vehicle,
  label,
  summary,
  onInspect,
}: {
  vehicle: ParkVehicleDTO
  label: string
  summary?: ParkInspectionSummaryDTO
  onInspect: (vehicle: ParkVehicleDTO) => void
}) {
  const lastResult = summary?.lastInspection?.overallResult
  const tone =
    lastResult === 'INTERVENTION_REQUIRED'
      ? 'bg-red-50 text-red-700'
      : lastResult === 'WATCH'
      ? 'bg-amber-50 text-amber-800'
      : lastResult === 'COMPLIANT'
      ? 'bg-lime-100 text-lime-900'
      : 'bg-black/[.045] text-[#565c51]'

  return (
    <button
      type="button"
      data-park-inspection-action="true"
      aria-label={`${label} ${vehicle.plateNumber}`}
      title={`${label} ${vehicle.plateNumber}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onInspect(vehicle)
      }}
      className={`relative flex h-7 w-7 appearance-none items-center justify-center rounded-[10px] border-0 p-0 transition hover:bg-[#11130f] hover:text-[#c8ff00] focus-visible:ring-2 focus-visible:ring-[#b9ff4a]/70 ${tone}`}
      style={{ border: 0 }}
    >
      <InspectionIcon className="h-3.5 w-3.5" />
      {summary?.criticalAnomalyCount ? (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[8px] font-black text-white">
          {summary.criticalAnomalyCount}
        </span>
      ) : null}
    </button>
  )
}

const POOL_STATUS_LABELS: Record<ParkVehicleDTO['status'], string> = {
  ON_PARK: 'Positionné',
  MAINTENANCE: 'Maintenance',
  TO_POSITION: 'À positionner',
}

function PoolStatusPill({
  status,
  label,
}: {
  status: ParkVehicleDTO['status']
  label?: string
}) {
  const meta = STATUS_META[status]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold leading-none ${meta.badge}`}
      title={label ? `${meta.label} · ${label}` : meta.label}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: meta.ring }}
      />
      {POOL_STATUS_LABELS[status]}
    </span>
  )
}

function MetaLine({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold leading-tight text-[#6b7065]">
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[#8b9186]">
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </p>
  )
}

function CoupleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9h9v6H4zM13 12h3M16 9h4v6h-4z" />
      <circle cx="7" cy="17" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="17" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

function UnlocateDropZone({ active }: { active: boolean }) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'park:unlocate',
    data: { kind: 'unlocate' },
    disabled: !active,
  })
  return (
    <div
      ref={setNodeRef}
      data-park-unlocate-dropzone="true"
      data-park-unlocate-active={active ? 'true' : 'false'}
      role="region"
      aria-label="Retirer la position physique"
      className="absolute -top-12 left-1/2 flex h-10 w-72 -translate-x-1/2 items-center justify-center rounded-[16px] border-2 border-dashed text-[10px] font-black uppercase tracking-wide transition"
      style={{
        borderColor: isOver ? '#dc2626' : '#d6b9b9',
        backgroundColor: isOver ? 'rgba(254,226,226,.98)' : 'rgba(255,255,255,.96)',
        color: isOver ? '#b91c1c' : '#9f6b6b',
        opacity: active ? 1 : 0,
        pointerEvents: active ? 'auto' : 'none',
      }}
    >
      Retirer la position physique
    </div>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  )
}
