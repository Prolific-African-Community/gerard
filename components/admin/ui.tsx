import { ReactNode, useEffect, useRef } from 'react'

// Shared primitives for the platform (/admin) and organization (/admin/organization) consoles.

export const roleLabels: Record<string, string> = { ORG_ADMIN: 'Administrateur', MANAGER: 'Manager', DISPATCHER: 'Dispatcher', SECRETARY: 'Secrétariat', ACCOUNTING: 'Comptabilité', DRIVER: 'Chauffeur', VIEWER: 'Lecture seule' }
export const roleDescriptions: Record<string, string> = { ORG_ADMIN: 'Gère les membres, les accès et l’organisation', MANAGER: 'Pilotage opérationnel complet', DISPATCHER: 'Planification et dispatch', SECRETARY: 'Flux administratifs', ACCOUNTING: 'Facturation et finances', DRIVER: 'Espace chauffeur uniquement', VIEWER: 'Consultation sans modification' }

const auditLabels: Record<string, string> = {
  ORGANIZATION_CREATED: 'Organisation créée', ORGANIZATION_UPDATED: 'Informations modifiées', ORGANIZATION_STATUS_CHANGED: 'Statut modifié',
  MEMBER_ADDED: 'Membre ajouté', MEMBER_REMOVED: 'Membre retiré', MEMBER_ROLE_CHANGED: 'Rôle modifié', MEMBER_STATUS_CHANGED: 'Accès modifié',
  PASSWORD_RESET: 'Mot de passe réinitialisé', SESSION_INVALIDATED: 'Sessions déconnectées', MODULES_CHANGED: 'Modules modifiés', BRANDING_CHANGED: 'Apparence modifiée',
  DOMAIN_CREATED: 'Domaine ajouté', DOMAIN_UPDATED: 'Domaine modifié', DOMAIN_DELETED: 'Domaine supprimé', BILLING_CONFIG_CHANGED: 'Configuration métier modifiée', INTEGRATION_CHANGED: 'Intégration modifiée',
}
export const auditLabel = (action: string) => auditLabels[action] || action.replaceAll('_', ' ').toLowerCase()

export function formatDate(value: string | null, fallback = 'Jamais') {
  return value ? new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : fallback
}

export function formatRelative(value: string | null, fallback = 'Jamais') {
  if (!value) return fallback
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000)
  if (minutes < 1) return 'À l’instant'
  if (minutes < 60) return `Il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Il y a ${hours} h`
  const days = Math.round(hours / 24)
  if (days < 7) return `Il y a ${days} j`
  return new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium' }).format(new Date(value))
}

