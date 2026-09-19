'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  isSearchTermUsable,
  isSmartSearchEmpty,
  SMART_SEARCH_DEBOUNCE_MS,
} from '../../lib/dispatch/smart-search'
import type {
  MissionSearchResult,
  SmartSearchResponse,
  TrailerSearchResult,
  TruckSearchResult,
} from '../../lib/dispatch/smart-search'
import { resolveLocatorNavigation } from '../../lib/dispatch/smart-search-navigation'
import type {
  LocatorNavigation,
  SmartSearchResult,
} from '../../lib/dispatch/smart-search-navigation'

const emptyResults: SmartSearchResponse = {
  query: '',
  weekStart: '',
  missions: [],
  trucks: [],
  trailers: [],
}

/**
 * Recherche débouncée : une requête par pause de frappe, la précédente est
 * systématiquement annulée pour qu'une réponse lente ne écrase jamais une
 * réponse plus récente.
 */
export function useSmartSearch(weekStart: string, isEnabled: boolean) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SmartSearchResponse>(emptyResults)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!isEnabled) {
      setResults(emptyResults)
      setIsLoading(false)
      return
    }

    if (!isSearchTermUsable(query)) {
      setResults(emptyResults)
      setIsLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setIsLoading(true)

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/dispatch/search?q=${encodeURIComponent(
            query
          )}&weekStart=${encodeURIComponent(weekStart)}`,
          { signal: controller.signal }
        )

        if (!response.ok) throw new Error('search failed')
        const payload = (await response.json()) as SmartSearchResponse

        // Une réponse périmée ne doit jamais remplacer une plus récente.
        if (requestIdRef.current !== requestId) return
        setResults(payload)
        setError(null)
      } catch (caught) {
        if (controller.signal.aborted) return
        if (requestIdRef.current !== requestId) return
        setError('Recherche indisponible.')
        setResults(emptyResults)
      } finally {
        if (requestIdRef.current === requestId) setIsLoading(false)
      }
    }, SMART_SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [isEnabled, query, weekStart])

  const reset = useCallback(() => {
    requestIdRef.current += 1
    setQuery('')
    setResults(emptyResults)
    setError(null)
    setIsLoading(false)
  }, [])

  return { query, setQuery, results, isLoading, error, reset }
}

/* ------------------------------------------------------------------ */
/* Bouton loupe                                                        */
/* ------------------------------------------------------------------ */

export function SmartSearchButton({
  onClick,
  className = '',
}: {
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ border: 0 }}
      aria-label="Rechercher une mission, un camion ou une remorque"
      title="Recherche"
      className={
        className ||
        'flex h-[46px] w-[46px] items-center justify-center rounded-[18px] bg-white/70 text-[#5f665b] shadow-[0_10px_26px_rgba(17,18,15,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#B9FF4A]/20 hover:text-[#11120f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/60'
      }
    >
      <SearchIcon />
    </button>
  )
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[17px] w-[17px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

type SmartSearchPanelProps = {
  isOpen: boolean
  onClose: () => void
  /** Semaine actuellement affichée (`yyyy-mm-dd`). */
  weekStart: string
  onSelect: (result: SmartSearchResult, navigation: LocatorNavigation) => void
  /** `mobile` ancre la palette en bas de l'écran (command sheet). */
  variant?: 'desktop' | 'mobile'
}

export function DispatchSmartSearchPanel({
  isOpen,
  onClose,
  weekStart,
  onSelect,
  variant = 'desktop',
}: SmartSearchPanelProps) {
  const { query, setQuery, results, isLoading, error, reset } = useSmartSearch(
    weekStart,
    isOpen
  )
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      reset()
      return
    }
    inputRef.current?.focus()
  }, [isOpen, reset])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleSelect = useCallback(
    (result: SmartSearchResult) => {
      onSelect(result, resolveLocatorNavigation(result, weekStart))
      onClose()
    },
    [onClose, onSelect, weekStart]
  )

  const hasQuery = isSearchTermUsable(query)
  const isEmpty = useMemo(() => isSmartSearchEmpty(results), [results])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recherche Dispatch"
      className="fixed inset-0 z-[120] flex justify-center bg-[#11130f]/35 px-4 backdrop-blur-[2px]"
      style={{
        alignItems: variant === 'mobile' ? 'flex-end' : 'flex-start',
        paddingTop: variant === 'mobile' ? 0 : '10vh',
        paddingBottom: variant === 'mobile' ? 0 : '2rem',
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={[
          'flex w-full max-w-[560px] flex-col overflow-hidden bg-white shadow-[0_30px_80px_rgba(17,18,15,0.28)]',
          variant === 'mobile'
            ? 'max-h-[82vh] rounded-t-[26px]'
            : 'max-h-[70vh] rounded-[24px]',
        ].join(' ')}
      >
        <div className="flex items-center gap-3 border-b border-black/[0.06] px-4 py-3">
          <span className="text-[#8d9386]">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher mission, plaque, remorque, référence client…"
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#11120f] outline-none placeholder:font-medium placeholder:text-[#9aa090]"
            style={{ border: 0 }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la recherche"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-sm text-[#5f665b]"
            style={{ border: 0 }}
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {!hasQuery ? (
            <p className="px-2 py-6 text-center text-xs font-semibold text-[#9aa090]">
              Saisissez au moins 2 caractères : référence, CMR, bon de
              livraison, client ou plaque.
            </p>
          ) : error ? (
            <p className="px-2 py-6 text-center text-xs font-semibold text-red-600">
              {error}
            </p>
          ) : isLoading && isEmpty ? (
            <p className="px-2 py-6 text-center text-xs font-semibold text-[#9aa090]">
              Recherche…
            </p>
          ) : isEmpty ? (
            <p className="px-2 py-6 text-center text-xs font-semibold text-[#9aa090]">
              Aucun résultat pour « {query} ».
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <ResultSection title="Missions" count={results.missions.length}>
                {results.missions.map((mission) => (
                  <MissionResultCard
                    key={mission.id}
                    mission={mission}
                    onSelect={handleSelect}
                    weekStart={weekStart}
                  />
                ))}
              </ResultSection>

              <ResultSection title="Camions" count={results.trucks.length}>
                {results.trucks.map((truck) => (
                  <TruckResultCard
                    key={truck.id}
                    truck={truck}
                    onSelect={handleSelect}
                    weekStart={weekStart}
                  />
                ))}
              </ResultSection>

              <ResultSection title="Remorques" count={results.trailers.length}>
                {results.trailers.map((trailer) => (
                  <TrailerResultCard
                    key={trailer.id}
                    trailer={trailer}
                    onSelect={handleSelect}
                    weekStart={weekStart}
                  />
                ))}
              </ResultSection>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ResultSection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  if (count === 0) return null

  return (
    <section>
      <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#9aa090]">
        {title} · {count}
      </p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  )
}

const resultCardClassName =
  'w-full rounded-[16px] bg-[#f7f8f4] px-3 py-2.5 text-left transition hover:bg-[#eef1e6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]'

function ResultActionLabel({ label }: { label: string }) {
  return (
    <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#49630b]">
      {label} <span aria-hidden="true">-&gt;</span>
    </span>
  )
}

function MissionResultCard({
  mission,
  onSelect,
  weekStart,
}: {
  mission: MissionSearchResult
  onSelect: (result: SmartSearchResult) => void
  weekStart: string
}) {
  const navigation = resolveLocatorNavigation(mission, weekStart)
  const planningLine = [
    mission.driverName,
    mission.truckPlate,
    mission.trailerPlate,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      type="button"
      onClick={() => onSelect(mission)}
      className={resultCardClassName}
      style={{ border: 0 }}
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#20211d]">
        {mission.reference}
        {mission.clientName ? (
          <span className="text-[#747a6f]"> · {mission.clientName}</span>
        ) : null}
      </p>
      <p className="mt-1 text-[11px] font-semibold text-[#11120f]">
        {mission.situationLabel}
        {mission.spanLabel ? (
          <span className="text-[#747a6f]"> · {mission.spanLabel}</span>
        ) : null}
      </p>
      {mission.weekRelation && mission.weekRelation !== 'CURRENT' ? (
        <p className="mt-0.5 text-[10px] font-semibold text-[#8a6b00]">
          {mission.weekRelationLabel}
        </p>
      ) : null}
      {mission.locationType !== 'PLANNING' ? (
        <p className="mt-0.5 text-[10px] font-semibold text-[#62665c]">
          {mission.bucketLabel}
          {mission.note ? ` · ${mission.note}` : ''}
        </p>
      ) : null}
      {planningLine ? (
        <p className="mt-0.5 text-[10px] font-semibold text-[#62665c]">
          {planningLine}
        </p>
      ) : null}
      <ResultActionLabel label={navigation.actionLabel} />
    </button>
  )
}

function TruckResultCard({
  truck,
  onSelect,
  weekStart,
}: {
  truck: TruckSearchResult
  onSelect: (result: SmartSearchResult) => void
  weekStart: string
}) {
  const navigation = resolveLocatorNavigation(truck, weekStart)

  return (
    <button
      type="button"
      onClick={() => onSelect(truck)}
      className={resultCardClassName}
      style={{ border: 0 }}
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#20211d]">
        {truck.plateNumber}
        {truck.model ? (
          <span className="text-[#747a6f]"> · {truck.model}</span>
        ) : null}
      </p>
      <p className="mt-1 text-[11px] font-semibold text-[#11120f]">
        {truck.planningLabel}
      </p>
      <p className="mt-0.5 text-[10px] font-semibold text-[#62665c]">
        Remorque : {truck.trailerLabel}
      </p>
      <p className="mt-0.5 text-[10px] font-semibold text-[#62665c]">
        Statut : {truck.statusLabel}
      </p>
      <ResultActionLabel label={navigation.actionLabel} />
    </button>
  )
}

function TrailerResultCard({
  trailer,
  onSelect,
  weekStart,
}: {
  trailer: TrailerSearchResult
  onSelect: (result: SmartSearchResult) => void
  weekStart: string
}) {
  const navigation = resolveLocatorNavigation(trailer, weekStart)

  return (
    <button
      type="button"
      onClick={() => onSelect(trailer)}
      className={resultCardClassName}
      style={{ border: 0 }}
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#20211d]">
        {trailer.plateNumber}
        {trailer.typeLabel ? (
          <span className="text-[#747a6f]"> · {trailer.typeLabel}</span>
        ) : null}
      </p>
      <p className="mt-1 text-[11px] font-semibold text-[#11120f]">
        {trailer.situationLines.join(' · ')}
      </p>
      {trailer.driverName ? (
        <p className="mt-0.5 text-[10px] font-semibold text-[#62665c]">
          Chauffeur : {trailer.driverName}
        </p>
      ) : null}
      <ResultActionLabel label={navigation.actionLabel} />
    </button>
  )
}
