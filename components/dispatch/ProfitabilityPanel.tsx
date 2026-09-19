'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'

import { formatDateParam } from '../../lib/dispatch/date-utils'
import type {
  MissingDataItem,
  ProfitabilityGroup,
  ProfitabilityMission,
  ProfitabilityResult,
} from '../../lib/dispatch/profitability'
import {
  defaultGroupSort,
  defaultMissionSort,
  getExtremes,
  groupSortLabels,
  groupSortOrder,
  listMissionClients,
  marginFilterLabels,
  marginFilterOrder,
  missionSortLabels,
  missionSortOrder,
  parseProfitabilityView,
  profitabilityViewLabels,
  profitabilityViews,
  profitabilityViewShortLabels,
  resolveCrossNavigation,
  selectGroups,
  selectMissions,
} from '../../lib/dispatch/profitability-view'
import type {
  CrossDimension,
  GroupSortKey,
  MarginFilter,
  MissionSortKey,
  ProfitabilityView,
} from '../../lib/dispatch/profitability-view'

type ProfitabilityResponse = ProfitabilityResult

type ProfitabilityPanelProps = {
  weekStart: Date
  compact?: boolean
}

const defaultParameters = {
  fuelPricePerLiter: '1.65',
  defaultConsumptionL100: '30',
  defaultDriverHourlyCost: '20',
}

