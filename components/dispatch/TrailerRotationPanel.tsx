'use client'

import { useEffect, useMemo, useState } from 'react'

import type { Trailer, Truck } from '../../lib/dispatch/mock-data'
import {
  formatTrailerMovement,
  getTrailerActions,
  resolveTrailerSituation,
  trailerCouplingLabels,
  trailerLoadLabels,
  trailerLocationLabels,
} from '../../lib/dispatch/trailer-rotation'
import type {
  TrailerActiveMission,
  TrailerCustodyMovement,
  TrailerLocation,
} from '../../lib/dispatch/trailer-rotation'

export type TrailerRotationResult = {
  trailer?: { id: string; truckId?: string | null; loadStatus?: string }
  missionKeptActive?: string | null
  resumedMissionId?: string | null
  resumedMissionReference?: string | null
}

type TrailerRotationPanelProps = {
  trailer: Trailer
  trucks: Truck[]
  /** Mission réellement portée par la remorque, null si aucune. */
  activeMission?: TrailerActiveMission | null
  /** Tracteurs libres, calculés par l'appelant. */
  availableTrucks?: Truck[]
  canManage?: boolean
  onOpenMission?: (missionId: string) => void
  onRotated?: (result: TrailerRotationResult, toast: string) => void
}

const locationOptions: TrailerLocation[] = [
  'BASE',
  'CLIENT',
  'IN_TRANSIT',
  'OTHER',
]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#8b9186]">
        {label}
      </p>
      <div className="mt-0.5 break-words text-[12px] font-semibold text-[#20211d]">
        {children}
      </div>
    </div>
  )
}

/**
 * Situation physique et opérationnelle d'une remorque, avec les seules actions
 * cohérentes avec son état courant. Remplace la présentation administrative
 * où « Statut = À la Base » dominait l'interface.
 */
