import {
  addDays,
  formatWeekLabel,
  getWeekStartDate,
} from '../../../lib/dispatch/date-utils'
import type { MobileTab } from './types'
import { LogoutButton } from '../../site/LogoutButton'
import { SmartSearchButton } from '../DispatchSmartSearch'
import { OrganizationLogo } from '../../branding/OrganizationLogo'

type MobileDispatchHeaderProps = {
  activeTab: MobileTab
  selectedWeekStartDate: Date
  onCreateMission: () => void
  onOpenImports: () => void
  onTabChange: (tab: MobileTab) => void
  onWeekChange: (date: Date) => void
  displayName: string
  visibleTabs: MobileTab[]
  canCreateMission: boolean
  canViewImports: boolean
  canAutoPlan?: boolean
  onOpenAutoPlanning?: () => void
  onOpenSearch?: () => void
  onOpenAssistant?: () => void
}

type IconName =
  | 'mission'
  | 'driver'
  | 'truck'
  | 'trailer'
  | 'map'
  | 'profitability'
  | 'invoice'
  | 'park'

const tabs: Array<{ id: MobileTab; label: string; icon: IconName }> = [
  { id: 'missions', label: 'Missions', icon: 'mission' },
  { id: 'drivers', label: 'Chauffeurs', icon: 'driver' },
  { id: 'trucks', label: 'Camions', icon: 'truck' },
  { id: 'trailers', label: 'Remorques', icon: 'trailer' },
  { id: 'map', label: 'Carte', icon: 'map' },
  { id: 'profitability', label: 'Rentabilité', icon: 'profitability' },
  { id: 'invoices', label: 'Factures', icon: 'invoice' },
  { id: 'park', label: 'Parc', icon: 'park' },
]

export function MobileDispatchHeader({
  activeTab,
  selectedWeekStartDate,
  onCreateMission,
  onOpenImports,
  onTabChange,
  onWeekChange,
  displayName,
  visibleTabs,
  canCreateMission,
  canViewImports,
  canAutoPlan = false,
  onOpenAutoPlanning,
  onOpenSearch,
  onOpenAssistant,
}: MobileDispatchHeaderProps) {
  const currentWeekStartDate = getWeekStartDate()
  const isCurrentWeek =
    selectedWeekStartDate.getTime() === currentWeekStartDate.getTime()

  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-[#F4F5F1]/95 px-4 pb-3 pt-3 shadow-[0_10px_30px_rgba(17,18,15,0.05)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col items-start">
          <OrganizationLogo
            className="h-12 w-auto max-w-[190px] object-contain"
          />
          <p className="mt-1 max-w-[165px] truncate text-[11px] font-medium text-[#747a6f]">
            Bonjour, {displayName}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onOpenAssistant && activeTab !== 'park' ? (
            <button type="button" onClick={onOpenAssistant} aria-label="Assistant Gerard" title="Assistant Gerard" className="flex h-11 w-11 items-center justify-center rounded-full border-0 bg-[#eaffc8] text-sm font-black text-[#2d3d14] shadow-[0_10px_24px_rgba(120,170,40,0.16)] outline-none transition active:scale-95">G</button>
          ) : null}
          {onOpenSearch && activeTab !== 'park' ? (
            <SmartSearchButton
              onClick={onOpenSearch}
              className="flex h-11 w-11 items-center justify-center rounded-full border-0 bg-white text-[#11130f] shadow-[0_10px_24px_rgba(17,18,15,0.07)] outline-none ring-0 transition active:scale-95"
            />
          ) : null}
          {canAutoPlan && activeTab === 'missions' ? (
            <button
              type="button"
              onClick={onOpenAutoPlanning}
              className="flex h-11 w-11 items-center justify-center rounded-full border-0 bg-[var(--brand-accent)] text-[#11130f] shadow-[0_10px_24px_rgba(120,170,40,0.2)] outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-[#11130f]"
              style={{ border: 0 }}
              aria-label="Planification automatique"
              title="Planification automatique"
            >
              <span aria-hidden="true" className="text-base font-black">
                A
              </span>
            </button>
          ) : null}
          {canViewImports && activeTab !== 'park' ? <button
            type="button"
            onClick={onOpenImports}
            className="flex h-11 w-11 items-center justify-center rounded-full border-0 bg-white text-[15px] font-black text-[#11130f] shadow-[0_10px_24px_rgba(17,18,15,0.07)] outline-none ring-0 transition active:scale-95"
            style={{ border: 0 }}
            aria-label="Imports"
          >
            @
          </button> : null}

          {canCreateMission && activeTab !== 'park' ? <button
            type="button"
            onClick={onCreateMission}
            className="flex h-11 w-11 items-center justify-center rounded-full border-0 bg-[#11130f] text-2xl font-semibold leading-none text-white shadow-[0_14px_30px_rgba(17,18,15,0.18)] outline-none ring-0 transition active:scale-95"
            style={{ border: 0 }}
            aria-label="Créer une mission"
          >
            +
          </button> : null}

          <LogoutButton className="rounded-full active:scale-95" />
        </div>
      </div>

      {activeTab !== 'park' ? <div className="mt-5 rounded-[26px] bg-black/[0.035] px-3 py-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onWeekChange(addDays(selectedWeekStartDate, -7))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-white text-xl font-black text-[#303329] shadow-[0_8px_18px_rgba(17,18,15,0.06)] outline-none ring-0 transition active:scale-95"
            style={{ border: 0 }}
            aria-label="Semaine précédente"
          >
            ‹
          </button>

          <div className="min-w-0 text-center">
            <p className="truncate text-[13px] font-black tracking-[-0.03em] text-[#4f5549]">
              {formatWeekLabel(selectedWeekStartDate)}
            </p>

            <button
              type="button"
              disabled={isCurrentWeek}
              onClick={() => onWeekChange(currentWeekStartDate)}
              className="mt-2 rounded-md border border-black/10 px-4 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-[#6f7b57] transition active:scale-95 disabled:text-[#a5aa9e]"
            >
              Aujourd’hui
            </button>
          </div>

          <button
            type="button"
            onClick={() => onWeekChange(addDays(selectedWeekStartDate, 7))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-white text-xl font-black text-[#303329] shadow-[0_8px_18px_rgba(17,18,15,0.06)] outline-none ring-0 transition active:scale-95"
            style={{ border: 0 }}
            aria-label="Semaine suivante"
          >
            ›
          </button>
        </div>
      </div> : null}

      <nav className="[&::-webkit-scrollbar]:hidden mt-4 flex items-center justify-start gap-3 overflow-x-auto pb-1 [scrollbar-width:none]">
        {tabs.filter((tab) => visibleTabs.includes(tab.id)).map((tab) => {
          const isActive = activeTab === tab.id

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-label={tab.label}
              title={tab.label}
              className={[
                'flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-0 outline-none ring-0 transition duration-200 active:scale-95',
                isActive
                  ? 'bg-[var(--brand-accent)] text-[#11130f] shadow-[0_18px_34px_rgba(185,255,74,0.22)]'
                  : 'bg-white text-[#70766b] shadow-[0_10px_24px_rgba(17,18,15,0.07)]',
              ].join(' ')}
              style={{ border: 0 }}
            >
              <TabIcon name={tab.icon} />
            </button>
          )
        })}
      </nav>
    </header>
  )
}

