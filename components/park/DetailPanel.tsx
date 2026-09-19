'use client'

import { useEffect, useMemo, useState } from 'react'
import { ParkVehicleType } from '@prisma/client'

import type {
  ParkMovementDTO,
  ParkSpotDTO,
  ParkVehicleDTO,
} from '../../lib/park/types'
import type { ParkInspectionSummaryDTO } from '../../lib/park/inspection-types'
import {
  ACTION_LABELS,
  InfoRow,
  StatusBadge,
  VehicleTypeIcon,
  WrenchIcon,
  formatDateTime,
} from './parkKit'
import { InspectionIcon, InspectionSummaryBadge } from './InspectionStatus'

export type ParkSelection =
  | { kind: 'spot'; spotId: string }
  | { kind: 'vehicle'; vehicleId: string; vehicleType: ParkVehicleType }

type DetailPanelProps = {
  selection: ParkSelection | null
  spots: ParkSpotDTO[]
  spotsById: Map<string, ParkSpotDTO>
  vehiclesById: Map<string, ParkVehicleDTO>
  vehiclesBySpot: Map<string, ParkVehicleDTO[]>
  history: ParkMovementDTO[]
  canMove: boolean
  busy: boolean
  onClose: () => void
  onMove: (vehicle: ParkVehicleDTO, toSpotId: string, note: string) => void
  onUnlocate: (vehicle: ParkVehicleDTO, note: string) => void
  onUpdateNote: (spot: ParkSpotDTO, note: string) => void
  onShowHistory: () => void
  canViewInspections: boolean
  canManageInspections: boolean
  inspectionSummaries: Map<string, ParkInspectionSummaryDTO>
  onInspectVehicle: (vehicle: ParkVehicleDTO) => void
}

export function DetailPanel(props: DetailPanelProps) {
  const { selection, onClose } = props
  if (!selection) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 lg:bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Détail du parc"
        className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[88vh] flex-col rounded-t-[28px] bg-white shadow-2xl sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:max-h-none sm:w-full sm:max-w-[420px] sm:rounded-none"
      >
        <DetailContent {...props} selection={selection} />
      </aside>
    </>
  )
}

function DetailContent({
  selection,
  spots,
  spotsById,
  vehiclesById,
  vehiclesBySpot,
  history,
  canMove,
  busy,
  onClose,
  onMove,
  onUnlocate,
  onUpdateNote,
  onShowHistory,
  canViewInspections,
  canManageInspections,
  inspectionSummaries,
  onInspectVehicle,
}: DetailPanelProps & { selection: ParkSelection }) {
  if (selection.kind === 'spot') {
    const spot = spotsById.get(selection.spotId)
    if (!spot) return null
    const occupants = vehiclesBySpot.get(spot.id) ?? []
    return (
      <Shell
        eyebrow="Emplacement"
        title={spot.code}
        subtitle={spot.label}
        onClose={onClose}
      >
        <dl className="mt-1">
          <InfoRow label="Zone">{spot.zoneLabel}</InfoRow>
          <InfoRow label="Type">{SPOT_TYPE_LABELS[spot.type]}</InfoRow>
          <InfoRow label="État">{spot.isActive ? 'Actif' : 'Inactif'}</InfoRow>
          <InfoRow label="Occupation">
            {occupants.length === 0
              ? 'Libre'
              : `${occupants.length} véhicule${occupants.length > 1 ? 's' : ''}`}
          </InfoRow>
          {spot.occupiedAt ? (
            <InfoRow label="Dernier mouvement">
              {formatDateTime(spot.occupiedAt)}
            </InfoRow>
          ) : null}
          {spot.placedByName ? (
            <InfoRow label="Par">{spot.placedByName}</InfoRow>
          ) : null}
          {spot.note ? <InfoRow label="Note">{spot.note}</InfoRow> : null}
        </dl>

        {canMove ? (
          <SpotNoteEditor
            spot={spot}
            busy={busy}
            onSave={(note) => onUpdateNote(spot, note)}
          />
        ) : null}

        {occupants.length > 0 ? (
          <section className="mt-5">
            <h3 className="mb-2 text-[11px] font-black uppercase tracking-wide text-[#5b5f55]">
              Véhicules présents
            </h3>
            <div className="space-y-3">
              {occupants.map((vehicle) => (
                <div key={vehicle.id} className="space-y-2">
                  {canViewInspections ? (
                    <InspectionVehicleBlock
                      vehicle={vehicle}
                      canManage={canManageInspections}
                      summary={inspectionSummaries.get(`${vehicle.type}:${vehicle.id}`)}
                      onInspect={onInspectVehicle}
                    />
                  ) : null}
                  <VehicleActions
                    vehicle={vehicle}
                    spots={spots}
                    canMove={canMove}
                    busy={busy}
                    onMove={onMove}
                    onUnlocate={onUnlocate}
                  />
                </div>
              ))}
            </div>
          </section>
        ) : (
          <p className="mt-5 rounded-xl bg-[#f2f4ef] p-4 text-sm text-[#5b5f55]">
            {canMove
              ? 'Emplacement libre. Glissez une ressource ici ou utilisez la liste de placement.'
              : 'Emplacement libre.'}
          </p>
        )}

        <HistoryList history={history} onShowHistory={onShowHistory} />
      </Shell>
    )
  }

  const vehicle = vehiclesById.get(selection.vehicleId)
  if (!vehicle) return null
  const currentSpot = vehicle.spotId ? spotsById.get(vehicle.spotId) : null
  return (
    <Shell
      eyebrow={vehicle.type === ParkVehicleType.TRUCK ? 'Camion' : 'Remorque'}
      title={vehicle.plateNumber}
      subtitle={
        vehicle.type === ParkVehicleType.TRUCK
          ? vehicle.driverName ?? 'Sans chauffeur'
          : vehicle.trailerType ?? 'Remorque'
      }
      icon={
        <VehicleTypeIcon type={vehicle.type} className="h-6 w-9 text-[#3c3f38]" />
      }
      onClose={onClose}
    >
      <div className="mt-2">
        <StatusBadge status={vehicle.status} />
      </div>
      {vehicle.hasActiveMaintenance ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[13px] font-semibold text-amber-900">
          <WrenchIcon className="mt-0.5 h-4 w-4 shrink-0" />
          Intervention active à la Base. Le véhicule reste disponible dans le
          plan du parc.
        </p>
      ) : null}
      <dl className="mt-3">
        <InfoRow label="Localisation">
          {currentSpot
            ? `${currentSpot.code} · ${currentSpot.zoneLabel}`
            : 'À positionner'}
        </InfoRow>
      </dl>

      {canViewInspections ? (
        <InspectionVehicleBlock
          vehicle={vehicle}
          canManage={canManageInspections}
          summary={inspectionSummaries.get(`${vehicle.type}:${vehicle.id}`)}
          onInspect={onInspectVehicle}
        />
      ) : null}

      <section className="mt-5">
        <VehicleActions
          vehicle={vehicle}
          spots={spots}
          canMove={canMove}
          busy={busy}
          onMove={onMove}
          onUnlocate={onUnlocate}
          expanded
        />
      </section>

      <HistoryList history={history} onShowHistory={onShowHistory} />
    </Shell>
  )
}

