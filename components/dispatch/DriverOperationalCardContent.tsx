'use client'

import type { Driver, Truck } from '../../lib/dispatch/mock-data'

const activityLabels: Record<string, string> = {
  DRIVE_START: 'Conduite en cours',
  DRIVE_END: 'Conduite terminée',
  OTHER_WORK: 'Autre travail',
  BREAK: 'En pause',
  SPLIT_BREAK: 'Coupure',
  DAILY_REST: 'Repos journalier',
  WEEKLY_REST: 'Repos hebdomadaire',
  UNAVAILABLE: 'Indisponible',
  AVAILABLE: 'Disponible',
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function freshness(seconds: number | null) {
  if (seconds === null) return null
  if (seconds < 60) return 'à l’instant'
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `il y a ${Math.floor(seconds / 3600)} h`
  return `il y a ${Math.floor(seconds / 86400)} j`
}

export function getDriverCardState(driver: Driver, inMission = false) {
  const regulatory = driver.operationalSummary?.regulatoryStatus ?? 'AVERTISSEMENT'
  const unavailable = Boolean(driver.status) && driver.status !== 'ACTIVE'

  if (unavailable || regulatory === 'BLOQUANT') {
    return {
      label: 'Indisponible',
      lightClass:
        'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.13),0_0_10px_rgba(239,68,68,0.5)]',
    }
  }

  if (regulatory === 'AVERTISSEMENT') {
    return {
      label: inMission ? 'En mission' : 'Disponible',
      lightClass:
        'bg-orange-500 shadow-[0_0_0_3px_rgba(249,115,22,0.13),0_0_10px_rgba(249,115,22,0.5)]',
    }
  }

  return {
    label: inMission ? 'En mission' : 'Disponible',
    lightClass:
      'bg-lime-500 shadow-[0_0_0_3px_rgba(132,204,22,0.13),0_0_10px_rgba(132,204,22,0.5)]',
  }
}

export function normalizeDriverPhone(phone?: string | null) {
  const normalized = phone?.replace(/\D/g, '') ?? ''
  return normalized.length > 0 ? normalized : null
}

function DriverCallButton({
  phone,
  dense = false,
}: {
  phone?: string | null
  dense?: boolean
}) {
  const normalizedPhone = normalizeDriverPhone(phone)

  if (!normalizedPhone) return null

  return (
    <a
      href={`tel:${normalizedPhone}`}
      aria-label="Appeler le chauffeur"
      title="Appeler le chauffeur"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className={[
        'flex shrink-0 items-center justify-center rounded-full bg-black/[0.045] text-[#62685e] transition hover:bg-lime-100 hover:text-[#283700] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300',
        dense ? 'h-5 w-5' : 'h-7 w-7',
      ].join(' ')}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={dense ? 'h-3 w-3' : 'h-3.5 w-3.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92z" />
      </svg>
    </a>
  )
}

export function DriverOperationalCardContent({
  compact = false,
  driver,
  inMission = false,
  minimal = false,
  planning = false,
  truck,
}: {
  compact?: boolean
  driver: Driver
  inMission?: boolean
  minimal?: boolean
  planning?: boolean
  truck?: Truck | null
}) {
  const summary = driver.operationalSummary
  const regulatory = summary?.regulatoryStatus ?? 'AVERTISSEMENT'
  const cardState = getDriverCardState(driver, inMission)
  const positionDetail = summary
    ? [
        summary.positionLabel,
        summary.positionSource === 'DRIVER_GPS'
          ? freshness(summary.positionFreshnessSeconds)
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Position à vérifier'

  if (planning) {
    return (
      <div className="min-w-0">
        <p className="break-words text-[11px] font-black leading-[1.15] tracking-[-0.015em] text-[#11130f]">
          {driver.name}
        </p>
        <div className="mt-0.5 flex min-w-0 items-center gap-1">
          <p className="min-w-0 break-all text-[9px] font-semibold leading-[1.15] text-[#5f655b]">
            {driver.phone ?? 'Téléphone non renseigné'}
          </p>
          <DriverCallButton phone={driver.phone} dense />
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <p className="min-w-0 break-words text-[9px] font-semibold leading-[1.15] text-[#656b61]">
            {cardState.label}
          </p>
          <span
            aria-label={`Statut : ${cardState.label}`}
            title={cardState.label}
            className={`h-2 w-2 shrink-0 rounded-full ${cardState.lightClass}`}
          />
        </div>
      </div>
    )
  }

  if (minimal) {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-black leading-tight tracking-[-0.02em] text-[#11130f]">
            {driver.name}
          </p>
          <div className="mt-1.5 flex min-w-0 items-center gap-2">
            <p className="min-w-0 whitespace-normal text-[11px] font-semibold text-[#747a6f]">
              {cardState.label}
            </p>
            <span
              aria-label={`Statut : ${cardState.label}`}
              title={cardState.label}
              className={`h-2 w-2 shrink-0 rounded-full ${cardState.lightClass}`}
            />
          </div>
        </div>
        <DriverCallButton phone={driver.phone} />
      </div>
    )
  }

  return (
    <>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] bg-[#11130f] text-[11px] font-black text-white">
          {initials(driver.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black tracking-[-0.02em] text-[#11130f]">
            {driver.name}
          </p>
          <p className="mt-0.5 truncate text-[10px] font-semibold text-[#747a6f]">
            {truck?.plateNumber ?? 'Aucun tracteur'} · {cardState.label}
          </p>
        </div>
        <span
          aria-label={`Statut réglementaire : ${regulatory.toLowerCase()}`}
          title={`Statut réglementaire : ${regulatory.toLowerCase()}`}
          className={[
            'h-2.5 w-2.5 shrink-0 rounded-full ring-4',
            regulatory === 'CONFORME'
              ? 'bg-lime-500 ring-lime-100'
              : regulatory === 'AVERTISSEMENT'
                ? 'bg-amber-500 ring-amber-100'
                : 'bg-red-500 ring-red-100',
          ].join(' ')}
        />
      </div>

      {!compact ? (
        <div className="mt-2.5 space-y-1.5">
          <p className="truncate text-[10px] font-semibold text-[#62695e]">
            Position · {positionDetail}
          </p>
          {summary?.openActivity ? (
            <p className="truncate text-[10px] font-bold text-amber-700">
              {summary.currentActivity
                ? activityLabels[summary.currentActivity] ?? 'Activité ouverte'
                : 'Activité ouverte'}
            </p>
          ) : null}
          <p
            className={[
              'truncate rounded-lg px-2 py-1 text-[9px] font-bold',
              regulatory === 'CONFORME'
                ? 'bg-lime-50 text-[#49630b]'
                : regulatory === 'AVERTISSEMENT'
                  ? 'bg-amber-50 text-amber-800'
                  : 'bg-red-50 text-red-700',
            ].join(' ')}
            title={summary?.priorityAction ?? 'Consulter la fiche chauffeur'}
          >
            {summary?.priorityAction ?? 'Consulter la fiche chauffeur'}
          </p>
        </div>
      ) : (
        <p className="mt-1.5 truncate text-[9px] font-semibold text-[#777d72]">
          {summary?.openActivity
            ? activityLabels[summary.currentActivity ?? ''] ?? 'Activité ouverte'
            : positionDetail}
        </p>
      )}
    </>
  )
}
