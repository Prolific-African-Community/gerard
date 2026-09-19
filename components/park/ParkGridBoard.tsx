'use client'

import { useEffect, useRef } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ParkVehicleType } from '@prisma/client'

import { shortSpotCode } from '../../lib/park/site-plan'
import type { ParkSpotDTO, ParkVehicleDTO } from '../../lib/park/types'
import { STATUS_META } from './parkKit'

const BOARD_WIDTH = 1200
const BOARD_HEIGHT = 720

type VisualSpotLayout = {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Projection purement visuelle du plan simplifié fourni par l'utilisateur.
 * Les identifiants et les relations métier restent ceux des ParkSpot en base.
 */
function getVisualSpotLayout(code: string): VisualSpotLayout {
  const number = Number(code.slice(-2))
  if (code.startsWith('P-NORD-')) {
    return { x: 340 + (number - 1) * 82, y: 92, width: 78, height: 72 }
  }
  if (code.startsWith('P-CENTRE-G-')) {
    return { x: 246, y: 268 + (number - 1) * 92, width: 72, height: 72 }
  }
  if (code.startsWith('P-CENTRE-D-')) {
    return { x: 342, y: 268 + (number - 1) * 92, width: 72, height: 72 }
  }
  if (code.startsWith('P-OUEST-')) {
    const index = number - 1
    return {
      x: 28 + (index % 2) * 118,
      y: 414 + Math.floor(index / 2) * 88,
      width: 72,
      height: 72,
    }
  }
  if (code.startsWith('P-SUD-')) {
    return { x: 300 + (number - 1) * 82, y: 616, width: 78, height: 72 }
  }
  return { x: 0, y: 0, width: 64, height: 72 }
}

export type ParkDragKind = ParkVehicleType | 'ENSEMBLE' | null

type ParkGridBoardProps = {
  spots: ParkSpotDTO[]
  vehiclesBySpot: Map<string, ParkVehicleDTO[]>
  canMove: boolean
  scale: number
  recenterToken: number
  selectedSpotId: string | null
  selectedVehicleId: string | null
  draggingVehicleType: ParkDragKind
  onSelectSpot: (spot: ParkSpotDTO) => void
  onSelectVehicle: (vehicle: ParkVehicleDTO) => void
}

/**
 * Grille logique du Parc.
 *
 * Contrairement à l'ancien canvas, aucune cellule droppable n'est placée dans
 * un élément transformé. Les coordonnées métier sont multipliées par le niveau
 * de zoom et deviennent directement les dimensions de layout mesurées par
 * dnd-kit, comme les cellules du Planning.
 */
export function ParkGridBoard({
  spots,
  vehiclesBySpot,
  canMove,
  scale,
  recenterToken,
  selectedSpotId,
  selectedVehicleId,
  draggingVehicleType,
  onSelectSpot,
  onSelectVehicle,
}: ParkGridBoardProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const activeSpots = spots.filter((spot) => spot.isActive)

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTo({
      left: Math.max(0, (BOARD_WIDTH * scale - node.clientWidth) / 2),
      top: Math.max(0, (BOARD_HEIGHT * scale - node.clientHeight) / 2),
      behavior: 'smooth',
    })
  }, [recenterToken, scale])

  return (
    <div
      ref={scrollRef}
      className="relative h-full w-full overflow-auto overscroll-contain bg-[#f6f7f4]"
      style={{ touchAction: 'pan-x pan-y' }}
      data-park-grid-count={activeSpots.length}
    >
      <div
        className="relative mx-auto mt-14 shrink-0 sm:mt-0"
        style={{
          width: BOARD_WIDTH * scale,
          height: BOARD_HEIGHT * scale,
          minWidth: BOARD_WIDTH * scale,
        }}
      >
        <PlanBackdrop />
        <div
          role="grid"
          aria-label={`Grille logique du parc, ${activeSpots.length} emplacements`}
          className="absolute inset-0"
        >
          {activeSpots.map((spot) => (
            <ParkGridCell
              key={spot.code}
              spot={spot}
              scale={scale}
              vehicles={vehiclesBySpot.get(spot.id) ?? []}
              canMove={canMove}
              selected={selectedSpotId === spot.id}
              selectedVehicleId={selectedVehicleId}
              draggingVehicleType={draggingVehicleType}
              onSelectSpot={onSelectSpot}
              onSelectVehicle={onSelectVehicle}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function ParkGridCell({
  spot,
  scale,
  vehicles,
  canMove,
  selected,
  selectedVehicleId,
  draggingVehicleType,
  onSelectSpot,
  onSelectVehicle,
}: {
  spot: ParkSpotDTO
  scale: number
  vehicles: ParkVehicleDTO[]
  canMove: boolean
  selected: boolean
  selectedVehicleId: string | null
  draggingVehicleType: ParkDragKind
  onSelectSpot: (spot: ParkSpotDTO) => void
  onSelectVehicle: (vehicle: ParkVehicleDTO) => void
}) {
  const hasTruck = vehicles.some(
    (vehicle) => vehicle.type === ParkVehicleType.TRUCK
  )
  const hasTrailer = vehicles.some(
    (vehicle) => vehicle.type === ParkVehicleType.TRAILER
  )
  const compatible =
    draggingVehicleType === 'ENSEMBLE'
      ? !hasTruck && !hasTrailer
      : draggingVehicleType === ParkVehicleType.TRUCK
      ? !hasTruck
      : draggingVehicleType === ParkVehicleType.TRAILER
      ? !hasTrailer
      : true
  const dropEnabled = canMove && spot.isActive && compatible
  const { isOver, setNodeRef } = useDroppable({
    id: `park-grid-cell:${spot.code}`,
    data: {
      kind: 'spot',
      spotId: spot.id,
      spotCode: spot.code,
    },
    disabled: !dropEnabled,
  })
  const layout = getVisualSpotLayout(spot.code)
  const visualWidth = layout.width * scale
  const visualHeight = layout.height * scale
  const hitWidth = Math.max(34, visualWidth)

  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      data-park-grid-cell={spot.code}
      data-park-spot-id={spot.id}
      data-park-droppable={dropEnabled ? 'true' : 'false'}
      data-park-drop-compatible={compatible ? 'true' : 'false'}
      className="absolute"
      style={{
        left: layout.x * scale - (hitWidth - visualWidth) / 2,
        top: layout.y * scale,
        width: hitWidth,
        height: visualHeight,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectSpot(spot)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelectSpot(spot)
          }
        }}
        title={`${spot.code} · ${vehicles.length ? 'Occupé' : 'Libre'}`}
        aria-label={`Emplacement ${spot.code}, ${vehicles.length ? 'occupé' : 'libre'}`}
        className="group relative block h-full overflow-hidden rounded-[10px] text-left transition focus-visible:outline focus-visible:outline-4 focus-visible:outline-[#c8ff00]"
        style={{
          width: visualWidth,
          marginLeft: (hitWidth - visualWidth) / 2,
          border: `2px ${vehicles.length ? 'solid' : 'dashed'} ${
            isOver
              ? '#78a600'
              : draggingVehicleType && !compatible
              ? 'rgba(185,28,28,.42)'
              : selected
              ? '#11130f'
              : 'rgba(120,124,114,.38)'
          }`,
          background:
            isOver
              ? 'rgba(200,255,0,.5)'
              : draggingVehicleType && compatible
              ? 'rgba(200,255,0,.15)'
              : draggingVehicleType && !compatible
              ? 'rgba(254,226,226,.86)'
              : 'rgba(255,255,255,.96)',
          boxShadow: selected
            ? '0 0 0 4px rgba(200,255,0,.6)'
            : vehicles.length
            ? '0 7px 18px rgba(17,19,15,.08)'
            : '0 2px 8px rgba(17,19,15,.035)',
          opacity: draggingVehicleType && !compatible ? 0.62 : 1,
        }}
      >
        <span
          className="absolute left-1.5 top-1 font-black tracking-tight text-[#62685e]"
          style={{ fontSize: Math.max(7, 11 * scale) }}
        >
          {shortSpotCode(spot.code)}
        </span>
        <div className="flex h-full flex-col justify-center gap-1 px-1 pt-4">
          {vehicles.length === 0 ? (
            <span
              className="text-center font-bold text-[#91978d]"
              style={{ fontSize: Math.max(7, 11 * scale) }}
            >
              Libre
            </span>
          ) : (
            vehicles.map((vehicle) => (
              <GridVehicleCard
                key={vehicle.id}
                vehicle={vehicle}
                canMove={canMove}
                selected={selectedVehicleId === vehicle.id}
                scale={scale}
                availableWidth={visualWidth}
                onSelect={onSelectVehicle}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function GridVehicleCard({
  vehicle,
  canMove,
  selected,
  scale,
  availableWidth,
  onSelect,
}: {
  vehicle: ParkVehicleDTO
  canMove: boolean
  selected: boolean
  scale: number
  availableWidth: number
  onSelect: (vehicle: ParkVehicleDTO) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `park:grid-vehicle:${vehicle.type}:${vehicle.id}`,
    data: {
      kind: 'vehicle',
      vehicleType: vehicle.type,
      vehicleId: vehicle.id,
      fromSpotId: vehicle.spotId,
    },
    disabled: !canMove,
  })
  const meta = STATUS_META[vehicle.status]
  const isTruck = vehicle.type === ParkVehicleType.TRUCK
  const typeLetter = isTruck ? 'C' : 'R'
  const showGlyph = availableWidth >= 54
  const glyphSize = Math.max(6, Math.min(9, 9 * scale))
  const plateSize = Math.max(
    5,
    Math.min(
      10,
      10 * scale,
      (availableWidth - (showGlyph ? 22 : 8)) /
        Math.max(1, vehicle.plateNumber.length * 0.56)
    )
  )

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(canMove ? listeners : {})}
      {...(canMove ? attributes : {})}
      data-park-map-vehicle={vehicle.id}
      data-park-draggable={canMove ? 'true' : 'false'}
      aria-label={`${isTruck ? 'Camion' : 'Remorque'} ${vehicle.plateNumber}${
        vehicle.status === 'MAINTENANCE' ? ', maintenance à la base' : ''
      }`}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(vehicle)
      }}
      className="relative flex min-w-0 appearance-none items-center gap-1 rounded-[6px] bg-[#11130f] px-1 py-1 text-white"
      style={{
        opacity: isDragging ? 0.3 : 1,
        border: `1px solid ${selected ? '#c8ff00' : 'rgba(255,255,255,.08)'}`,
        borderLeft: `2px solid ${meta.ring}`,
        cursor: canMove ? 'grab' : 'pointer',
        touchAction: canMove ? 'none' : 'auto',
      }}
    >
      {showGlyph ? (
        <span
          aria-hidden="true"
          className="flex shrink-0 items-center justify-center rounded-[3px] font-black leading-none text-[#11130f]"
          style={{
            width: glyphSize + 4,
            height: glyphSize + 4,
            fontSize: glyphSize,
            backgroundColor: meta.ring,
          }}
        >
          {typeLetter}
        </span>
      ) : null}
      <span
        className="min-w-0 flex-1 truncate text-center font-black uppercase leading-none tracking-[-.035em] text-white"
        style={{ fontSize: plateSize }}
      >
        {vehicle.plateNumber}
      </span>
    </button>
  )
}

function PlanBackdrop() {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="#f6f7f4" />
      <ZoneLabel x={765} y={56}>Zone Nord</ZoneLabel>
      <ZoneLabel x={330} y={228}>Zone centre</ZoneLabel>
      <ZoneLabel x={123} y={374}>Zone Ouest</ZoneLabel>
      <ZoneLabel x={680} y={708}>Zone Sud</ZoneLabel>
    </svg>
  )
}

function ZoneLabel({
  x,
  y,
  children,
}: {
  x: number
  y: number
  children: string
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={16}
      fontWeight={700}
      letterSpacing={1.4}
      fill="#73796f"
    >
      {children}
    </text>
  )
}