function InspectionVehicleBlock({
  vehicle,
  canManage,
  summary,
  onInspect,
}: {
  vehicle: ParkVehicleDTO
  canManage: boolean
  summary?: ParkInspectionSummaryDTO
  onInspect: (vehicle: ParkVehicleDTO) => void
}) {
  const lastInspection = summary?.lastInspection
  return (
    <section className="mt-4 rounded-2xl border border-black/[.07] bg-[#f7f8f5] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[.16em] text-[#73796d]">
            <InspectionIcon className="h-3.5 w-3.5" /> Contrôle du parc
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <InspectionSummaryBadge summary={summary} />
            {lastInspection ? (
              <span className="text-[10px] font-semibold text-[#858b80]">
                {formatDateTime(lastInspection.inspectedAt)}
              </span>
            ) : null}
          </div>
          {summary?.openAnomalyCount ? (
            <p className="mt-1 text-[10px] font-black text-amber-800">
              {summary.openAnomalyCount} anomalie(s) ouverte(s)
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onInspect(vehicle)}
          className="h-10 shrink-0 rounded-xl bg-[#11130f] px-3 text-xs font-black text-white transition hover:bg-[#c8ff00] hover:text-black"
        >
          {canManage ? 'Contrôler' : 'Historique'}
        </button>
      </div>
    </section>
  )
}

function SpotNoteEditor({
  spot,
  busy,
  onSave,
}: {
  spot: ParkSpotDTO
  busy: boolean
  onSave: (note: string) => void
}) {
  const [note, setNote] = useState(spot.note ?? '')
  useEffect(() => setNote(spot.note ?? ''), [spot.id, spot.note])
  return (
    <label className="mt-5 block rounded-xl bg-[#f2f4ef] p-3">
      <span className="text-[11px] font-black uppercase tracking-wide text-[#5b5f55]">
        Note de positionnement
      </span>
      <textarea
        value={note}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
        className="mt-2 min-h-20 w-full resize-none rounded-xl border border-black/10 bg-white p-3 text-sm outline-none focus:border-[#8eb800]"
        placeholder="Ajouter une note…"
      />
      <button
        type="button"
        disabled={busy || note === (spot.note ?? '')}
        onClick={() => onSave(note)}
        className="mt-2 h-10 rounded-xl bg-[#11130f] px-4 text-sm font-bold text-white disabled:opacity-40"
      >
        Enregistrer la note
      </button>
    </label>
  )
}

function VehicleActions({
  vehicle,
  spots,
  canMove,
  busy,
  onMove,
  onUnlocate,
  expanded = false,
}: {
  vehicle: ParkVehicleDTO
  spots: ParkSpotDTO[]
  canMove: boolean
  busy: boolean
  onMove: (vehicle: ParkVehicleDTO, toSpotId: string, note: string) => void
  onUnlocate: (vehicle: ParkVehicleDTO, note: string) => void
  expanded?: boolean
}) {
  const [openMove, setOpenMove] = useState(expanded)
  const [target, setTarget] = useState('')
  const [note, setNote] = useState('')

  const availableSpots = useMemo(() => {
    return spots.filter((spot) => {
      if (!spot.isActive) return false
      if (spot.id === vehicle.spotId) return false
      const slotTaken =
        vehicle.type === ParkVehicleType.TRUCK ? spot.truckId : spot.trailerId
      return !slotTaken
    })
  }, [spots, vehicle.spotId, vehicle.type])

  if (!canMove) {
    return null
  }

  return (
    <div className="rounded-xl border border-black/[.07] p-3">
      {!expanded ? (
        <div className="mb-2 flex items-center gap-2">
          <VehicleTypeIcon type={vehicle.type} className="h-4 w-6 text-[#3c3f38]" />
          <span className="text-sm font-black text-[#171914]">
            {vehicle.plateNumber}
          </span>
        </div>
      ) : null}

      {openMove ? (
        <div className="space-y-2">
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[#8a9082]">
              Déplacer vers
            </span>
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm"
            >
              <option value="">Sélectionner un emplacement…</option>
              {availableSpots.map((spot) => (
                <option key={spot.id} value={spot.id}>
                  {spot.code} — {spot.zoneLabel}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[#8a9082]">
              Note (facultative)
            </span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm"
              placeholder="Motif du déplacement…"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!target || busy}
              onClick={() => onMove(vehicle, target, note)}
              className="h-11 flex-1 rounded-xl bg-[#11130f] text-sm font-bold text-white transition hover:bg-[#C8FF00] hover:text-black disabled:opacity-40"
            >
              Confirmer
            </button>
            {!expanded ? (
              <button
                type="button"
                onClick={() => setOpenMove(false)}
                className="h-11 rounded-xl border border-black/10 px-4 text-sm font-bold"
              >
                Annuler
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpenMove(true)}
          className="h-11 w-full rounded-xl bg-[#11130f] text-sm font-bold text-white transition hover:bg-[#C8FF00] hover:text-black"
        >
          Déplacer…
        </button>
      )}

      {vehicle.spotId ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onUnlocate(vehicle, note)}
          className="mt-2 h-11 w-full rounded-xl border border-red-200 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-40"
        >
          Retirer la position
        </button>
      ) : null}
    </div>
  )
}

function HistoryList({
  history,
  onShowHistory,
}: {
  history: ParkMovementDTO[]
  onShowHistory: () => void
}) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-black uppercase tracking-wide text-[#5b5f55]">
          Historique récent
        </h3>
        <button
          type="button"
          onClick={onShowHistory}
          className="text-[11px] font-bold text-[#4d7c0f] underline"
        >
          Tout voir
        </button>
      </div>
      {history.length === 0 ? (
        <p className="text-sm text-[#8a9082]">Aucun mouvement enregistré.</p>
      ) : (
        <ul className="space-y-2">
          {history.slice(0, 6).map((movement) => (
            <li
              key={movement.id}
              className="rounded-lg bg-[#f7f8f5] px-3 py-2 text-[12px]"
            >
              <div className="flex items-center justify-between">
                <span className="font-black text-[#171914]">
                  {movement.plateNumber}
                </span>
                <span className="text-[#8a9082]">
                  {formatDateTime(movement.createdAt)}
                </span>
              </div>
              <p className="mt-0.5 text-[#5b5f55]">
                {ACTION_LABELS[movement.action]} ·{' '}
                {movement.fromSpotCode ?? '—'} → {movement.toSpotCode ?? '—'}
                {movement.actorName ? ` · ${movement.actorName}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Shell({
  eyebrow,
  title,
  subtitle,
  icon,
  onClose,
  children,
}: {
  eyebrow: string
  title: string
  subtitle?: string
  icon?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-black/[.06] p-5">
        <div className="flex items-start gap-3">
          {icon ? (
            <span className="mt-1 flex h-11 w-11 items-center justify-center rounded-xl bg-[#f2f4ef]">
              {icon}
            </span>
          ) : null}
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-[#86ad00]">
              {eyebrow}
            </p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-[#171914]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-sm text-[#8a9082]">{subtitle}</p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le panneau"
          className="h-9 w-9 rounded-full bg-black/[.05] text-xl leading-none text-[#4a4d45] transition hover:bg-black/10"
        >
          ×
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
    </>
  )
}

const SPOT_TYPE_LABELS: Record<string, string> = {
  PARKING: 'Place de parking',
  WORKSHOP: 'Atelier',
  HALL: 'Hall mécanique',
  STORAGE: 'Stockage intérieur',
}
