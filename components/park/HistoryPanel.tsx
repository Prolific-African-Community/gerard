'use client'

import { useEffect, useMemo, useState } from 'react'
import { ParkMovementAction } from '@prisma/client'

import type { ParkMovementDTO } from '../../lib/park/types'
import { ACTION_LABELS, formatDateTime } from './parkKit'

type HistoryPanelProps = {
  open: boolean
  canViewHistory: boolean
  onClose: () => void
}

export function HistoryPanel({ open, canViewHistory, onClose }: HistoryPanelProps) {
  const [movements, setMovements] = useState<ParkMovementDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState<'ALL' | ParkMovementAction>(
    'ALL'
  )

  useEffect(() => {
    if (!open || !canViewHistory) return
    let cancelled = false
    setLoading(true)
    setError('')
    fetch('/api/park/history?limit=300')
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'Chargement impossible.')
        if (!cancelled) setMovements(data.history)
      })
      .catch((loadError: unknown) => {
        if (!cancelled)
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Chargement impossible.'
          )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, canViewHistory])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return movements.filter((movement) => {
      if (actionFilter !== 'ALL' && movement.action !== actionFilter) return false
      if (query) {
        const haystack = `${movement.plateNumber} ${movement.fromSpotCode ?? ''} ${
          movement.toSpotCode ?? ''
        } ${movement.actorName ?? ''}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [movements, search, actionFilter])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Historique des mouvements du parc"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-black/[.06] p-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-[#86ad00]">
              Traçabilité
            </p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-[#171914]">
              Historique des mouvements
            </h2>
            <p className="mt-0.5 text-sm text-[#8a9082]">
              Journal en lecture seule des déplacements de véhicules.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer l’historique"
            className="h-9 w-9 rounded-full bg-black/[.05] text-xl leading-none text-[#4a4d45]"
          >
            ×
          </button>
        </header>

        <div className="flex flex-col gap-2 border-b border-black/[.06] p-4 sm:flex-row">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher (plaque, emplacement, utilisateur)…"
            className="h-11 flex-1 rounded-xl border border-black/10 bg-[#f7f8f5] px-3 text-sm outline-none focus:border-[#8eb800]"
          />
          <select
            value={actionFilter}
            onChange={(event) =>
              setActionFilter(event.target.value as 'ALL' | ParkMovementAction)
            }
            aria-label="Filtrer par action"
            className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          >
            <option value="ALL">Toutes les actions</option>
            <option value={ParkMovementAction.PLACE}>Placement</option>
            <option value={ParkMovementAction.MOVE}>Déplacement</option>
            <option value={ParkMovementAction.REMOVE}>Retrait</option>
          </select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <span className="h-8 w-8 animate-spin rounded-full border-4 border-black/10 border-t-[#8eb800]" />
            </div>
          ) : error ? (
            <p className="p-6 text-sm font-semibold text-red-700">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="p-10 text-center text-sm text-[#8a9082]">
              Aucun mouvement à afficher.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[#f3f5f0] text-[10px] uppercase tracking-wide text-[#747a6f]">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Véhicule</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Trajet</th>
                  <th className="px-4 py-3">Utilisateur</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((movement) => (
                  <tr key={movement.id} className="border-t border-black/[.06]">
                    <td className="whitespace-nowrap px-4 py-3 text-[#5b5f55]">
                      {formatDateTime(movement.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-black">{movement.plateNumber}</td>
                    <td className="px-4 py-3">{ACTION_LABELS[movement.action]}</td>
                    <td className="px-4 py-3 text-[#5b5f55]">
                      {movement.fromSpotCode ?? '—'} → {movement.toSpotCode ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-[#5b5f55]">
                      {movement.actorName ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