export function ProfitabilityPanel({
  weekStart,
  compact = false,
}: ProfitabilityPanelProps) {
  const router = useRouter()
  const [parameters, setParameters] = useState(defaultParameters)
  const [data, setData] = useState<ProfitabilityResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [tollCostInput, setTollCostInput] = useState('0')
  const [isSavingTollCost, setIsSavingTollCost] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'xlsx' | null>(
    null
  )

  // Vue active : lue dans l'URL au montage pour survivre à un rafraîchissement.
  const [view, setView] = useState<ProfitabilityView>('overview')
  const [search, setSearch] = useState('')
  const [marginFilter, setMarginFilter] = useState<MarginFilter>('ALL')
  const [missionSort, setMissionSort] =
    useState<MissionSortKey>(defaultMissionSort)
  const [groupSort, setGroupSort] = useState<GroupSortKey>(defaultGroupSort)
  const [clientKey, setClientKey] = useState<string | null>(null)

  useEffect(() => {
    if (!router.isReady) return
    setView(parseProfitabilityView(
      typeof router.query.group === 'string' ? router.query.group : null
    ))
  }, [router.isReady, router.query.group])

  const changeView = useCallback(
    (nextView: ProfitabilityView) => {
      setView(nextView)
      // La recherche reste locale ; seul le type de vue est mémorisé.
      void router.replace(
        {
          pathname: router.pathname,
          query: { ...router.query, view: 'profitability', group: nextView },
        },
        undefined,
        { shallow: true, scroll: false }
      )
    },
    [router]
  )

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      weekStart: formatDateParam(weekStart),
      fuelPricePerLiter: parameters.fuelPricePerLiter || '1.65',
      defaultConsumptionL100: parameters.defaultConsumptionL100 || '30',
      defaultDriverHourlyCost: parameters.defaultDriverHourlyCost || '20',
    })

    return params.toString()
  }, [parameters, weekStart])

  useEffect(() => {
    const controller = new AbortController()

    async function loadProfitability() {
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch(
          `/api/dispatch/profitability?${queryString}`,
          {
            signal: controller.signal,
          }
        )

        if (!response.ok) {
          throw new Error(`Profitability API returned ${response.status}`)
        }

        setData((await response.json()) as ProfitabilityResponse)
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === 'AbortError'
        ) {
          return
        }

        console.error('Unable to load profitability', loadError)
        setError('Rentabilité indisponible pour le moment.')
      } finally {
        setIsLoading(false)
      }
    }

    loadProfitability()

    return () => controller.abort()
  }, [queryString])

  useEffect(() => {
    if (!data) {
      return
    }

    setTollCostInput(String(data.summary.tollCostAmount ?? 0))
  }, [data?.summary.tollCostAmount])

  async function handleSaveTollCost() {
    try {
      setIsSavingTollCost(true)
      setError(null)

      const response = await fetch(
        `/api/dispatch/profitability?${queryString}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            weekStartDate: formatDateParam(weekStart),
            tollCostAmount: tollCostInput,
          }),
        }
      )

      if (!response.ok) {
        throw new Error(`Profitability save API returned ${response.status}`)
      }

      setData((await response.json()) as ProfitabilityResponse)
    } catch (saveError) {
      console.error('Unable to save weekly toll cost', saveError)
      setError('Impossible d’enregistrer les péages semaine.')
    } finally {
      setIsSavingTollCost(false)
    }
  }

  async function handleExport(format: 'pdf' | 'xlsx') {
    try {
      setExportingFormat(format)
      setError(null)

      const response = await fetch(
        `/api/dispatch/profitability/export?format=${format}&${queryString}`
      )

      if (!response.ok) {
        throw new Error(`Export API returned ${response.status}`)
      }

      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `novotralux-rentabilite-${formatDateParam(
        weekStart
      )}.${format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(downloadUrl)
    } catch (exportError) {
      console.error('Unable to export profitability', exportError)
      setError("Impossible de générer l'export.")
    } finally {
      setExportingFormat(null)
    }
  }

  /**
   * Référence du filtre « faible marge » : le taux global de la période
   * elle-même. Aucun seuil métier n'est introduit.
   */
  const referenceRate = data?.summary.marginRate ?? null

  // Toutes les données de la période sont déjà chargées : filtres, recherche
  // et tri restent côté client, mémoïsés pour ne pas rejouer les agrégats à
  // chaque frappe.
  const missions = useMemo(
    () =>
      data
        ? selectMissions(
            data.byMission,
            { search, marginFilter, sortKey: missionSort, clientKey },
            referenceRate
          )
        : [],
    [data, search, marginFilter, missionSort, clientKey, referenceRate]
  )

  const drivers = useMemo(
    () =>
      data
        ? selectGroups(
            data.byDriver,
            { search, marginFilter, sortKey: groupSort },
            referenceRate
          )
        : [],
    [data, search, marginFilter, groupSort, referenceRate]
  )

  const trucks = useMemo(
    () =>
      data
        ? selectGroups(
            data.byTruck,
            { search, marginFilter, sortKey: groupSort },
            referenceRate
          )
        : [],
    [data, search, marginFilter, groupSort, referenceRate]
  )

  const trailers = useMemo(
    () =>
      data
        ? selectGroups(
            data.byTrailer,
            { search, marginFilter, sortKey: groupSort },
            referenceRate
          )
        : [],
    [data, search, marginFilter, groupSort, referenceRate]
  )

  const clients = useMemo(
    () =>
      data
        ? selectGroups(
            data.byClient,
            { search, marginFilter, sortKey: groupSort },
            referenceRate
          )
        : [],
    [data, search, marginFilter, groupSort, referenceRate]
  )

  const clientOptions = useMemo(
    () => (data ? listMissionClients(data.byMission) : []),
    [data]
  )

  function handleCrossNavigation(
    mission: ProfitabilityMission,
    dimension: CrossDimension
  ) {
    const navigation = resolveCrossNavigation(mission, dimension)
    if (!navigation) return

    changeView(navigation.view)
    setSearch(navigation.search)
    setMarginFilter('ALL')
    setClientKey(null)
  }

  const isMissionView = view === 'missions'

  return (
    <section
      className={[
        'min-h-0 flex-1 overflow-auto',
        compact ? 'px-4 pb-8 pt-4' : 'pb-10 pt-3',
      ].join(' ')}
    >
      <div className="space-y-4">
        {/*
          Bandeau supérieur collant : quelle que soit la position dans une
          longue liste, la vue active, le filtre appliqué et le terme
          recherché restent lisibles.
        */}
        <div className="sticky top-0 z-20 -mx-1 space-y-3 bg-[#F4F5F1]/95 px-1 pb-3 pt-1 backdrop-blur-xl">
          <div className="flex flex-col gap-3 rounded-[24px] border border-black/[0.04] bg-white/85 p-4 shadow-[0_14px_40px_rgba(17,18,15,0.05)] md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#777d72]">
                Rentabilité hebdomadaire
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-[#11130f]">
                Marge opérationnelle V1
              </h2>
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-end">
              <div className="grid grid-cols-3 gap-2">
                <ParameterInput
                  label="€/L"
                  value={parameters.fuelPricePerLiter}
                  onChange={(value) =>
                    setParameters((current) => ({
                      ...current,
                      fuelPricePerLiter: value,
                    }))
                  }
                />
                <ParameterInput
                  label="L/100"
                  value={parameters.defaultConsumptionL100}
                  onChange={(value) =>
                    setParameters((current) => ({
                      ...current,
                      defaultConsumptionL100: value,
                    }))
                  }
                />
                <ParameterInput
                  label="€/h"
                  value={parameters.defaultDriverHourlyCost}
                  onChange={(value) =>
                    setParameters((current) => ({
                      ...current,
                      defaultDriverHourlyCost: value,
                    }))
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <ExportButton
                  disabled={Boolean(exportingFormat)}
                  label={exportingFormat === 'pdf' ? 'PDF...' : 'PDF'}
                  onClick={() => handleExport('pdf')}
                />
                <ExportButton
                  disabled={Boolean(exportingFormat)}
                  label={exportingFormat === 'xlsx' ? 'Excel...' : 'Excel'}
                  onClick={() => handleExport('xlsx')}
                />
              </div>
            </div>
          </div>

          <ViewSelector activeView={view} onChange={changeView} />

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="Rechercher mission, chauffeur, camion, remorque, client…"
            />

            <div className="dispatch-pool-scrollbar flex items-center gap-2 overflow-x-auto pb-1 lg:overflow-visible lg:pb-0">
              <ChipGroup
                label="Rentabilité"
                options={marginFilterOrder.map((filter) => ({
                  value: filter,
                  label: marginFilterLabels[filter],
                }))}
                active={marginFilter}
                onChange={setMarginFilter}
              />

              {view !== 'overview' ? (
                <ChipGroup
                  label="Trier"
                  options={
                    isMissionView
                      ? missionSortOrder.map((key) => ({
                          value: key,
                          label: missionSortLabels[key],
                        }))
                      : groupSortOrder.map((key) => ({
                          value: key,
                          label: groupSortLabels[key],
                        }))
                  }
                  active={isMissionView ? missionSort : groupSort}
                  onChange={(value) => {
                    if (isMissionView) setMissionSort(value as MissionSortKey)
                    else setGroupSort(value as GroupSortKey)
                  }}
                />
              ) : null}

              {isMissionView && clientOptions.length > 1 ? (
                <label className="flex shrink-0 items-center gap-2 rounded-[16px] bg-white px-3 py-1.5 shadow-[0_8px_22px_rgba(17,18,15,0.05)]">
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#9aa090]">
                    Client
                  </span>
                  <select
                    value={clientKey ?? ''}
                    onChange={(event) =>
                      setClientKey(event.target.value || null)
                    }
                    className="max-w-[150px] bg-transparent text-xs font-bold text-[#11130f] outline-none"
                    style={{ border: 0 }}
                  >
                    <option value="">Tous</option>
                    {clientOptions.map((client) => (
                      <option key={client} value={client}>
                        {client}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          </div>

          {data ? <KpiStrip summary={data.summary} /> : null}
        </div>

        {isLoading ? (
          <div className="rounded-[24px] bg-white p-6 text-sm font-semibold text-[#6f766b] shadow-[0_14px_40px_rgba(17,18,15,0.05)]">
            Calcul rentabilité...
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[24px] bg-red-50 p-6 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}

        {/* Une seule vue détaillée est montée à la fois. */}
        {data && view === 'overview' ? (
          <OverviewView
            data={data}
            onSaveTollCost={handleSaveTollCost}
            isSavingTollCost={isSavingTollCost}
            tollCostInput={tollCostInput}
            onTollCostChange={setTollCostInput}
            onOpenView={changeView}
          />
        ) : null}

        {data && view === 'missions' ? (
          <MissionListView
            missions={missions}
            totalCount={data.byMission.length}
            onCrossNavigate={handleCrossNavigation}
          />
        ) : null}

        {data && view === 'drivers' ? (
          <GroupListView
            title="Chauffeurs"
            groups={drivers}
            totalCount={data.byDriver.length}
          />
        ) : null}

        {data && view === 'trucks' ? (
          <GroupListView
            title="Camions"
            groups={trucks}
            totalCount={data.byTruck.length}
          />
        ) : null}

        {data && view === 'trailers' ? (
          <GroupListView
            title="Remorques"
            groups={trailers}
            totalCount={data.byTrailer.length}
          />
        ) : null}

        {data && view === 'clients' ? (
          <GroupListView
            title="Clients"
            groups={clients}
            totalCount={data.byClient.length}
          />
        ) : null}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Bandeau supérieur                                                   */
/* ------------------------------------------------------------------ */

function ViewSelector({
  activeView,
  onChange,
}: {
  activeView: ProfitabilityView
  onChange: (view: ProfitabilityView) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Analyse rentabilité"
      className="dispatch-pool-scrollbar flex items-center gap-1 overflow-x-auto rounded-[20px] bg-black/[0.035] p-1.5"
    >
      {profitabilityViews.map((view) => {
        const isActive = view === activeView

        return (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-profitability-view={view}
            onClick={() => onChange(view)}
            style={{ border: 0 }}
            className={[
              'h-9 shrink-0 rounded-[15px] px-3.5 text-xs font-semibold tracking-[-0.01em] transition-all duration-200',
              isActive
                ? 'bg-[#11130f] text-white shadow-[0_8px_22px_rgba(17,18,15,0.14)]'
                : 'text-[#5f665b] hover:bg-white/75 hover:text-[#11130f]',
            ].join(' ')}
          >
            <span className="hidden sm:inline">
              {profitabilityViewLabels[view]}
            </span>
            <span className="sm:hidden">
              {profitabilityViewShortLabels[view]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function SearchField({
  onChange,
  placeholder,
  value,
}: {
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2 rounded-[16px] bg-white px-3 py-2 shadow-[0_8px_22px_rgba(17,18,15,0.05)]">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0 text-[#9aa090]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-[#11130f] outline-none placeholder:font-medium placeholder:text-[#9aa090]"
        style={{ border: 0 }}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Effacer la recherche"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-xs text-[#5f665b]"
          style={{ border: 0 }}
        >
          ×
        </button>
      ) : null}
    </label>
  )
}

function ChipGroup<T extends string>({
  active,
  label,
  onChange,
  options,
}: {
  active: T
  label: string
  onChange: (value: T) => void
  options: Array<{ value: T; label: string }>
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-[16px] bg-white px-2 py-1.5 shadow-[0_8px_22px_rgba(17,18,15,0.05)]">
      <span className="px-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[#9aa090]">
        {label}
      </span>
      {options.map((option) => {
        const isActive = option.value === active

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            style={{ border: 0 }}
            className={[
              'h-7 whitespace-nowrap rounded-[11px] px-2.5 text-[11px] font-bold transition',
              isActive
                ? 'bg-[#11130f] text-white'
                : 'bg-[#F4F5F1] text-[#5f665b] hover:bg-[#e9ece2]',
            ].join(' ')}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function KpiStrip({
  summary,
}: {
  summary: ProfitabilityResponse['summary']
}) {
  const items: Array<[string, string]> = [
    ['CA', money(summary.revenueTotal)],
    ['Coûts', money(summary.operatingCostTotal)],
    ['Marge', money(summary.netProfitAfterTolls)],
    ['Taux', rate(summary.marginAfterTolls)],
    ['Missions', String(summary.missionCount)],
  ]

  return (
    <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="rounded-[16px] border border-black/[0.04] bg-white px-3 py-2 shadow-[0_8px_22px_rgba(17,18,15,0.04)]"
        >
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#9aa090]">
            {label}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold tracking-[-0.03em] text-[#11130f]">
            {value}
          </p>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Vue globale                                                         */
/* ------------------------------------------------------------------ */

function OverviewView({
  data,
  isSavingTollCost,
  onOpenView,
  onSaveTollCost,
  onTollCostChange,
  tollCostInput,
}: {
  data: ProfitabilityResponse
  isSavingTollCost: boolean
  onOpenView: (view: ProfitabilityView) => void
  onSaveTollCost: () => void
  onTollCostChange: (value: string) => void
  tollCostInput: string
}) {
  const driverExtremes = getExtremes(data.byDriver)
  const clientExtremes = getExtremes(data.byClient)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <DetailCard
          title="Résultat de la semaine"
          rows={[
            ['CA total', money(data.summary.revenueTotal)],
            ['Carburant', money(data.summary.fuelCostTotal)],
            ['Coût chauffeur', money(data.summary.driverCostTotal)],
            ['Péages semaine', money(data.summary.tollCostAmount)],
            ['Résultat avant péages', money(data.summary.grossProfitBeforeTolls)],
            ['Résultat net', money(data.summary.netProfitAfterTolls)],
            ['Taux net', rate(data.summary.marginAfterTolls)],
          ]}
        />
        <DetailCard
          title="Volumes"
          rows={[
            ['Missions', String(data.summary.missionCount)],
            ['Km total', `${data.summary.totalKm.toLocaleString('fr-FR')} km`],
            ['Km mission', `${data.summary.missionKm.toLocaleString('fr-FR')} km`],
            ['Km approche', `${data.summary.approachKm.toLocaleString('fr-FR')} km`],
            ['Km retour base', `${data.summary.returnToBaseKm.toLocaleString('fr-FR')} km`],
            ['Heures', `${data.summary.totalHours.toLocaleString('fr-FR')} h`],
            ['Coûts opérationnels', money(data.summary.operatingCostTotal)],
          ]}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ExtremeCard
          title="Chauffeurs"
          best={driverExtremes.best}
          worst={driverExtremes.worst}
          onOpen={() => onOpenView('drivers')}
        />
        <ExtremeCard
          title="Clients"
          best={clientExtremes.best}
          worst={clientExtremes.worst}
          onOpen={() => onOpenView('clients')}
        />
      </div>

      <TollCostCard
        isSaving={isSavingTollCost}
        onChange={onTollCostChange}
        onSave={onSaveTollCost}
        value={tollCostInput}
      />

      <MissingDataSection data={data.missingData} />
    </div>
  )
}

function DetailCard({
  rows,
  title,
}: {
  rows: Array<[string, string]>
  title: string
}) {
  return (
    <section className="rounded-[24px] bg-white p-4 shadow-[0_14px_40px_rgba(17,18,15,0.05)]">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#5f665b]">
        {title}
      </h3>
      <dl className="mt-3 divide-y divide-black/[0.05]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-1.5">
            <dt className="text-xs font-semibold text-[#73796d]">{label}</dt>
            <dd className="text-xs font-bold text-[#11130f]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function ExtremeCard({
  best,
  onOpen,
  title,
  worst,
}: {
  best: ProfitabilityGroup | null
  onOpen: () => void
  title: string
  worst: ProfitabilityGroup | null
}) {
  return (
    <section className="rounded-[24px] bg-white p-4 shadow-[0_14px_40px_rgba(17,18,15,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#5f665b]">
          {title}
        </h3>
        <button
          type="button"
          onClick={onOpen}
          style={{ border: 0 }}
          className="rounded-[11px] bg-[#F4F5F1] px-2.5 py-1 text-[10px] font-bold text-[#4f5549] transition hover:bg-[#e9ece2]"
        >
          Tout voir
        </button>
      </div>
      <div className="mt-3 space-y-2">
        <ExtremeRow label="Meilleure marge" group={best} />
        <ExtremeRow label="Plus faible marge" group={worst} />
      </div>
    </section>
  )
}

function ExtremeRow({
  group,
  label,
}: {
  group: ProfitabilityGroup | null
  label: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[16px] bg-[#F7F8F4] px-3 py-2">
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#9aa090]">
          {label}
        </p>
        <p className="mt-0.5 truncate text-xs font-bold text-[#11130f]">
          {group ? group.label : 'Aucune donnée'}
        </p>
      </div>
      {group ? (
        <MarginBadge
          value={group.operationalMarginTotal}
          rateValue={group.marginRate}
        />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Vue Missions                                                        */
/* ------------------------------------------------------------------ */

function MissionListView({
  missions,
  onCrossNavigate,
  totalCount,
}: {
  missions: ProfitabilityMission[]
  onCrossNavigate: (
    mission: ProfitabilityMission,
    dimension: CrossDimension
  ) => void
  totalCount: number
}) {
  return (
    <ListShell
      title="Missions"
      shownCount={missions.length}
      totalCount={totalCount}
    >
      {missions.map((mission) => (
        <article
          key={mission.missionId}
          data-profitability-mission-id={mission.missionId}
          className="rounded-[18px] border border-black/[0.05] bg-white px-3.5 py-3 shadow-[0_8px_22px_rgba(17,18,15,0.04)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold uppercase tracking-[0.05em] text-[#11130f]">
                {mission.reference}
                {mission.clientReference ? (
                  <span className="text-[#9aa090]">
                    {' '}
                    · {mission.clientReference}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 truncate text-[11px] font-semibold text-[#73796d]">
                {mission.pickupCity} → {mission.deliveryCity}
              </p>
            </div>
            <MarginBadge
              value={mission.operationalMargin}
              rateValue={mission.marginRate}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ResourceChip
              label={mission.clientName}
              onClick={() => onCrossNavigate(mission, 'client')}
            />
            <ResourceChip
              label={mission.driverName}
              onClick={() => onCrossNavigate(mission, 'driver')}
            />
            <ResourceChip
              label={mission.truckPlateNumber}
              onClick={() => onCrossNavigate(mission, 'truck')}
            />
            <ResourceChip
              label={mission.trailerPlateNumber}
              onClick={() => onCrossNavigate(mission, 'trailer')}
            />
          </div>

          <MetricRow
            items={[
              ['CA', money(mission.revenue)],
              ['Coûts', money(mission.fuelCost + mission.driverCost)],
              ['Marge', money(mission.operationalMargin)],
              ['Taux', rate(mission.marginRate)],
            ]}
          />
        </article>
      ))}
    </ListShell>
  )
}

/**
 * Ressource cliquable d'une ligne Mission. Non rendue quand la donnée est
 * absente : on ne propose jamais une navigation vers une vue vide.
 */
function ResourceChip({
  label,
  onClick,
}: {
  label: string | null
  onClick: () => void
}) {
  if (!label) return null

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ border: 0 }}
      data-profitability-resource={label}
      className="rounded-[10px] bg-[#F4F5F1] px-2 py-1 text-[10px] font-bold text-[#4f5549] transition hover:bg-[#B9FF4A]/35 hover:text-[#11130f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]"
    >
      {label}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Vues agrégées                                                       */
/* ------------------------------------------------------------------ */

function GroupListView({
  groups,
  title,
  totalCount,
}: {
  groups: ProfitabilityGroup[]
  title: string
  totalCount: number
}) {
  return (
    <ListShell title={title} shownCount={groups.length} totalCount={totalCount}>
      {groups.map((group) => (
        <article
          key={group.id}
          data-profitability-group-id={group.id}
          className="rounded-[18px] border border-black/[0.05] bg-white px-3.5 py-3 shadow-[0_8px_22px_rgba(17,18,15,0.04)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-[#11130f]">
                {group.label}
              </p>
              <p className="mt-0.5 text-[11px] font-semibold text-[#73796d]">
                {group.missionCount} mission{group.missionCount > 1 ? 's' : ''}
              </p>
            </div>
            <MarginBadge
              value={group.operationalMarginTotal}
              rateValue={group.marginRate}
            />
          </div>

          <MetricRow
            items={[
              ['CA', money(group.revenueTotal)],
              ['Coûts', money(group.fuelCostTotal + group.driverCostTotal)],
              ['Marge', money(group.operationalMarginTotal)],
              ['Taux', rate(group.marginRate)],
            ]}
          />
        </article>
      ))}
    </ListShell>
  )
}

function ListShell({
  children,
  shownCount,
  title,
  totalCount,
}: {
  children: React.ReactNode
  shownCount: number
  title: string
  totalCount: number
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 px-1 pb-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#5f665b]">
          {title}
        </h3>
        <span className="rounded-full bg-[#F4F5F1] px-2.5 py-0.5 text-[11px] font-bold text-[#4f5549]">
          {shownCount === totalCount
            ? shownCount
            : `${shownCount} / ${totalCount}`}
        </span>
      </div>

      {shownCount > 0 ? (
        <div className="space-y-1.5">{children}</div>
      ) : (
        <p className="rounded-[18px] bg-white px-4 py-5 text-center text-xs font-semibold text-[#7b8075] shadow-[0_8px_22px_rgba(17,18,15,0.04)]">
          Aucun résultat pour cette recherche ou ce filtre.
        </p>
      )}
    </section>
  )
}

/** Bandeau de chiffres aligné, pensé pour des lignes plutôt que des cartes. */
function MetricRow({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="mt-2 grid grid-cols-4 gap-1.5">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-[12px] bg-[#F7F8F4] px-2 py-1.5">
          <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-[#9aa090]">
            {label}
          </p>
          <p className="mt-0.5 truncate text-[11px] font-bold text-[#11130f]">
            {value}
          </p>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Blocs conservés                                                     */
/* ------------------------------------------------------------------ */

function TollCostCard({
  isSaving,
  onChange,
  onSave,
  value,
}: {
  isSaving: boolean
  onChange: (value: string) => void
  onSave: () => void
  value: string
}) {
  return (
    <div className="rounded-[24px] border border-black/[0.04] bg-white p-4 shadow-[0_14px_40px_rgba(17,18,15,0.05)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8b9186]">
            Péages semaine
          </p>
          <p className="mt-1 max-w-xl text-xs font-semibold text-[#5f665b]">
            Montant total issu du rapport péage hebdomadaire. Non ventilé par
            camion, chauffeur ou remorque.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[280px] sm:flex-row sm:items-end">
          <label className="block flex-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#7b8075]">
              Montant EUR
            </span>
            <input
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onBlur={onSave}
              inputMode="decimal"
              placeholder="0,00 €"
              className="mt-1 h-11 w-full rounded-[16px] border border-black/10 bg-[#F4F5F1] px-3 text-sm font-bold text-[#11130f] outline-none transition focus:border-lime-300 focus:bg-white"
            />
          </label>
          <button
            type="button"
            disabled={isSaving}
            onClick={onSave}
            className="h-11 rounded-[16px] bg-[#11130f] px-4 text-xs font-bold text-white shadow-[0_12px_28px_rgba(17,18,15,0.13)] transition active:scale-95 disabled:bg-black/25"
            style={{ border: 0 }}
          >
            {isSaving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ParameterInput({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="block">
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#7b8075]">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        className="mt-1 h-10 w-full rounded-[15px] border border-black/10 bg-[#F4F5F1] px-3 text-sm font-bold text-[#11130f] outline-none transition focus:border-lime-300 focus:bg-white"
      />
    </label>
  )
}

function ExportButton({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-10 rounded-[15px] bg-[#11130f] px-4 text-xs font-bold text-white shadow-[0_12px_28px_rgba(17,18,15,0.13)] transition active:scale-95 disabled:bg-black/25"
      style={{ border: 0 }}
    >
      {label}
    </button>
  )
}

function MissingDataSection({
  data,
}: {
  data: ProfitabilityResponse['missingData']
}) {
  return (
    <section className="grid gap-3 lg:grid-cols-2">
      <MissingList
        title="Données critiques"
        items={data.critical}
        tone="critical"
      />
      <MissingList
        title="Données optionnelles"
        items={data.optional}
        tone="optional"
      />
    </section>
  )
}

function MissingList({
  items,
  title,
  tone,
}: {
  items: MissingDataItem[]
  title: string
  tone: 'critical' | 'optional'
}) {
  return (
    <div className="rounded-[24px] bg-white p-4 shadow-[0_14px_40px_rgba(17,18,15,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#5f665b]">
          {title}
        </h3>
        <span className="rounded-full bg-[#F4F5F1] px-2.5 py-0.5 text-[11px] font-bold text-[#4f5549]">
          {items.length}
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        {items.length > 0 ? (
          items.slice(0, 18).map((item, index) => (
            <div
              key={`${item.missionId}-${item.field}-${index}`}
              className={[
                'rounded-[14px] px-3 py-2 text-[11px] font-semibold',
                tone === 'critical'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-[#F7F8F4] text-[#6f766b]',
              ].join(' ')}
            >
              {item.reference} · {item.label}
            </div>
          ))
        ) : (
          <p className="rounded-[14px] bg-[#F7F8F4] px-3 py-2 text-[11px] font-semibold text-[#7b8075]">
            Rien à signaler.
          </p>
        )}
      </div>
    </div>
  )
}

function MarginBadge({
  rateValue,
  value,
}: {
  rateValue: number | null
  value: number
}) {
  const isPositive = value >= 0

  return (
    <span
      className={[
        'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold',
        isPositive ? 'bg-lime-100 text-[#486300]' : 'bg-red-50 text-red-700',
      ].join(' ')}
    >
      {money(value)} · {rate(rateValue)}
    </span>
  )
}

function money(value: number) {
  return `${value.toLocaleString('fr-FR', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })} €`
}

function rate(value: number | null) {
  if (value === null) {
    return 'n/a'
  }

  return `${(value * 100).toLocaleString('fr-FR', {
    maximumFractionDigits: 1,
  })} %`
}