export type Tone = 'positive' | 'warning' | 'danger' | 'neutral'
const toneClasses: Record<Tone, string> = { positive: 'bg-[#eef8d6] text-[#3d5200]', warning: 'bg-amber-50 text-amber-800', danger: 'bg-red-50 text-red-700', neutral: 'bg-black/[.05] text-black/60' }
const dotClasses: Record<Tone, string> = { positive: 'bg-[#8eb800]', warning: 'bg-amber-500', danger: 'bg-red-500', neutral: 'bg-black/25' }

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneClasses[tone]}`}><span className={`h-1.5 w-1.5 rounded-full ${dotClasses[tone]}`} />{children}</span>
}

export function Avatar({ firstName, lastName, muted = false }: { firstName: string; lastName: string; muted?: boolean }) {
  return <span aria-hidden className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${muted ? 'bg-black/[.05] text-black/40' : 'bg-[#11130f] text-[#C8FF00]'}`}>{`${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase()}</span>
}

export const buttonClass = {
  primary: 'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#11130f] px-3.5 text-sm font-semibold text-white transition hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8FF00] focus-visible:ring-offset-2 disabled:opacity-40',
  accent: 'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#C8FF00] px-3.5 text-sm font-semibold text-black transition hover:bg-[#b8ef00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:ring-offset-2 disabled:opacity-40',
  secondary: 'inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-3.5 text-sm font-semibold text-[#171914] transition hover:border-black/20 hover:bg-[#f7f8f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8eb800] disabled:opacity-40',
  danger: 'inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-40',
  ghost: 'inline-flex h-8 items-center justify-center gap-1 rounded-md px-2 text-xs font-semibold text-black/60 transition hover:bg-black/[.05] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8eb800]',
}
export const inputClass = 'h-9 w-full rounded-lg border border-black/10 bg-white px-3 text-sm text-[#171914] outline-none transition placeholder:text-black/30 focus:border-[#8eb800] focus:ring-2 focus:ring-[#C8FF00]/40'

export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') onEscape() }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [onEscape])
}

// Keeps keyboard focus inside an open dialog and returns it to the trigger on close.
function useDialogFocus(onEscape: () => void) {
  const ref = useRef<HTMLElement>(null)
  useEscape(onEscape)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const panel = ref.current
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') || [])
    if (panel && !panel.contains(document.activeElement)) (panel.querySelector<HTMLElement>('[autofocus]') || focusable()[1] || focusable()[0] || panel).focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    panel?.addEventListener('keydown', trap)
    return () => { panel?.removeEventListener('keydown', trap); previous?.focus?.() }
  }, [])
  return ref
}

// Right-side drawer on desktop, full-screen sheet on mobile.
export function Drawer({ title, eyebrow, close, children, footer }: { title: ReactNode; eyebrow?: ReactNode; close: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useDialogFocus(close)
  return <div className="gerard-admin fixed inset-0 z-40 flex justify-end bg-black/30 animate-[fadeIn_.15s_ease-out]" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className="flex h-full w-full flex-col outline-none bg-white shadow-2xl sm:max-w-[460px] animate-[slideIn_.2s_ease-out]">
      <header className="flex items-start justify-between gap-4 border-b border-black/[.06] px-5 py-4">
        <div className="min-w-0">{eyebrow && <div className="text-xs text-black/50">{eyebrow}</div>}<h2 className="truncate text-lg font-semibold">{title}</h2></div>
        <button onClick={close} aria-label="Fermer" className="-mr-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-black/50 hover:bg-black/[.05] hover:text-black">✕</button>
      </header>
      <div className="flex-1 overflow-y-auto">{children}</div>
      {footer && <footer className="border-t border-black/[.06] px-5 py-3">{footer}</footer>}
    </aside>
    <style>{'@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideIn{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}@media (prefers-reduced-motion:reduce){*{animation:none!important}}'}</style>
  </div>
}

export function Modal({ title, close, children, width = 'max-w-md' }: { title: string; close: () => void; children: ReactNode; width?: string }) {
  const ref = useDialogFocus(close)
  return <div className="gerard-admin fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`outline-none max-h-[92vh] w-full ${width} overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6`}>
      <div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-base font-semibold">{title}</h2><button onClick={close} aria-label="Fermer" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-black/50 hover:bg-black/[.05]">✕</button></div>
      {children}
    </section>
  </div>
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export type ShellTab = { id: string; label: string; count?: number }

// Slim black identity bar with the primary navigation on a light bar underneath.
export function AdminShell({ mark, title, context, badge, actions, tabs, active, onTab, leading, children }: { mark: ReactNode; title: string; context: string; badge?: ReactNode; actions?: ReactNode; tabs?: readonly ShellTab[]; active?: string; onTab?: (id: string) => void; leading?: ReactNode; children: ReactNode }) {
  return <main className="gerard-admin min-h-screen bg-[#f4f5f1] text-[#171914]">
    <header className="sticky top-0 z-30">
      <div className="bg-[#11130f] text-white">
        <div className="mx-auto flex h-12 max-w-[1200px] items-center gap-3 px-4 lg:px-8">
          {mark}
          <div className="flex min-w-0 items-baseline gap-2"><p className="truncate text-sm font-semibold">{title}</p><p className="hidden truncate text-xs text-white/70 sm:block">{context}</p></div>
          {badge}
          <div className="ml-auto flex items-center gap-1">{actions}</div>
        </div>
      </div>
      {(tabs?.length || leading) && <div className="border-b border-black/[.08] bg-white">
        <div className="mx-auto flex max-w-[1200px] items-stretch gap-3 px-4 lg:px-8">
          {leading}
          {tabs && <nav aria-label="Sections" className="-mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">{tabs.map((tab) => <button key={tab.id} onClick={() => onTab?.(tab.id)} aria-current={active === tab.id ? 'page' : undefined} className={`relative shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8eb800] ${active === tab.id ? 'border-[#11130f] text-[#11130f]' : 'border-transparent text-black/60 hover:border-black/20 hover:text-black'}`}>{tab.label}{tab.count !== undefined && <span className={`ml-1.5 rounded-full px-1.5 text-[11px] tabular-nums ${active === tab.id ? 'bg-[#C8FF00] text-black' : 'bg-black/[.06] text-black/60'}`}>{tab.count}</span>}</button>)}</nav>}
        </div>
      </div>}
    </header>
    <div className="mx-auto max-w-[1200px] px-4 py-6 lg:px-8 lg:py-8">{children}</div>
  </main>
}

export const headerLinkClass = 'inline-flex h-8 items-center rounded-md px-2.5 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8FF00]'

export function SectionHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div className="min-w-0"><h1 className="text-xl font-semibold tracking-tight">{title}</h1>{description && <p className="mt-0.5 text-sm text-black/60">{description}</p>}</div>{action}</div>
}

export function Surface({ title, description, action, children, footer, className = '' }: { title?: string; description?: ReactNode; action?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-black/[.08] bg-white ${className}`}>
    {title && <div className="flex items-start justify-between gap-3 border-b border-black/[.06] px-4 py-3"><div className="min-w-0"><h2 className="text-sm font-semibold">{title}</h2>{description && <p className="mt-0.5 text-xs text-black/60">{description}</p>}</div>{action}</div>}
    {children}
    {footer}
  </section>
}

