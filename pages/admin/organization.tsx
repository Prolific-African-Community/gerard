import type { GetServerSideProps } from 'next'
import Head from 'next/head'
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { Avatar, Badge, Drawer, Modal, auditLabel, buttonClass, formatDate, formatRelative, inputClass, roleDescriptions, roleLabels } from '../../components/admin/ui'
import { LogoutButton } from '../../components/site/LogoutButton'
import { getCurrentUser } from '../../lib/auth/authorization'

const roles = ['ORG_ADMIN', 'MANAGER', 'DISPATCHER', 'SECRETARY', 'ACCOUNTING', 'DRIVER', 'VIEWER'] as const
const sections = [{ id: 'overview', label: 'Aperçu' }, { id: 'team', label: 'Équipe' }] as const
type Section = (typeof sections)[number]['id']
const moduleLabels: Record<string, string> = {}
const integrationCatalog: readonly { type: string; name: string; purpose: string }[] = []
const INACTIVE_DAYS = 30

type Member = { id: string; role: string; createdAt: string; user: { id: string; firstName: string; lastName: string; username: string; email: string | null; isActive: boolean; mustChangePassword: boolean; lastLoginAt: string | null; createdAt: string; sessionVersion: number } }
type Integration = { id: string; type: string; enabled: boolean; configJson: Record<string, unknown>; updatedAt: string }
type Activity = { id: string; action: string; metadata: Record<string, unknown> | null; createdAt: string; actor: { firstName: string; lastName: string; username: string } }
type Organization = { id: string; name: string; status: string; displayName: string | null; logoUrl: string | null; applicationTitle: string | null; accentColor: string | null; faviconUrl: string | null; enabledModules: string[]; integrations: Integration[]; users: Member[]; platformAuditLogs: Activity[] }
type Request = (url: string, init: RequestInit) => Promise<Record<string, unknown>>
type Confirmation = { title: string; body: ReactNode; confirm: string; destructive?: boolean; run: () => Promise<void> }
type Attention = { member: Member; reason: string; tone: 'warning' | 'neutral' }

const fullName = (member: Member) => `${member.user.firstName} ${member.user.lastName}`.trim() || member.user.username
const daysSince = (value: string) => (Date.now() - new Date(value).getTime()) / 86400000
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback

