import { ReactNode, useEffect } from 'react'

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
const toneClasses: Record<Tone, string> = { positive: 'bg-[#eef8d6] text-[#3d5200]', warning: 'bg-amber-50 text-amber-800', danger: 'bg-red-50 text-red-700', neutral: 'bg-black/[.05] text-black/55' }
const dotClasses: Record<Tone, string> = { positive: 'bg-[#8eb800]', warning: 'bg-amber-500', danger: 'bg-red-500', neutral: 'bg-black/25' }

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneClasses[tone]}`}><span className={`h-1.5 w-1.5 rounded-full ${dotClasses[tone]}`} />{children}</span>
}

export function Avatar({ firstName, lastName, muted = false }: { firstName: string; lastName: string; muted?: boolean }) {
  return <span aria-hidden className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${muted ? 'bg-black/[.05] text-black/35' : 'bg-[#11130f] text-[#C8FF00]'}`}>{`${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase()}</span>
}

export const buttonClass = {
  primary: 'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#11130f] px-3.5 text-sm font-semibold text-white transition hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8FF00] focus-visible:ring-offset-2 disabled:opacity-40',
  accent: 'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#C8FF00] px-3.5 text-sm font-semibold text-black transition hover:bg-[#b8ef00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:ring-offset-2 disabled:opacity-40',
  secondary: 'inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-3.5 text-sm font-semibold text-[#171914] transition hover:border-black/20 hover:bg-[#f7f8f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8eb800] disabled:opacity-40',
  danger: 'inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-40',
  ghost: 'inline-flex h-8 items-center justify-center gap-1 rounded-md px-2 text-xs font-semibold text-black/55 transition hover:bg-black/[.05] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8eb800]',
}
export const inputClass = 'h-9 w-full rounded-lg border border-black/10 bg-white px-3 text-sm text-[#171914] outline-none transition placeholder:text-black/30 focus:border-[#8eb800] focus:ring-2 focus:ring-[#C8FF00]/40'

export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') onEscape() }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [onEscape])
}

// Right-side drawer on desktop, full-screen sheet on mobile.
export function Drawer({ title, eyebrow, close, children, footer }: { title: ReactNode; eyebrow?: ReactNode; close: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(close)
  return <div className="fixed inset-0 z-40 flex justify-end bg-black/30 animate-[fadeIn_.15s_ease-out]" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <aside role="dialog" aria-modal="true" className="flex h-full w-full flex-col bg-white shadow-2xl sm:max-w-[460px] animate-[slideIn_.2s_ease-out]">
      <header className="flex items-start justify-between gap-4 border-b border-black/[.06] px-5 py-4">
        <div className="min-w-0">{eyebrow && <div className="text-xs text-black/45">{eyebrow}</div>}<h2 className="truncate text-lg font-semibold">{title}</h2></div>
        <button onClick={close} aria-label="Fermer" className="-mr-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-black/45 hover:bg-black/[.05] hover:text-black">✕</button>
      </header>
      <div className="flex-1 overflow-y-auto">{children}</div>
      {footer && <footer className="border-t border-black/[.06] px-5 py-3">{footer}</footer>}
    </aside>
    <style>{'@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideIn{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}@media (prefers-reduced-motion:reduce){*{animation:none!important}}'}</style>
  </div>
}

export function Modal({ title, close, children, width = 'max-w-md' }: { title: string; close: () => void; children: ReactNode; width?: string }) {
  useEscape(close)
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section role="dialog" aria-modal="true" className={`max-h-[92vh] w-full ${width} overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6`}>
      <div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-base font-semibold">{title}</h2><button onClick={close} aria-label="Fermer" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-black/45 hover:bg-black/[.05]">✕</button></div>
      {children}
    </section>
  </div>
}
