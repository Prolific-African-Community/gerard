import {
  addDays,
  formatWeekLabel,
  getWeekStartDate,
} from '../../../lib/dispatch/date-utils'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { MobileTab } from './types'
import { LogoutButton } from '../../site/LogoutButton'
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
  /** Points d'attention détectés par Gerard Intelligence. */
  assistantBadge?: number | null
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

type ActionIconName = 'plus' | 'assistant' | 'search' | 'auto' | 'imports'

type QuickAction = {
  id: string
  label: string
  icon: ActionIconName
  tone: 'dark' | 'accent' | 'light'
  onClick: () => void
  badge?: number | null
}

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
  assistantBadge,
}: MobileDispatchHeaderProps) {
  const currentWeekStartDate = getWeekStartDate()
  const isCurrentWeek =
    selectedWeekStartDate.getTime() === currentWeekStartDate.getTime()

  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const closeMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false)
    if (restoreFocus) menuButtonRef.current?.focus()
  }, [])

  // Escape ferme le menu et rend le focus au bouton ; le focus entre dans le
  // panneau à l'ouverture pour une navigation clavier immédiate.
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu(true)
      }
    }
    // Clic extérieur (hors panneau et hors bouton) : ferme le menu.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return
      closeMenu()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    panelRef.current
      ?.querySelector<HTMLElement>('[data-menu-autofocus]')
      ?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [menuOpen, closeMenu])

  const runAndClose = (action: () => void) => () => {
    closeMenu()
    action()
  }

  const showResourceActions = activeTab !== 'park'
  const quickActions: QuickAction[] = []
  if (canCreateMission && showResourceActions) {
    quickActions.push({ id: 'create', label: 'Nouvelle mission', icon: 'plus', tone: 'dark', onClick: onCreateMission })
  }
  if (onOpenAssistant && showResourceActions) {
    quickActions.push({ id: 'assistant', label: 'Assistant', icon: 'assistant', tone: 'accent', onClick: onOpenAssistant, badge: assistantBadge })
  }
  if (onOpenSearch && showResourceActions) {
    quickActions.push({ id: 'search', label: 'Recherche', icon: 'search', tone: 'light', onClick: onOpenSearch })
  }
  if (canAutoPlan && activeTab === 'missions' && onOpenAutoPlanning) {
    quickActions.push({ id: 'auto', label: 'Planif. auto', icon: 'auto', tone: 'light', onClick: onOpenAutoPlanning })
  }
  if (canViewImports && showResourceActions) {
    quickActions.push({ id: 'imports', label: 'Imports', icon: 'imports', tone: 'light', onClick: onOpenImports })
  }

  const navTabs = tabs.filter((tab) => visibleTabs.includes(tab.id))
  const activeLabel = navTabs.find((tab) => tab.id === activeTab)?.label
  const showMenuBadge = Boolean(assistantBadge && onOpenAssistant && showResourceActions)

  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-[#F4F5F1]/95 pb-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] shadow-[0_10px_30px_rgba(17,18,15,0.05)] backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <OrganizationLogo className="h-10 w-auto max-w-[min(170px,50vw)] shrink-0 object-contain object-left" />
          {activeLabel ? (
            <span className="hidden min-w-0 truncate border-l border-black/10 pl-3 text-[12px] font-semibold tracking-[-0.01em] text-[#747a6f] min-[360px]:block">
              {activeLabel}
            </span>
          ) : null}
        </div>

        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={
            menuOpen
              ? 'Fermer le menu'
              : showMenuBadge && assistantBadge
                ? `Ouvrir le menu — ${assistantBadge} point${assistantBadge > 1 ? 's' : ''} à vérifier`
                : 'Ouvrir le menu'
          }
          className={[
            'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full outline-none transition-[background-color,color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] active:scale-[0.94] focus-visible:ring-2 focus-visible:ring-[#11130f]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F4F5F1] motion-reduce:transition-none',
            menuOpen
              ? 'bg-[#11130f] text-white shadow-[0_10px_24px_rgba(17,18,15,0.18)]'
              : 'bg-white text-[#11130f] shadow-[0_8px_20px_rgba(17,18,15,0.07)] hover:shadow-[0_10px_24px_rgba(17,18,15,0.12)]',
          ].join(' ')}
          style={{ border: 0 }}
        >
          <span aria-hidden="true" className="relative block h-3 w-[18px]">
            {[
              menuOpen ? 'top-[5.25px] rotate-45' : 'top-0',
              menuOpen ? 'top-[5.25px] scale-x-0 opacity-0' : 'top-[5.25px]',
              menuOpen ? 'top-[5.25px] -rotate-45' : 'top-[10.5px]',
            ].map((position, index) => (
              <span
                key={index}
                className={`absolute left-0 block h-[1.5px] w-full rounded-full bg-current transition-[top,transform,opacity] duration-[260ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${position}`}
              />
            ))}
          </span>
          {/* Même pastille orange que sur le poste fixe : signale les points
              d'attention de l'assistant tant que le menu est fermé. */}
          {assistantBadge ? (
            showMenuBadge && !menuOpen ? (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 h-[11px] w-[11px] rounded-full bg-[#e8760d] ring-[2.5px] ring-[#f4f5f1]"
              />
            ) : null
          ) : null}
        </button>
      </div>

      <div
        ref={panelRef}
        id={menuId}
        role="dialog"
        aria-label="Menu"
        aria-hidden={!menuOpen}
        className={[
          'absolute left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] top-[calc(100%-6px)] z-40 max-h-[calc(100dvh-84px)] overflow-y-auto overscroll-contain rounded-[28px] bg-white p-2 shadow-[0_24px_60px_rgba(17,18,15,0.16),0_2px_6px_rgba(17,18,15,0.05)] ring-1 ring-black/[0.04]',
          'transition-[opacity,transform,visibility] duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none',
          menuOpen ? 'visible translate-y-0 opacity-100' : 'invisible -translate-y-1.5 opacity-0',
        ].join(' ')}
      >
        {quickActions.length > 0 ? (
          <div className="grid grid-cols-2 gap-1.5 p-1">
            {quickActions.map((action, index) => (
              <button
                key={action.id}
                type="button"
                data-menu-autofocus={index === 0 ? '' : undefined}
                onClick={runAndClose(action.onClick)}
                aria-label={
                  action.badge
                    ? `Assistant Gerard — ${action.badge} point${action.badge > 1 ? 's' : ''} à vérifier`
                    : action.label
                }
                className={[
                  'flex min-h-[48px] items-center gap-2.5 rounded-[18px] px-3.5 text-left text-[13px] font-semibold tracking-[-0.01em] outline-none transition-[background-color,transform] duration-150 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[#11130f]/30 motion-reduce:transition-none',
                  action.tone === 'dark'
                    ? 'col-span-2 bg-[#11130f] text-white hover:bg-[#25281f]'
                    : action.tone === 'accent'
                      ? 'bg-[#eaffc8] text-[#2d3d14] hover:bg-[#e0fbb4]'
                      : 'bg-[#F4F5F1] text-[#11130f] hover:bg-[#ecede7]',
                ].join(' ')}
                style={{ border: 0 }}
              >
                <ActionIcon name={action.icon} />
                <span className="min-w-0 truncate">{action.label}</span>
                {action.badge ? (
                  <span
                    aria-hidden
                    className="ml-auto flex h-[20px] min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#e8760d] px-[5px] text-[11px] font-semibold leading-none text-white"
                  >
                    {action.badge > 99 ? '99+' : action.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        <nav aria-label="Sections" className="px-1 pb-1 pt-2">
          <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#a0a69a]">
            Navigation
          </p>
          <ul className="grid grid-cols-1 gap-0.5 min-[360px]:grid-cols-2">
            {navTabs.map((tab, index) => {
              const isActive = activeTab === tab.id
              return (
                <li key={tab.id}>
                  <button
                    type="button"
                    data-menu-autofocus={quickActions.length === 0 && index === 0 ? '' : undefined}
                    onClick={runAndClose(() => onTabChange(tab.id))}
                    aria-current={isActive ? 'page' : undefined}
                    className={[
                      'flex min-h-[46px] w-full items-center gap-3 rounded-[16px] px-2 text-left text-[14px] tracking-[-0.01em] outline-none transition-[background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-[#11130f]/30 motion-reduce:transition-none',
                      isActive
                        ? 'bg-[#eaffc8] font-semibold text-[#11130f]'
                        : 'font-medium text-[#4f5549] hover:bg-[#F4F5F1] active:bg-[#ecede7]',
                    ].join(' ')}
                    style={{ border: 0 }}
                  >
                    <span
                      className={[
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] [&_svg]:h-[18px] [&_svg]:w-[18px]',
                        isActive ? 'bg-[var(--brand-accent)] text-[#11130f]' : 'bg-[#F4F5F1] text-[#70766b]',
                      ].join(' ')}
                    >
                      <TabIcon name={tab.icon} />
                    </span>
                    <span className="truncate">{tab.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="mx-1 mt-1 flex items-center justify-between gap-3 border-t border-black/[0.05] pb-0.5 pl-3 pr-0.5 pt-2">
          <p className="min-w-0 truncate text-[12px] font-medium text-[#747a6f]">
            Bonjour, <span className="font-semibold text-[#11130f]">{displayName}</span>
          </p>
          <LogoutButton className="rounded-full" />
        </div>
      </div>

      {activeTab !== 'park' ? <div className="mt-2 rounded-[26px] bg-black/[0.035] px-3 py-4">
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

function ActionIcon({ name }: { name: ActionIconName }) {
  const props = {
    className: 'h-[18px] w-[18px] shrink-0',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'plus':
      return <svg {...props}><path d="M12 5v14M5 12h14" /></svg>
    case 'assistant':
      return (
        <span aria-hidden="true" className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[14px] font-black leading-none">
          G
        </span>
      )
    case 'search':
      return <svg {...props}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
    case 'auto':
      return <svg {...props}><path d="M12 3.5 13.8 9l5.7.1-4.6 3.4 1.7 5.5L12 14.7 7.4 18l1.7-5.5L4.5 9.1 10.2 9 12 3.5Z" /></svg>
    case 'imports':
      return <svg {...props}><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="M4 7.5 12 13l8-5.5" /></svg>
    default:
      return null
  }
}