export function TextField({ label, value, set, placeholder, hint, required = false, type = 'text', disabled = false, mono = false, autoFocus = false }: { label: string; value: string; set: (value: string) => void; placeholder?: string; hint?: ReactNode; required?: boolean; type?: string; disabled?: boolean; mono?: boolean; autoFocus?: boolean }) {
  return <label className="block"><span className="text-xs font-medium text-black/70">{label}</span><input type={type} required={required} disabled={disabled} autoFocus={autoFocus} value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} className={`${inputClass} mt-1 disabled:cursor-not-allowed disabled:bg-black/[.03] disabled:text-black/50 ${mono ? 'font-mono' : ''}`} />{hint && <span className="mt-1 block text-xs text-black/50">{hint}</span>}</label>
}

export function Switch({ checked, onChange, disabled = false, label }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8eb800] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-[#11130f]' : 'bg-black/20'}`}><span className={`inline-block h-4 w-4 rounded-full transition ${checked ? 'translate-x-5 bg-[#C8FF00]' : 'translate-x-1 bg-white'}`} /></button>
}

// Save bar shared by every explicit-save form: unsaved state, disabled when clean, saving state.
export function SaveBar({ dirty, busy, onReset, disabled = false, label = 'Enregistrer' }: { dirty: boolean; busy: boolean; onReset: () => void; disabled?: boolean; label?: string }) {
  return <div className={`flex flex-wrap items-center justify-end gap-2 border-t border-black/[.06] px-4 py-3 ${dirty ? 'bg-[#fafbf6]' : ''}`}>
    {dirty && <span className="mr-auto inline-flex items-center gap-1.5 text-xs font-medium text-amber-800"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Modifications non enregistrées</span>}
    <button type="button" disabled={!dirty || busy} onClick={onReset} className={buttonClass.secondary}>Annuler</button>
    <button type="submit" disabled={!dirty || busy || disabled} className={buttonClass.primary}>{busy ? 'Enregistrement…' : label}</button>
  </div>
}

export function Notice({ tone, children }: { tone: 'error' | 'info' | 'warning'; children: ReactNode }) {
  const style = tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-black/[.08] bg-[#f7f8f4] text-black/70'
  return <p role={tone === 'error' ? 'alert' : undefined} className={`rounded-lg border px-3 py-2 text-sm ${style}`}>{children}</p>
}

export function Toast({ text }: { text: string }) {
  return <div role="status" className="gerard-admin fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-[#11130f] px-4 py-2.5 text-sm font-medium text-white shadow-lg sm:left-auto sm:right-6 sm:translate-x-0"><span className="mr-2 text-[#C8FF00]">✓</span>{text}</div>
}