export function TrailerRotationPanel({
  trailer,
  trucks,
  activeMission = null,
  availableTrucks,
  canManage = true,
  onOpenMission,
  onRotated,
}: TrailerRotationPanelProps) {
  const [dialog, setDialog] = useState<'NONE' | 'DETACH' | 'ATTACH'>('NONE')
  const [detachLocation, setDetachLocation] = useState<TrailerLocation>('BASE')
  const [detachLoad, setDetachLoad] = useState<'LOADED' | 'EMPTY'>(
    trailer.loadStatus === 'LOADED' ? 'LOADED' : 'EMPTY',
  )
  const [selectedTruckId, setSelectedTruckId] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [movements, setMovements] = useState<TrailerCustodyMovement[]>([])

  const situation = useMemo(
    () =>
      resolveTrailerSituation({
        id: trailer.id,
        plateNumber: trailer.plateNumber,
        truckId: trailer.truckId,
        truckPlate: trucks.find((truck) => truck.id === trailer.truckId)
          ?.plateNumber,
        loadStatus: trailer.loadStatus,
        status: trailer.status,
        activeMission,
      }),
    [trailer, trucks, activeMission],
  )
  const actions = getTrailerActions(situation)

  useEffect(() => {
    let cancelled = false
    async function loadHistory() {
      try {
        const response = await fetch(
          `/api/dispatch/trailers/history?trailerId=${encodeURIComponent(trailer.id)}`,
        )
        if (!response.ok) return
        const payload = (await response.json()) as {
          movements?: TrailerCustodyMovement[]
        }
        if (!cancelled) setMovements(payload.movements ?? [])
      } catch {
        // L'historique est un confort : son échec ne bloque aucune action.
      }
    }
    void loadHistory()
    return () => {
      cancelled = true
    }
  }, [trailer.id])

  const attachableTrucks = (availableTrucks ?? trucks).filter(
    (truck) => truck.id !== trailer.truckId,
  )

  async function rotate(body: Record<string, unknown>, toast: string) {
    try {
      setIsBusy(true)
      setError(null)
      const response = await fetch('/api/dispatch/trailers/rotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trailerId: trailer.id, ...body }),
      })
      const payload = (await response.json().catch(() => null)) as
        | (TrailerRotationResult & { error?: string })
        | null
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Opération impossible.')
      }
      setDialog('NONE')
      onRotated?.(payload ?? {}, toast)
    } catch (rotationError) {
      setError(
        rotationError instanceof Error
          ? rotationError.message
          : 'Opération impossible.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  /**
   * Le chargement n'est pas une rotation : il passe par l'endpoint remorque
   * existant, qui ne touche jamais `truckId`.
   */
  async function markEmpty() {
    try {
      setIsBusy(true)
      setError(null)
      const response = await fetch(`/api/dispatch/trailers/${trailer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loadStatus: 'EMPTY', cargoType: null }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Modification impossible.')
      }
      onRotated?.(
        { trailer: { id: trailer.id, loadStatus: 'EMPTY' } },
        `${trailer.plateNumber} marquée vide`,
      )
    } catch (markError) {
      setError(
        markError instanceof Error
          ? markError.message
          : 'Modification impossible.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const missionLabel = situation.activeMission
    ? `Mission ${situation.activeMission.missionReference}`
    : 'Aucune mission active'

  return (
    <section className="rounded-[24px] border border-black/[0.06] bg-[#f7f8f4] px-4 py-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Row label="Attelage">
          {situation.coupling === 'ATTACHED' && situation.truckPlate
            ? `Attelée à ${situation.truckPlate}`
            : trailerCouplingLabels[situation.coupling]}
        </Row>
        <Row label="Chargement">{trailerLoadLabels[situation.load]}</Row>
        <Row label="Mission">
          {situation.activeMission && onOpenMission ? (
            <button
              type="button"
              onClick={() => onOpenMission(situation.activeMission!.missionId)}
              className="underline underline-offset-2 hover:text-[#405c08]"
              style={{
                border: 0,
                background: 'none',
                padding: 0,
                font: 'inherit',
                cursor: 'pointer',
              }}
            >
              {missionLabel}
            </button>
          ) : (
            missionLabel
          )}
        </Row>
        <Row label="Localisation">
          {trailerLocationLabels[situation.location]}
        </Row>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      {/* Actions strictement cohérentes avec l'état courant. */}
      {canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.canDetach ? (
            <button
              type="button"
              data-action="detach"
              onClick={() => setDialog('DETACH')}
              className="rounded-full bg-[#11130f] min-h-[38px] px-3 py-1.5 text-[11px] sm:min-h-0 font-bold text-white transition hover:bg-[#B9FF4A] hover:text-[#11130F]"
              style={{ border: 0 }}
            >
              Décrocher
            </button>
          ) : null}
          {actions.canAttach ? (
            <button
              type="button"
              data-action="attach"
              onClick={() => setDialog('ATTACH')}
              className="rounded-full bg-[#11130f] min-h-[38px] px-3 py-1.5 text-[11px] sm:min-h-0 font-bold text-white transition hover:bg-[#B9FF4A] hover:text-[#11130F]"
              style={{ border: 0 }}
            >
              Atteler à un camion
            </button>
          ) : null}
          {actions.canMarkEmpty ? (
            <button
              type="button"
              data-action="mark-empty"
              disabled={isBusy}
              onClick={() => void markEmpty()}
              className="rounded-full border border-black/10 bg-white min-h-[38px] px-3 py-1.5 text-[11px] sm:min-h-0 font-semibold text-[#565c51] transition hover:border-lime-300"
            >
              Marquer vide
            </button>
          ) : null}
          {actions.canOpenMission && onOpenMission && situation.activeMission ? (
            <button
              type="button"
              data-action="open-mission"
              onClick={() => onOpenMission(situation.activeMission!.missionId)}
              className="rounded-full border border-black/10 bg-white min-h-[38px] px-3 py-1.5 text-[11px] sm:min-h-0 font-semibold text-[#565c51] transition hover:border-lime-300"
            >
              Ouvrir la mission
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Confirmation compacte de décrochage. */}
      {dialog === 'DETACH' ? (
        <div className="mt-3 rounded-[18px] border border-black/10 bg-white px-3 py-3">
          <p className="text-[12px] font-bold text-[#11130f]">
            Décrocher {trailer.plateNumber}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#8b9186]">
                Chargement
              </span>
              <select
                value={detachLoad}
                onChange={(event) =>
                  setDetachLoad(event.target.value as 'LOADED' | 'EMPTY')
                }
                className="mt-1 h-8 w-full rounded-xl border border-black/10 bg-white px-2 text-[11px] font-semibold"
              >
                <option value="LOADED">Chargée</option>
                <option value="EMPTY">Vide</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#8b9186]">
                Localisation après décrochage
              </span>
              <select
                value={detachLocation}
                onChange={(event) =>
                  setDetachLocation(event.target.value as TrailerLocation)
                }
                className="mt-1 h-8 w-full rounded-xl border border-black/10 bg-white px-2 text-[11px] font-semibold"
              >
                {locationOptions.map((option) => (
                  <option key={option} value={option}>
                    {trailerLocationLabels[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {situation.activeMission ? (
            <p className="mt-2 text-[11px] font-semibold text-amber-700">
              Mission active {situation.activeMission.missionReference} · la
              mission restera active.
            </p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDialog('NONE')}
              className="rounded-full border border-black/10 bg-white min-h-[38px] px-3 py-1.5 text-[11px] sm:min-h-0 font-semibold text-[#565c51]"
            >
              Annuler
            </button>
            <button
              type="button"
              data-action="confirm-detach"
              disabled={isBusy}
              onClick={() =>
                void rotate(
                  {
                    action: 'DETACH',
                    location: detachLocation,
                    loadStatus: detachLoad,
                  },
                  situation.activeMission
                    ? `${trailer.plateNumber} décrochée · Mission ${situation.activeMission.missionReference} toujours active`
                    : `${trailer.plateNumber} décrochée`,
                )
              }
              className="rounded-full bg-[#11130f] min-h-[38px] px-3 py-1.5 text-[11px] sm:min-h-0 font-bold text-white disabled:bg-black/20"
              style={{ border: 0 }}
            >
              {isBusy ? 'Décrochage…' : 'Décrocher'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Attelage, avec reprise explicite de la mission portée. */}
      {dialog === 'ATTACH' ? (
        <div className="mt-3 rounded-[18px] border border-black/10 bg-white px-3 py-3">
          <p className="text-[12px] font-bold text-[#11130f]">
            Atteler {trailer.plateNumber}
          </p>
          {situation.activeMission ? (
            <p className="mt-2 rounded-xl bg-amber-50 px-2.5 py-2 text-[11px] font-semibold leading-relaxed text-amber-800">
              Cette remorque transporte déjà la mission{' '}
              {situation.activeMission.missionReference}. L’attelage reprendra
              cette mission. Aucune nouvelle mission ne sera créée.
            </p>
          ) : null}
          <label className="mt-2 block">
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#8b9186]">
              Tracteur
            </span>
            <select
              value={selectedTruckId}
              onChange={(event) => setSelectedTruckId(event.target.value)}
              className="mt-1 h-8 w-full rounded-xl border border-black/10 bg-white px-2 text-[11px] font-semibold"
            >
              <option value="">Choisir un tracteur…</option>
              {attachableTrucks.map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.plateNumber}
                  {truck.model ? ` · ${truck.model}` : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDialog('NONE')}
              className="rounded-full border border-black/10 bg-white min-h-[38px] px-3 py-1.5 text-[11px] sm:min-h-0 font-semibold text-[#565c51]"
            >
              Annuler
            </button>
            <button
              type="button"
              data-action="confirm-attach"
              disabled={isBusy || !selectedTruckId}
              onClick={() =>
                void rotate(
                  { action: 'ATTACH', truckId: selectedTruckId },
                  situation.activeMission
                    ? `Mission ${situation.activeMission.missionReference} reprise avec ${trailer.plateNumber}`
                    : `${trailer.plateNumber} attelée`,
                )
              }
              className="rounded-full bg-[#11130f] min-h-[38px] px-3 py-1.5 text-[11px] sm:min-h-0 font-bold text-white disabled:bg-black/20"
              style={{ border: 0 }}
            >
              {isBusy ? 'Attelage…' : 'Atteler'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Derniers mouvements, issus de TrailerCustodyEvent. */}
      {movements.length > 0 ? (
        <div className="mt-3 border-t border-black/[0.07] pt-2">
          <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#8b9186]">
            Derniers mouvements
          </p>
          <ul className="mt-1.5 space-y-1">
            {movements.map((movement) => (
              <li
                key={movement.id}
                className="flex flex-wrap items-baseline gap-x-2 text-[10px] leading-tight text-[#5f655b]"
              >
                <time className="font-semibold text-[#8b9186]">
                  {new Intl.DateTimeFormat('fr-FR', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(movement.occurredAt))}
                </time>
                <span className="break-words">
                  {formatTrailerMovement(movement)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