function TabIcon({ name }: { name: IconName }) {
  switch (name) {
    case 'mission':
      return (
        <svg
          className="h-[22px] w-[22px]"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8 5h8M8 10h8M8 15h5"
            stroke="currentColor"
            strokeWidth="2.15"
            strokeLinecap="round"
          />
          <path
            d="M6 3.5h12A1.5 1.5 0 0 1 19.5 5v14A1.5 1.5 0 0 1 18 20.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z"
            stroke="currentColor"
            strokeWidth="1.95"
          />
        </svg>
      )

    case 'driver':
      return (
        <svg
          className="h-[22px] w-[22px]"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )

    case 'truck':
      return (
        <svg
          className="h-[23px] w-[23px]"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 7h11v9H3V7Z"
            stroke="currentColor"
            strokeWidth="1.95"
            strokeLinejoin="round"
          />
          <path
            d="M14 10h4l3 3v3h-7v-6Z"
            stroke="currentColor"
            strokeWidth="1.95"
            strokeLinejoin="round"
          />
          <path
            d="M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
            stroke="currentColor"
            strokeWidth="1.95"
          />
        </svg>
      )

    case 'trailer':
      return (
        <svg
          className="h-[23px] w-[23px]"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3.5 8h13v8h-13V8Z"
            stroke="currentColor"
            strokeWidth="1.95"
            strokeLinejoin="round"
          />
          <path
            d="M16.5 14H21"
            stroke="currentColor"
            strokeWidth="1.95"
            strokeLinecap="round"
          />
          <path
            d="M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM16 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
            stroke="currentColor"
            strokeWidth="1.95"
          />
        </svg>
      )

    case 'map':
      return (
        <svg
          className="h-[22px] w-[22px]"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      )

    case 'profitability':
      return (
        <svg
          className="h-[22px] w-[22px]"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 17.5 10 13l3 2.5 5-7"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M6 6.5h12M6 20h12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )

    case 'invoice':
      return (
        <svg
          className="h-[22px] w-[22px]"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M7 3.5h7l3.5 3.5v13.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z"
            stroke="currentColor"
            strokeWidth="1.95"
            strokeLinejoin="round"
          />
          <path
            d="M14 3.5V7h3.5M8.5 11h7M8.5 14.5h7M8.5 18h4"
            stroke="currentColor"
            strokeWidth="1.95"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )

    case 'park':
      return (
        <svg className="h-[23px] w-[23px]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 19V7l4-3h12v15H4Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
          <path d="M8 19v-5h8v5M8 9h8M11 6.5h5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      )

    default:
      return null
  }
}