export default function OrganizationAdminPage({ accessDenied = false, platformAdmin = false, currentUserId = '' }: { accessDenied?: boolean; platformAdmin?: boolean; currentUserId?: string }) {
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loadError, setLoadError] = useState('')
  const [section, setSection] = useState<Section>('overview')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [credential, setCredential] = useState<{ name: string; username: string; password: string } | null>(null)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/organization')
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Chargement impossible')
    setOrganization(body.organization)
  }, [])
  useEffect(() => { if (!accessDenied) void load().catch((cause) => setLoadError(message(cause, 'Chargement impossible'))) }, [accessDenied, load])

  // The active section lives in the URL hash so reloads and shared links land in the same place.
  useEffect(() => { const hash = window.location.hash.slice(1); if (sections.some((item) => item.id === hash)) setSection(hash as Section) }, [])
  const navigate = (next: Section) => { setSection(next); window.history.replaceState(null, '', `#${next}`) }
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer) }, [toast])

  const request: Request = useCallback(async (url, init) => {
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || 'Opération impossible')
    await load()
    return body
  }, [load])

  const members = useMemo(() => organization?.users || [], [organization])
  const selected = members.find((member) => member.id === selectedId) || null
  const stats = useMemo(() => {
    const active = members.filter((member) => member.user.isActive)
    return { total: members.length, active: active.length, admins: active.filter((member) => member.role === 'ORG_ADMIN').length }
  }, [members])
  const attention = useMemo<Attention[]>(() => members.filter((member) => member.user.isActive).flatMap((member): Attention[] => {
    if (member.user.mustChangePassword) return [{ member, reason: 'Mot de passe temporaire non changé', tone: 'warning' }]
    if (!member.user.lastLoginAt) return [{ member, reason: 'Jamais connecté', tone: 'neutral' }]
    if (daysSince(member.user.lastLoginAt) > INACTIVE_DAYS) return [{ member, reason: `Inactif depuis ${formatRelative(member.user.lastLoginAt).replace('Il y a ', '')}`, tone: 'neutral' }]
    return []
  }), [members])

  if (accessDenied) return <main className="flex min-h-screen items-center justify-center bg-[#f4f5f1] p-6"><section className="w-full max-w-sm rounded-2xl border border-black/[.06] bg-white p-6 text-center"><h1 className="text-lg font-semibold">Accès réservé</h1><p className="mt-2 text-sm text-black/55">Cette zone est réservée aux administrateurs de l’organisation.</p><a className={`${buttonClass.primary} mt-5`} href="/dispatch">Retour au dispatch</a></section></main>
  if (!organization) return <main className="min-h-screen bg-[#f4f5f1]"><div className="h-14 bg-[#11130f]" /><div className="mx-auto max-w-[1200px] space-y-3 px-4 py-8 lg:px-8">{loadError ? <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{loadError}</p> : <><div className="h-8 w-64 animate-pulse rounded bg-black/[.06]" /><div className="h-24 animate-pulse rounded-xl bg-black/[.04]" /><div className="h-64 animate-pulse rounded-xl bg-black/[.04]" /></>}</div></main>

  const orgName = organization.displayName || organization.name
  const openMember = (member: Member) => setSelectedId(member.id)
  const confirmThen = (value: Confirmation) => setConfirmation(value)

  return <main className="min-h-screen bg-[#f4f5f1] text-[#171914]">
    <Head><title>{`Administration · ${orgName}`}</title></Head>
    <header className="sticky top-0 z-30 bg-[#11130f] text-white">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 lg:px-8">
        {organization.logoUrl ? <img src={organization.logoUrl} alt="" className="h-7 w-7 rounded-md bg-white object-contain p-0.5" /> : <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#C8FF00] text-xs font-black text-black">{orgName[0]?.toUpperCase()}</span>}
        <div className="min-w-0 leading-tight"><p className="truncate text-sm font-semibold">{orgName}</p><p className="text-[11px] text-white/45">Administration</p></div>
        {organization.status !== 'ACTIVE' && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">{organization.status === 'SUSPENDED' ? 'Suspendue' : 'Archivée'}</span>}
        <nav className="ml-6 hidden h-full items-stretch gap-1 md:flex">{sections.map((item) => <NavItem key={item.id} active={section === item.id} onClick={() => navigate(item.id)}>{item.label}</NavItem>)}</nav>
        <div className="ml-auto flex items-center gap-2">
          {platformAdmin && <a href="/admin" className="hidden rounded-md px-2.5 py-1.5 text-xs font-semibold text-white/60 hover:bg-white/10 hover:text-white sm:inline-flex">Plateforme</a>}
          <a href="/dispatch" className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-white/60 hover:bg-white/10 hover:text-white">Dispatch</a>
          <LogoutButton tone="dark" className="!h-8 !w-8 !rounded-md !shadow-none hover:!translate-y-0" />
        </div>
      </div>
      <nav className="flex border-t border-white/[.06] px-2 md:hidden">{sections.map((item) => <NavItem key={item.id} active={section === item.id} onClick={() => navigate(item.id)} mobile>{item.label}</NavItem>)}</nav>
    </header>

    <div className="mx-auto max-w-[1200px] px-4 py-6 lg:px-8 lg:py-8">
      {section === 'overview' && <Overview organization={organization} stats={stats} attention={attention} openMember={openMember} addMember={() => setAddOpen(true)} openActivity={() => setActivityOpen(true)} navigate={navigate} />}
      {section === 'team' && <Team members={members} currentUserId={currentUserId} openMember={openMember} addMember={() => setAddOpen(true)} />}
    </div>

    {selected && <MemberDrawer member={selected} isSelf={selected.user.id === currentUserId} activeAdmins={stats.admins} activity={organization.platformAuditLogs.filter((item) => item.metadata?.userId === selected.user.id)} close={() => setSelectedId(null)} request={request} confirm={confirmThen} notify={setToast} reveal={setCredential} />}
    {addOpen && <AddMemberModal close={() => setAddOpen(false)} request={request} reveal={setCredential} />}
    {activityOpen && <ActivityDrawer items={organization.platformAuditLogs} members={members} close={() => setActivityOpen(false)} />}
    {confirmation && <ConfirmModal value={confirmation} close={() => setConfirmation(null)} />}
    {credential && <CredentialModal value={credential} close={() => setCredential(null)} />}
    {toast && <div role="status" className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-[#11130f] px-4 py-2.5 text-sm font-medium text-white shadow-lg sm:left-auto sm:right-6 sm:translate-x-0"><span className="mr-2 text-[#C8FF00]">✓</span>{toast}</div>}
  </main>
}

function NavItem({ active, onClick, children, mobile = false }: { active: boolean; onClick: () => void; children: ReactNode; mobile?: boolean }) {
  return <button onClick={onClick} aria-current={active ? 'page' : undefined} className={`relative flex items-center px-3 text-sm font-medium transition ${mobile ? 'flex-1 justify-center py-2.5' : ''} ${active ? 'text-white' : 'text-white/50 hover:text-white'}`}>{children}<span className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full transition ${active ? 'bg-[#C8FF00]' : 'bg-transparent'}`} /></button>
}

function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-semibold tracking-tight">{title}</h1>{description && <p className="mt-0.5 text-sm text-black/50">{description}</p>}</div>{action}</div>
}

function Surface({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-black/[.07] bg-white ${className}`}>{title && <div className="flex items-center justify-between gap-3 border-b border-black/[.06] px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2>{action}</div>}{children}</section>
}

// ─── Overview ────────────────────────────────────────────────────────────────

function Overview({ organization, stats, attention, openMember, addMember, openActivity, navigate }: { organization: Organization; stats: { total: number; active: number; admins: number }; attention: Attention[]; openMember: (member: Member) => void; addMember: () => void; openActivity: () => void; navigate: (section: Section) => void }) {
  const summary = [
    { label: 'Membres actifs', value: stats.active, hint: stats.total - stats.active ? `${stats.total - stats.active} désactivé${stats.total - stats.active > 1 ? 's' : ''}` : `sur ${stats.total}` },
    { label: 'Administrateurs', value: stats.admins, hint: stats.admins < 2 ? 'Recommandé : 2 minimum' : 'actifs', warn: stats.admins < 2 },
    { label: 'À vérifier', value: attention.length, hint: attention.length ? 'accès à revoir' : 'rien à signaler', warn: attention.length > 0 },
    { label: 'Accès désactivés', value: stats.total - stats.active, hint: 'historique conservé' },
  ]
  return <>
    <SectionHeader title={organization.displayName || organization.name} description="Accès, sécurité et identité de votre espace Gerard." action={<button onClick={addMember} className={buttonClass.accent}>＋ Ajouter un membre</button>} />
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-black/[.07] bg-white lg:grid-cols-4">
      {summary.map((item, index) => <div key={item.label} className={`px-4 py-4 ${index % 2 ? 'border-l' : ''} ${index > 1 ? 'border-t lg:border-t-0' : ''} ${index === 2 ? 'lg:border-l' : ''} border-black/[.06]`}><p className="text-xs text-black/50">{item.label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{item.value}</p><p className={`mt-0.5 text-xs ${item.warn ? 'text-amber-700' : 'text-black/40'}`}>{item.hint}</p></div>)}
    </div>

    <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <Surface title="À vérifier" action={<button onClick={() => navigate('team')} className={buttonClass.ghost}>Équipe →</button>}>
        {stats.admins < 2 && <div className="flex items-start gap-3 border-b border-black/[.06] bg-amber-50/60 px-4 py-3 text-sm"><span className="mt-0.5 text-amber-600">▲</span><div><p className="font-medium">Un seul administrateur actif</p><p className="text-xs text-black/55">Nommez un second administrateur pour ne jamais perdre l’accès à l’organisation.</p></div></div>}
        {attention.length ? <ul className="divide-y divide-black/[.05]">{attention.slice(0, 6).map(({ member, reason, tone }) => <li key={member.id}><button onClick={() => openMember(member)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-[#f7f8f4]"><Avatar firstName={member.user.firstName} lastName={member.user.lastName} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{fullName(member)}</span><span className="block text-xs text-black/45">{roleLabels[member.role]}</span></span><Badge tone={tone}>{reason}</Badge></button></li>)}</ul>
          : <p className="px-4 py-8 text-center text-sm text-black/45">Tous les accès actifs sont à jour.</p>}
        {attention.length > 6 && <p className="border-t border-black/[.06] px-4 py-2 text-xs text-black/45">+ {attention.length - 6} autre{attention.length - 6 > 1 ? 's' : ''} dans l’équipe</p>}
      </Surface>

      <div className="space-y-5">
        <Surface title="Activité récente" action={organization.platformAuditLogs.length > 0 && <button onClick={openActivity} className={buttonClass.ghost}>Tout voir →</button>}>
          <ActivityRows items={organization.platformAuditLogs.slice(0, 5)} members={organization.users} compact />
        </Surface>
        <Surface title="Responsabilité"><p className="px-4 py-4 text-sm leading-6 text-black/55">Vous gérez ici les membres et leurs accès. La configuration du produit, des modules, des intégrations et de l’apparence relève de l’administration Gerard.</p></Surface>
      </div>
    </div>
  </>
}

// ─── Team ────────────────────────────────────────────────────────────────────

function Team({ members, currentUserId, openMember, addMember }: { members: Member[]; currentUserId: string; openMember: (member: Member) => void; addMember: () => void }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'DISABLED'>('ACTIVE')
  const [role, setRole] = useState('ALL')
  const [sort, setSort] = useState<'name' | 'login'>('name')
  const counts = { ALL: members.length, ACTIVE: members.filter((m) => m.user.isActive).length, DISABLED: members.filter((m) => !m.user.isActive).length }
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return members
      .filter(({ role: memberRole, user }) => (!query || `${user.firstName} ${user.lastName} ${user.username} ${user.email || ''}`.toLowerCase().includes(query)) && (role === 'ALL' || memberRole === role) && (status === 'ALL' || (status === 'ACTIVE') === user.isActive))
      .sort((a, b) => sort === 'login' ? (b.user.lastLoginAt || '').localeCompare(a.user.lastLoginAt || '') : `${a.user.lastName} ${a.user.firstName}`.localeCompare(`${b.user.lastName} ${b.user.firstName}`))
  }, [members, search, role, status, sort])

  return <>
    <SectionHeader title="Équipe" description={`${counts.ACTIVE} membre${counts.ACTIVE > 1 ? 's' : ''} actif${counts.ACTIVE > 1 ? 's' : ''} · rôles, accès et sécurité`} action={<button onClick={addMember} className={buttonClass.accent}>＋ Ajouter un membre</button>} />
    <Surface>
      <div className="flex flex-col gap-2 border-b border-black/[.06] p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/30">⌕</span><input className={`${inputClass} pl-8`} placeholder="Rechercher par nom, identifiant ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="flex gap-2">
          <div className="inline-flex rounded-lg bg-black/[.04] p-0.5">{(['ACTIVE', 'DISABLED', 'ALL'] as const).map((value) => <button key={value} onClick={() => setStatus(value)} className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${status === value ? 'bg-white shadow-sm' : 'text-black/50 hover:text-black'}`}>{{ ACTIVE: 'Actifs', DISABLED: 'Désactivés', ALL: 'Tous' }[value]} <span className="tabular-nums text-black/35">{counts[value]}</span></button>)}</div>
          <select aria-label="Filtrer par rôle" className={`${inputClass} w-auto`} value={role} onChange={(e) => setRole(e.target.value)}><option value="ALL">Tous les rôles</option>{roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}</select>
        </div>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-black/45"><tr className="border-b border-black/[.06]">
          <th className="px-4 py-2 font-medium">Membre</th>
          <th className="hidden px-4 py-2 font-medium md:table-cell">Rôle</th>
          <th className="hidden px-4 py-2 font-medium lg:table-cell">Statut</th>
          <th className="hidden px-4 py-2 font-medium sm:table-cell"><button onClick={() => setSort(sort === 'login' ? 'name' : 'login')} className="inline-flex items-center gap-1 hover:text-black">Dernière connexion {sort === 'login' ? '↓' : <span className="text-black/25">↕</span>}</button></th>
          <th className="w-8" />
        </tr></thead>
        <tbody className="divide-y divide-black/[.05]">
          {visible.map((member) => <tr key={member.id} onClick={() => openMember(member)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openMember(member)} className="group cursor-pointer transition hover:bg-[#f7f8f4] focus:bg-[#f7f8f4] focus:outline-none">
            <td className="px-4 py-2.5"><div className="flex items-center gap-3"><Avatar firstName={member.user.firstName} lastName={member.user.lastName} muted={!member.user.isActive} /><div className="min-w-0"><p className={`truncate font-medium ${member.user.isActive ? '' : 'text-black/45'}`}>{fullName(member)}{member.user.id === currentUserId && <span className="ml-1.5 text-xs font-normal text-black/40">(vous)</span>}</p><p className="truncate text-xs text-black/45">{member.user.email || `@${member.user.username}`}<span className="md:hidden"> · {roleLabels[member.role]}</span></p></div></div></td>
            <td className="hidden px-4 py-2.5 text-black/70 md:table-cell">{roleLabels[member.role]}</td>
            <td className="hidden px-4 py-2.5 lg:table-cell">{!member.user.isActive ? <Badge tone="neutral">Désactivé</Badge> : member.user.mustChangePassword ? <Badge tone="warning">Mot de passe temporaire</Badge> : <Badge tone="positive">Actif</Badge>}</td>
            <td className="hidden px-4 py-2.5 text-black/55 sm:table-cell" title={formatDate(member.user.lastLoginAt)}>{formatRelative(member.user.lastLoginAt)}</td>
            <td className="pr-3 text-right text-black/25 transition group-hover:text-black/60">›</td>
          </tr>)}
        </tbody>
      </table>
      {!visible.length && <div className="px-4 py-12 text-center"><p className="text-sm font-medium">Aucun membre ne correspond</p><button onClick={() => { setSearch(''); setRole('ALL'); setStatus('ALL') }} className={`${buttonClass.ghost} mt-2`}>Réinitialiser les filtres</button></div>}
    </Surface>
    <details className="group mt-4 text-sm"><summary className="cursor-pointer list-none text-xs font-medium text-black/50 hover:text-black"><span className="inline-block transition group-open:rotate-90">›</span> Ce que permet chaque rôle</summary><dl className="mt-3 grid gap-x-6 gap-y-2 rounded-xl border border-black/[.07] bg-white p-4 sm:grid-cols-2">{roles.map((r) => <div key={r} className="flex gap-2"><dt className="w-28 shrink-0 font-medium">{roleLabels[r]}</dt><dd className="text-black/55">{roleDescriptions[r]}</dd></div>)}</dl></details>
  </>
}

// ─── Member drawer ───────────────────────────────────────────────────────────

function MemberDrawer({ member, isSelf, activeAdmins, activity, close, request, confirm, notify, reveal }: { member: Member; isSelf: boolean; activeAdmins: number; activity: Activity[]; close: () => void; request: Request; confirm: (value: Confirmation) => void; notify: (text: string) => void; reveal: (value: { name: string; username: string; password: string }) => void }) {
  const [error, setError] = useState('')
  const [savingRole, setSavingRole] = useState(false)
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [identity, setIdentity] = useState({ firstName: member.user.firstName, lastName: member.user.lastName, username: member.user.username, email: member.user.email || '' })
  const { user } = member
  const name = fullName(member)
  const base = `/api/admin/organization/members/${member.id}`
  const lastAdmin = member.role === 'ORG_ADMIN' && user.isActive && activeAdmins <= 1

  const changeRole = async (role: string) => {
    setError(''); setSavingRole(true)
    try { await request(base, { method: 'PATCH', body: JSON.stringify({ role }) }); notify(`${name} est maintenant ${roleLabels[role].toLowerCase()}.`) } catch (cause) { setError(message(cause, 'Changement de rôle impossible')) } finally { setSavingRole(false) }
  }
  const saveIdentity = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    try {
      await request(base, { method: 'PATCH', body: JSON.stringify(identity) })
      setEditingIdentity(false)
      notify('Identité mise à jour.')
    } catch (cause) { setError(message(cause, 'Mise à jour impossible')) }
  }
  // Errors raised inside the confirmation are surfaced here, in the drawer, next to the member they concern.
  const guarded = (run: () => Promise<void>) => async () => { setError(''); try { await run() } catch (cause) { setError(message(cause, 'Action impossible')) } }
  const resetPassword = () => confirm({ title: 'Réinitialiser le mot de passe', confirm: 'Générer un mot de passe', body: <>Un mot de passe temporaire sera généré pour <strong>{name}</strong>. Ses sessions actuelles seront fermées et un nouveau mot de passe lui sera demandé à la prochaine connexion.</>, run: guarded(async () => { const body = await request(`${base}/reset-password`, { method: 'POST' }); reveal({ name, username: user.username, password: String(body.temporaryPassword) }) }) })
  const disconnect = () => confirm({ title: 'Déconnecter tous les appareils', confirm: 'Déconnecter', body: <><strong>{name}</strong> devra se reconnecter sur chaque appareil. Son mot de passe ne change pas.</>, run: guarded(async () => { await request(`${base}/invalidate-sessions`, { method: 'POST' }); notify('Sessions fermées.') }) })
  const toggleAccess = () => confirm(user.isActive
    ? { title: 'Désactiver l’accès', confirm: 'Désactiver', destructive: true, body: <><strong>{name}</strong> ne pourra plus se connecter et sera déconnecté immédiatement. Son historique est conservé ; vous pourrez réactiver l’accès à tout moment.</>, run: guarded(async () => { await request(base, { method: 'PATCH', body: JSON.stringify({ isActive: false }) }); notify('Accès désactivé.') }) }
    : { title: 'Réactiver l’accès', confirm: 'Réactiver', body: <><strong>{name}</strong> pourra de nouveau se connecter avec son mot de passe actuel.</>, run: guarded(async () => { await request(base, { method: 'PATCH', body: JSON.stringify({ isActive: true }) }); notify('Accès réactivé.') }) })

  return <Drawer close={close} eyebrow={roleLabels[member.role]} title={<span className="flex items-center gap-2">{name}{isSelf && <span className="text-xs font-normal text-black/40">(vous)</span>}</span>}>
    {error && <p className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    <DrawerSection title="Identité">
      {editingIdentity ? <form onSubmit={saveIdentity} className="space-y-3">
        <div className="grid grid-cols-2 gap-2"><TextField label="Prénom" value={identity.firstName} set={(firstName) => setIdentity({ ...identity, firstName })} required /><TextField label="Nom" value={identity.lastName} set={(lastName) => setIdentity({ ...identity, lastName })} required /></div>
        <TextField label="Identifiant" value={identity.username} set={(username) => setIdentity({ ...identity, username })} required />
        <TextField label="E-mail" value={identity.email} set={(email) => setIdentity({ ...identity, email })} />
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingIdentity(false)} className={buttonClass.secondary}>Annuler</button><button className={buttonClass.primary}>Enregistrer</button></div>
      </form> : <>
        <Row label="Identifiant" value={`@${user.username}`} />
        <Row label="E-mail" value={user.email || '—'} />
        <Row label="Membre depuis" value={formatDate(member.createdAt)} />
        <button onClick={() => setEditingIdentity(true)} className={`${buttonClass.secondary} mt-3`}>Modifier l’identité</button>
      </>}
    </DrawerSection>
    <DrawerSection title="Accès">
      <label className="block"><span className="text-xs text-black/50">Rôle</span>
        <select disabled={savingRole || lastAdmin} value={member.role} onChange={(e) => void changeRole(e.target.value)} className={`${inputClass} mt-1 disabled:bg-black/[.03]`}>{roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}</select>
      </label>
      <p className="mt-1.5 text-xs text-black/45">{lastAdmin ? 'Dernier administrateur actif : nommez-en un autre avant de changer ce rôle.' : roleDescriptions[member.role]}</p>
      <div className="mt-3 flex items-center justify-between"><span className="text-sm">Statut</span>{user.isActive ? <Badge tone="positive">Actif</Badge> : <Badge tone="neutral">Désactivé</Badge>}</div>
    </DrawerSection>
    <DrawerSection title="Sécurité">
      <Row label="Dernière connexion" value={<span title={formatDate(user.lastLoginAt)}>{formatRelative(user.lastLoginAt)}</span>} />
      <Row label="Mot de passe" value={user.mustChangePassword ? <Badge tone="warning">Temporaire · à changer</Badge> : 'Défini par le membre'} />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button onClick={resetPassword} className={buttonClass.secondary}>Réinitialiser le mot de passe</button>
        <button onClick={disconnect} className={buttonClass.secondary}>Déconnecter les appareils</button>
      </div>
    </DrawerSection>
    {activity.length > 0 && <DrawerSection title="Historique">
      <ul className="space-y-2">{activity.slice(0, 5).map((item) => <li key={item.id} className="flex justify-between gap-3 text-sm"><span>{auditLabel(item.action)}</span><span className="shrink-0 text-xs text-black/40">{formatRelative(item.createdAt)}</span></li>)}</ul>
    </DrawerSection>}
    <div className="px-5 pb-6 pt-2">
      <div className="rounded-lg border border-black/[.07] p-4">
        <p className="text-sm font-medium">{user.isActive ? 'Désactiver l’accès' : 'Réactiver l’accès'}</p>
        <p className="mt-0.5 text-xs text-black/50">{user.isActive ? (lastAdmin ? 'Impossible : l’organisation doit garder au moins un administrateur actif.' : isSelf ? 'Vous serez déconnecté immédiatement.' : 'Bloque la connexion sans supprimer l’historique.') : 'Le membre pourra de nouveau se connecter.'}</p>
        <button onClick={toggleAccess} disabled={lastAdmin} className={`${user.isActive ? buttonClass.danger : buttonClass.secondary} mt-3`}>{user.isActive ? 'Désactiver' : 'Réactiver'}</button>
      </div>
    </div>
  </Drawer>
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="border-b border-black/[.06] px-5 py-4"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-black/40">{title}</h3>{children}</section>
}
function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex items-center justify-between gap-4 py-1 text-sm"><span className="text-black/50">{label}</span><span className="min-w-0 truncate text-right">{value}</span></div>
}

// ─── Modals ──────────────────────────────────────────────────────────────────

function AddMemberModal({ close, request, reveal }: { close: () => void; request: Request; reveal: (value: { name: string; username: string; password: string }) => void }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', username: '', email: '', role: 'DISPATCHER' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true)
    try { const body = await request('/api/admin/organization/members', { method: 'POST', body: JSON.stringify(form) }); close(); reveal({ name: `${form.firstName} ${form.lastName}`, username: form.username, password: String(body.temporaryPassword) }) } catch (cause) { setError(message(cause, 'Création impossible')) } finally { setBusy(false) }
  }
  const field = (key: 'firstName' | 'lastName' | 'username' | 'email', label: string, props: Record<string, unknown> = {}) => <label className="block"><span className="text-xs text-black/50">{label}</span><input {...props} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className={`${inputClass} mt-1`} /></label>
  return <Modal title="Ajouter un membre" close={close}>
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">{field('firstName', 'Prénom', { required: true, autoFocus: true })}{field('lastName', 'Nom', { required: true })}</div>
      {field('username', 'Identifiant de connexion', { required: true, autoComplete: 'off', placeholder: 'prenom.nom' })}
      {field('email', 'E-mail (facultatif)', { type: 'email' })}
      <label className="block"><span className="text-xs text-black/50">Rôle</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={`${inputClass} mt-1`}>{roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}</select><span className="mt-1 block text-xs text-black/45">{roleDescriptions[form.role]}</span></label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={close} className={buttonClass.secondary}>Annuler</button><button disabled={busy} className={buttonClass.primary}>{busy ? 'Création…' : 'Créer le membre'}</button></div>
      <p className="text-xs text-black/40">Un mot de passe temporaire sera généré ; le membre le changera à sa première connexion.</p>
    </form>
  </Modal>
}

function ConfirmModal({ value, close }: { value: Confirmation; close: () => void }) {
  const [busy, setBusy] = useState(false)
  const run = async () => { setBusy(true); try { await value.run() } finally { setBusy(false); close() } }
  return <Modal title={value.title} close={close}>
    <p className="text-sm leading-6 text-black/65">{value.body}</p>
    <div className="mt-5 flex justify-end gap-2"><button onClick={close} className={buttonClass.secondary}>Annuler</button><button autoFocus disabled={busy} onClick={() => void run()} className={value.destructive ? buttonClass.danger : buttonClass.primary}>{busy ? '…' : value.confirm}</button></div>
  </Modal>
}

function CredentialModal({ value, close }: { value: { name: string; username: string; password: string }; close: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => { void navigator.clipboard.writeText(value.password).then(() => setCopied(true)) }
  return <Modal title="Mot de passe temporaire" close={close}>
    <p className="text-sm text-black/60">Transmettez ces identifiants à <strong>{value.name}</strong> par un canal sûr. <span className="text-amber-700">Ce mot de passe ne sera plus affiché.</span></p>
    <dl className="mt-4 space-y-2 rounded-lg bg-[#f4f5f1] p-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-black/50">Identifiant</dt><dd className="font-mono">{value.username}</dd></div><div className="flex items-center justify-between gap-3"><dt className="text-black/50">Mot de passe</dt><dd className="break-all font-mono">{value.password}</dd></div></dl>
    <div className="mt-5 flex justify-end gap-2"><button onClick={copy} className={buttonClass.secondary}>{copied ? 'Copié ✓' : 'Copier le mot de passe'}</button><button onClick={close} className={buttonClass.primary}>Terminé</button></div>
  </Modal>
}

// ─── Activity ────────────────────────────────────────────────────────────────

function describe(item: Activity, members: Member[]) {
  const target = members.find((member) => member.user.id === item.metadata?.userId)
  const who = target ? fullName(target) : ''
  const meta = item.metadata || {}
  if (item.action === 'MEMBER_ROLE_CHANGED' && typeof meta.before === 'string' && typeof meta.after === 'string') return `${who} · ${roleLabels[meta.before] || meta.before} → ${roleLabels[meta.after] || meta.after}`
  if (item.action === 'MEMBER_STATUS_CHANGED') return `${who} · ${meta.isActive ? 'réactivé' : 'désactivé'}`
  if (item.action === 'MEMBER_ADDED' && typeof meta.role === 'string') return `${who} · ${roleLabels[meta.role] || meta.role}`
  return who
}

function ActivityRows({ items, members, compact = false }: { items: Activity[]; members: Member[]; compact?: boolean }) {
  if (!items.length) return <p className="px-4 py-8 text-center text-sm text-black/45">Aucune action administrative pour l’instant.</p>
  return <ul className="divide-y divide-black/[.05]">{items.map((item) => { const detail = describe(item, members); return <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm"><div className="min-w-0"><p className="font-medium">{auditLabel(item.action)}</p><p className="truncate text-xs text-black/45">{detail ? `${detail} · ` : ''}par {`${item.actor.firstName} ${item.actor.lastName}`.trim() || item.actor.username}</p></div><time className="shrink-0 text-xs text-black/40" title={formatDate(item.createdAt)}>{compact ? formatRelative(item.createdAt) : formatDate(item.createdAt)}</time></li> })}</ul>
}

function ActivityDrawer({ items, members, close }: { items: Activity[]; members: Member[]; close: () => void }) {
  const [action, setAction] = useState('ALL')
  const actions = Array.from(new Set(items.map((item) => item.action)))
  const visible = items.filter((item) => action === 'ALL' || item.action === action)
  return <Drawer close={close} eyebrow={`${items.length} derniers événements`} title="Activité administrative">
    <div className="border-b border-black/[.06] px-4 py-3"><select aria-label="Filtrer par action" value={action} onChange={(e) => setAction(e.target.value)} className={inputClass}><option value="ALL">Toutes les actions</option>{actions.map((value) => <option key={value} value={value}>{auditLabel(value)}</option>)}</select></div>
    <ActivityRows items={visible} members={members} />
  </Drawer>
}

// ─── Organization ────────────────────────────────────────────────────────────

function IntegrationRows({ integrations, compact = false }: { integrations: Integration[]; compact?: boolean }) {
  return <ul className="divide-y divide-black/[.05]">{integrationCatalog.map((entry) => {
    const current = integrations.find((item) => item.type === entry.type)
    const detail = current?.type === 'MAIL_INTAKE' && typeof current.configJson.mailboxAddress === 'string' ? current.configJson.mailboxAddress : entry.purpose
    return <li key={entry.type} className="flex items-center justify-between gap-3 px-4 py-2.5"><div className="min-w-0"><p className="text-sm font-medium">{entry.name}</p><p className="truncate text-xs text-black/45">{detail}{!compact && current ? ` · mise à jour ${formatRelative(current.updatedAt).toLowerCase()}` : ''}</p></div>{!current ? <Badge tone="neutral">Non configurée</Badge> : current.enabled ? <Badge tone="positive">Activée</Badge> : <Badge tone="neutral">Désactivée</Badge>}</li>
  })}</ul>
}

type BrandingDraft = { name: string; displayName: string; applicationTitle: string; accentColor: string; logoUrl: string; faviconUrl: string }
const toDraft = (organization: Organization): BrandingDraft => ({ name: organization.name, displayName: organization.displayName || '', applicationTitle: organization.applicationTitle || '', accentColor: organization.accentColor || '', logoUrl: organization.logoUrl || '', faviconUrl: organization.faviconUrl || '' })

function OrganizationSettings({ organization, request, notify }: { organization: Organization; request: Request; notify: (text: string) => void }) {
  const [draft, setDraft] = useState<BrandingDraft>(() => toDraft(organization))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saved = toDraft(organization)
  const dirty = (Object.keys(saved) as (keyof BrandingDraft)[]).some((key) => saved[key] !== draft[key])
  const accent = /^#[0-9a-f]{6}$/i.test(draft.accentColor) ? draft.accentColor : '#C8FF00'
  const set = (key: keyof BrandingDraft) => (value: string) => setDraft({ ...draft, [key]: value })

  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true)
    try { await request('/api/admin/organization', { method: 'PATCH', body: JSON.stringify(draft) }); notify('Organisation mise à jour.') } catch (cause) { setError(message(cause, 'Enregistrement impossible')) } finally { setBusy(false) }
  }

  return <>
    <SectionHeader title="Organisation" description="Identité visible par votre équipe, intégrations et modules." />
    <form onSubmit={save}>
      <Surface title="Identité">
        <div className="grid gap-6 p-4 lg:grid-cols-[1fr_300px]">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Nom de l’organisation" value={draft.name} set={set('name')} required />
            <TextField label="Nom affiché" value={draft.displayName} set={set('displayName')} placeholder={draft.name} />
            <TextField label="Titre de l’application" value={draft.applicationTitle} set={set('applicationTitle')} placeholder="Gerard" hint="Affiché dans l’onglet du navigateur" />
            <label className="block"><span className="text-xs text-black/50">Couleur d’accent</span><div className="mt-1 flex gap-2"><input type="color" aria-label="Choisir la couleur" value={accent} onChange={(e) => set('accentColor')(e.target.value)} className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-black/10 bg-white p-1" /><input value={draft.accentColor} onChange={(e) => set('accentColor')(e.target.value)} placeholder="#C8FF00" className={`${inputClass} font-mono`} /></div></label>
            <TextField label="Logo" value={draft.logoUrl} set={set('logoUrl')} placeholder="https://… ou /logo.png" />
            <TextField label="Favicon" value={draft.faviconUrl} set={set('faviconUrl')} placeholder="https://… ou /favicon.ico" />
          </div>
          <div><p className="mb-1 text-xs text-black/50">Aperçu</p>
            <div className="overflow-hidden rounded-lg border border-black/[.08]">
              <div className="flex items-center gap-2 bg-[#11130f] px-3 py-2.5 text-white">{draft.logoUrl ? <img src={draft.logoUrl} alt="" className="h-6 w-6 rounded bg-white object-contain p-0.5" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-black text-black" style={{ background: accent }}>{(draft.displayName || draft.name)[0]?.toUpperCase()}</span>}<span className="truncate text-sm font-semibold">{draft.displayName || draft.name}</span></div>
              <div className="space-y-2 bg-[#f4f5f1] p-3"><div className="h-2 w-2/3 rounded bg-black/10" /><div className="h-2 w-1/2 rounded bg-black/[.07]" /><span className="mt-1 inline-flex rounded-md px-2.5 py-1 text-xs font-semibold text-black" style={{ background: accent }}>Action principale</span></div>
              <div className="flex items-center gap-2 border-t border-black/[.06] bg-white px-3 py-2 text-xs text-black/50">{draft.faviconUrl && <img src={draft.faviconUrl} alt="" className="h-3.5 w-3.5" onError={(e) => { e.currentTarget.style.display = 'none' }} />}<span className="truncate">{draft.applicationTitle || 'Gerard'}</span></div>
            </div>
          </div>
        </div>
        {error && <p className="mx-4 mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className={`flex items-center justify-end gap-2 border-t border-black/[.06] px-4 py-3 transition ${dirty ? 'bg-[#fafbf7]' : ''}`}>
          {dirty && <span className="mr-auto text-xs text-black/50">Modifications non enregistrées</span>}
          <button type="button" disabled={!dirty || busy} onClick={() => { setDraft(saved); setError('') }} className={buttonClass.secondary}>Annuler</button>
          <button disabled={!dirty || busy} className={buttonClass.primary}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </Surface>
    </form>

    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <Surface title="Intégrations"><IntegrationRows integrations={organization.integrations} /><p className="border-t border-black/[.06] px-4 py-2.5 text-xs text-black/45">Configurées par l’équipe Gerard. Contactez le support pour les modifier.</p></Surface>
      <Surface title="Modules inclus">
        <div className="flex flex-wrap gap-1.5 p-4">{Object.entries(moduleLabels).map(([module, label]) => { const active = organization.enabledModules.includes(module); return <span key={module} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${active ? 'border-black/10 bg-white font-medium' : 'border-dashed border-black/10 text-black/35'}`}><span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-[#8eb800]' : 'bg-black/15'}`} />{label}</span> })}</div>
        <p className="border-t border-black/[.06] px-4 py-2.5 text-xs text-black/45">Déterminés par votre offre Gerard.</p>
      </Surface>
    </div>
  </>
}

function TextField({ label, value, set, placeholder, hint, required = false }: { label: string; value: string; set: (value: string) => void; placeholder?: string; hint?: string; required?: boolean }) {
  return <label className="block"><span className="text-xs text-black/50">{label}</span><input required={required} value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} className={`${inputClass} mt-1`} />{hint && <span className="mt-1 block text-xs text-black/40">{hint}</span>}</label>
}

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const user = await getCurrentUser(req)
  if (!user || user.organizationRole !== 'ORG_ADMIN' || !user.isActive || user.mustChangePassword) { res.statusCode = 403; return { props: { accessDenied: true } } }
  return { props: { platformAdmin: Boolean(user.platformRole), currentUserId: user.id } }
}
