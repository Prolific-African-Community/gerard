import type { GetServerSideProps } from 'next'
import Head from 'next/head'
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { AdminShell, Avatar, Badge, Drawer, Modal, Notice, SectionHeader, Surface, TextField, Toast, auditLabel, buttonClass, formatDate, formatRelative, headerLinkClass, inputClass, roleDescriptions, roleLabels } from '../../components/admin/ui'
import { LogoutButton } from '../../components/site/LogoutButton'
import { getCurrentUser } from '../../lib/auth/authorization'

const roles = ['ORG_ADMIN', 'MANAGER', 'DISPATCHER', 'SECRETARY', 'ACCOUNTING', 'DRIVER', 'VIEWER'] as const
const sections = [{ id: 'overview', label: 'Aperçu' }, { id: 'members', label: 'Membres' }] as const
type Section = (typeof sections)[number]['id']
const INACTIVE_DAYS = 30

type Member = { id: string; role: string; createdAt: string; user: { id: string; firstName: string; lastName: string; username: string; email: string | null; isActive: boolean; mustChangePassword: boolean; lastLoginAt: string | null; createdAt: string; sessionVersion: number } }
type Activity = { id: string; action: string; metadata: Record<string, unknown> | null; createdAt: string; actor: { firstName: string; lastName: string; username: string } }
type Organization = { id: string; name: string; status: string; displayName: string | null; logoUrl: string | null; users: Member[]; platformAuditLogs: Activity[] }
type Request = (url: string, init: RequestInit) => Promise<Record<string, unknown>>
type Confirmation = { title: string; body: ReactNode; confirm: string; destructive?: boolean; run: () => Promise<void> }
type Attention = { member: Member; reason: string; tone: 'warning' | 'neutral' }
type Credential = { name: string; username: string; password: string }

const fullName = (member: Member) => `${member.user.firstName} ${member.user.lastName}`.trim() || member.user.username
const daysSince = (value: string) => (Date.now() - new Date(value).getTime()) / 86400000
// Server messages are already French; only the internal role code is humanised.
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message.replace(/ORG_ADMIN/g, 'administrateur') : fallback

export default function OrganizationAdminPage({ accessDenied = false, platformAdmin = false, currentUserId = '' }: { accessDenied?: boolean; platformAdmin?: boolean; currentUserId?: string }) {
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loadError, setLoadError] = useState('')
  const [section, setSection] = useState<Section>('overview')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [credential, setCredential] = useState<Credential | null>(null)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/organization')
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Chargement impossible')
    setOrganization(body.organization)
  }, [])
  useEffect(() => { if (!accessDenied) void load().catch((cause) => setLoadError(message(cause, 'Chargement impossible'))) }, [accessDenied, load])

  // The active section lives in the URL hash so reloads and shared links land in the same place.
  useEffect(() => {
    const sync = () => { const hash = window.location.hash.slice(1); if (sections.some((item) => item.id === hash)) setSection(hash as Section) }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  const navigate = (next: string) => { setSection(next as Section); window.history.replaceState(null, '', `#${next}`) }
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
    return { total: members.length, active: active.length, disabled: members.length - active.length, admins: active.filter((member) => member.role === 'ORG_ADMIN').length }
  }, [members])
  const attention = useMemo<Attention[]>(() => members.filter((member) => member.user.isActive).flatMap((member): Attention[] => {
    if (member.user.mustChangePassword) return [{ member, reason: 'Mot de passe temporaire non changé', tone: 'warning' }]
    if (!member.user.lastLoginAt) return [{ member, reason: 'Jamais connecté', tone: 'neutral' }]
    if (daysSince(member.user.lastLoginAt) > INACTIVE_DAYS) return [{ member, reason: `Inactif depuis ${formatRelative(member.user.lastLoginAt).replace('Il y a ', '')}`, tone: 'neutral' }]
    return []
  }), [members])

  if (accessDenied) return <main className="gerard-admin flex min-h-screen items-center justify-center bg-[#f4f5f1] p-6"><section className="w-full max-w-sm rounded-2xl border border-black/[.08] bg-white p-6 text-center"><h1 className="text-lg font-semibold">Accès réservé</h1><p className="mt-2 text-sm text-black/60">Cette zone est réservée aux administrateurs de l’organisation.</p><a className={`${buttonClass.primary} mt-5`} href="/dispatch">Retour au dispatch</a></section></main>
  if (!organization) return <main className="gerard-admin min-h-screen bg-[#f4f5f1]"><div className="h-12 bg-[#11130f]" /><div className="h-11 border-b border-black/[.08] bg-white" /><div className="mx-auto max-w-[1200px] space-y-3 px-4 py-8 lg:px-8">{loadError ? <Notice tone="error">{loadError}</Notice> : <><div className="h-8 w-64 animate-pulse rounded bg-black/[.06]" /><div className="h-24 animate-pulse rounded-xl bg-black/[.04]" /><div className="h-64 animate-pulse rounded-xl bg-black/[.04]" /></>}</div></main>

  const orgName = organization.displayName || organization.name
  const openMember = (member: Member) => setSelectedId(member.id)
  const mark = organization.logoUrl ? <img src={organization.logoUrl} alt="" className="h-7 w-7 shrink-0 rounded-md bg-white object-contain p-0.5" /> : <span aria-hidden className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#C8FF00] text-xs font-black text-black">{orgName[0]?.toUpperCase()}</span>

  return <>
    <Head><title>{`Administration · ${orgName}`}</title></Head>
    <AdminShell mark={mark} title={orgName} context="Administration des accès"
      badge={organization.status !== 'ACTIVE' ? <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[11px] font-semibold text-black">{organization.status === 'SUSPENDED' ? 'Suspendue' : 'Archivée'}</span> : undefined}
      actions={<>{platformAdmin && <a href="/admin" className={`${headerLinkClass} hidden sm:inline-flex`}>Plateforme</a>}<a href="/dispatch" className={headerLinkClass}>Dispatch</a><LogoutButton tone="dark" className="!h-8 !w-8 !rounded-md !shadow-none hover:!translate-y-0" /></>}
      tabs={[{ id: 'overview', label: 'Aperçu' }, { id: 'members', label: 'Membres', count: stats.active }]} active={section} onTab={navigate}>
      {section === 'overview' && <Overview organization={organization} stats={stats} attention={attention} openMember={openMember} addMember={() => setAddOpen(true)} openActivity={() => setActivityOpen(true)} navigate={navigate} />}
      {section === 'members' && <Members members={members} currentUserId={currentUserId} openMember={openMember} addMember={() => setAddOpen(true)} />}
    </AdminShell>

    {selected && <MemberDrawer key={selected.id} member={selected} isSelf={selected.user.id === currentUserId} activeAdmins={stats.admins} activity={organization.platformAuditLogs.filter((item) => item.metadata?.userId === selected.user.id)} close={() => setSelectedId(null)} request={request} confirm={setConfirmation} notify={setToast} reveal={setCredential} />}
    {addOpen && <AddMemberModal close={() => setAddOpen(false)} request={request} reveal={setCredential} />}
    {activityOpen && <ActivityDrawer items={organization.platformAuditLogs} members={members} close={() => setActivityOpen(false)} />}
    {confirmation && <ConfirmModal value={confirmation} close={() => setConfirmation(null)} />}
    {credential && <CredentialModal value={credential} close={() => setCredential(null)} />}
    {toast && <Toast text={toast} />}
  </>
}

// ─── Overview ────────────────────────────────────────────────────────────────

function Overview({ organization, stats, attention, openMember, addMember, openActivity, navigate }: { organization: Organization; stats: { total: number; active: number; disabled: number; admins: number }; attention: Attention[]; openMember: (member: Member) => void; addMember: () => void; openActivity: () => void; navigate: (section: string) => void }) {
  const summary = [
    { label: 'Membres actifs', value: stats.active, hint: `sur ${stats.total} comptes` },
    { label: 'Administrateurs', value: stats.admins, hint: stats.admins < 2 ? 'Recommandé : 2 minimum' : 'actifs', warn: stats.admins < 2 },
    { label: 'Accès désactivés', value: stats.disabled, hint: 'historique conservé' },
    { label: 'À vérifier', value: attention.length, hint: attention.length ? 'comptes à revoir' : 'rien à signaler', warn: attention.length > 0 },
  ]
  const recentLogins = organization.users.filter((member) => member.user.lastLoginAt).sort((a, b) => (b.user.lastLoginAt || '').localeCompare(a.user.lastLoginAt || '')).slice(0, 5)
  return <>
    <SectionHeader title="Aperçu" description="Qui a accès, et ce qui demande votre attention." action={<button onClick={addMember} className={buttonClass.accent}>＋ Ajouter un membre</button>} />
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-black/[.08] bg-white lg:grid-cols-4">
      {summary.map((item, index) => <div key={item.label} className={`border-black/[.06] px-4 py-4 ${index % 2 ? 'border-l' : ''} ${index > 1 ? 'border-t lg:border-t-0' : ''} ${index === 2 ? 'lg:border-l' : ''}`}><p className="text-xs font-medium text-black/60">{item.label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{item.value}</p><p className={`mt-0.5 text-xs ${item.warn ? 'font-medium text-amber-800' : 'text-black/60'}`}>{item.hint}</p></div>)}
    </div>

    <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <Surface title="À vérifier" action={<button onClick={() => navigate('members')} className={buttonClass.ghost}>Tous les membres →</button>}>
        {stats.admins < 2 && <div className="flex items-start gap-3 border-b border-black/[.06] bg-amber-50 px-4 py-3 text-sm"><span aria-hidden className="mt-0.5 text-amber-600">▲</span><div><p className="font-medium">Un seul administrateur actif</p><p className="text-xs text-black/60">Nommez un second administrateur pour ne jamais perdre l’accès à l’organisation.</p></div></div>}
        {attention.length ? <ul className="divide-y divide-black/[.05]">{attention.slice(0, 6).map(({ member, reason, tone }) => <li key={member.id}><button onClick={() => openMember(member)} className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-[#f7f8f4] focus-visible:bg-[#f7f8f4] focus-visible:outline-none"><Avatar firstName={member.user.firstName} lastName={member.user.lastName} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{fullName(member)}</span><span className="block text-xs text-black/60">{roleLabels[member.role]}</span></span><Badge tone={tone}>{reason}</Badge></button></li>)}</ul>
          : <p className="px-4 py-8 text-center text-sm text-black/60">Tous les accès actifs sont à jour.</p>}
        {attention.length > 6 && <p className="border-t border-black/[.06] px-4 py-2 text-xs text-black/60">+ {attention.length - 6} autre{attention.length - 6 > 1 ? 's' : ''} dans la liste des membres</p>}
      </Surface>

      <div className="space-y-5">
        <Surface title="Dernières connexions">
          {recentLogins.length ? <ul className="divide-y divide-black/[.05]">{recentLogins.map((member) => <li key={member.id}><button onClick={() => openMember(member)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-[#f7f8f4] focus-visible:bg-[#f7f8f4] focus-visible:outline-none"><span className="truncate font-medium">{fullName(member)}</span><time className="shrink-0 text-xs text-black/60" title={formatDate(member.user.lastLoginAt)}>{formatRelative(member.user.lastLoginAt)}</time></button></li>)}</ul> : <p className="px-4 py-6 text-center text-sm text-black/60">Aucune connexion enregistrée.</p>}
        </Surface>
        <Surface title="Activité récente" action={organization.platformAuditLogs.length > 0 && <button onClick={openActivity} className={buttonClass.ghost}>Tout voir →</button>}>
          <ActivityRows items={organization.platformAuditLogs.slice(0, 5)} members={organization.users} compact />
        </Surface>
      </div>
    </div>
  </>
}

// ─── Members ─────────────────────────────────────────────────────────────────

function Members({ members, currentUserId, openMember, addMember }: { members: Member[]; currentUserId: string; openMember: (member: Member) => void; addMember: () => void }) {
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
    <SectionHeader title="Membres" description="Comptes, rôles et sécurité des accès." action={<button onClick={addMember} className={buttonClass.accent}>＋ Ajouter un membre</button>} />
    <Surface>
      <div className="flex flex-col gap-2 border-b border-black/[.06] p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1"><span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/60">⌕</span><input aria-label="Rechercher un membre" className={`${inputClass} pl-8`} placeholder="Rechercher par nom, identifiant ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="flex flex-wrap gap-2">
          <div role="group" aria-label="Filtrer par statut" className="inline-flex rounded-lg bg-black/[.05] p-0.5">{(['ACTIVE', 'DISABLED', 'ALL'] as const).map((value) => <button key={value} onClick={() => setStatus(value)} aria-pressed={status === value} className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8eb800] ${status === value ? 'bg-white text-black shadow-sm' : 'text-black/60 hover:text-black'}`}>{{ ACTIVE: 'Actifs', DISABLED: 'Désactivés', ALL: 'Tous' }[value]} <span className="tabular-nums text-black/60">{counts[value]}</span></button>)}</div>
          <select aria-label="Filtrer par rôle" className={`${inputClass} w-auto`} value={role} onChange={(e) => setRole(e.target.value)}><option value="ALL">Tous les rôles</option>{roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}</select>
        </div>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-black/60"><tr className="border-b border-black/[.06]">
          <th scope="col" className="px-4 py-2 font-medium">Membre</th>
          <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Rôle</th>
          <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">Statut</th>
          <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell"><button onClick={() => setSort(sort === 'login' ? 'name' : 'login')} className="inline-flex items-center gap-1 rounded hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8eb800]">Dernière connexion {sort === 'login' ? '↓' : <span className="text-black/30">↕</span>}</button></th>
          <th scope="col" className="w-8"><span className="sr-only">Ouvrir</span></th>
        </tr></thead>
        <tbody className="divide-y divide-black/[.05]">
          {visible.map((member) => <tr key={member.id} onClick={() => openMember(member)} tabIndex={0} aria-label={`Ouvrir ${fullName(member)}`} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openMember(member))} className="group cursor-pointer transition hover:bg-[#f7f8f4] focus-visible:bg-[#f7f8f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8eb800]">
            <td className="px-4 py-2.5"><div className="flex items-center gap-3"><Avatar firstName={member.user.firstName} lastName={member.user.lastName} muted={!member.user.isActive} /><div className="min-w-0"><p className={`truncate font-medium ${member.user.isActive ? '' : 'text-black/60'}`}>{fullName(member)}{member.user.id === currentUserId && <span className="ml-1.5 text-xs font-normal text-black/60">(vous)</span>}</p><p className="truncate text-xs text-black/60">@{member.user.username}{member.user.email ? ` · ${member.user.email}` : ''}</p><p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-black/60 lg:hidden"><span className="md:hidden">{roleLabels[member.role]}</span>{!member.user.isActive ? <Badge tone="neutral">Désactivé</Badge> : member.user.mustChangePassword ? <Badge tone="warning">Mot de passe temporaire</Badge> : null}<span className="sm:hidden">· {formatRelative(member.user.lastLoginAt)}</span></p></div></div></td>
            <td className="hidden px-4 py-2.5 text-black/75 md:table-cell">{roleLabels[member.role]}</td>
            <td className="hidden px-4 py-2.5 lg:table-cell">{!member.user.isActive ? <Badge tone="neutral">Désactivé</Badge> : member.user.mustChangePassword ? <Badge tone="warning">Mot de passe temporaire</Badge> : <Badge tone="positive">Actif</Badge>}</td>
            <td className="hidden px-4 py-2.5 text-black/70 sm:table-cell" title={formatDate(member.user.lastLoginAt)}>{formatRelative(member.user.lastLoginAt)}</td>
            <td aria-hidden className="pr-3 text-right text-black/30 transition group-hover:text-black/70">›</td>
          </tr>)}
        </tbody>
      </table>
      {!visible.length && <div className="px-4 py-12 text-center"><p className="text-sm font-medium">Aucun membre ne correspond</p><button onClick={() => { setSearch(''); setRole('ALL'); setStatus('ALL') }} className={`${buttonClass.ghost} mt-2`}>Réinitialiser les filtres</button></div>}
    </Surface>
    <details className="group mt-4 text-sm"><summary className="cursor-pointer list-none rounded text-xs font-medium text-black/60 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8eb800]"><span aria-hidden className="inline-block transition group-open:rotate-90">›</span> Ce que permet chaque rôle</summary><dl className="mt-3 grid gap-x-6 gap-y-2 rounded-xl border border-black/[.08] bg-white p-4 sm:grid-cols-2">{roles.map((r) => <div key={r} className="flex gap-2"><dt className="w-28 shrink-0 font-medium">{roleLabels[r]}</dt><dd className="text-black/60">{roleDescriptions[r]}</dd></div>)}</dl></details>
  </>
}

// ─── Member drawer ───────────────────────────────────────────────────────────

function MemberDrawer({ member, isSelf, activeAdmins, activity, close, request, confirm, notify, reveal }: { member: Member; isSelf: boolean; activeAdmins: number; activity: Activity[]; close: () => void; request: Request; confirm: (value: Confirmation) => void; notify: (text: string) => void; reveal: (value: Credential) => void }) {
  const { user } = member
  const saved = { firstName: user.firstName, lastName: user.lastName, username: user.username, email: user.email || '' }
  const [error, setError] = useState('')
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [identity, setIdentity] = useState(saved)
  const [savingIdentity, setSavingIdentity] = useState(false)
  const [role, setRole] = useState(member.role)
  const [savingRole, setSavingRole] = useState(false)
  useEffect(() => setRole(member.role), [member.role])
  const name = fullName(member)
  const base = `/api/admin/organization/members/${member.id}`
  const lastAdmin = member.role === 'ORG_ADMIN' && user.isActive && activeAdmins <= 1
  const identityDirty = (Object.keys(saved) as (keyof typeof saved)[]).some((key) => saved[key] !== identity[key])

  const saveRole = async () => {
    setError(''); setSavingRole(true)
    try { await request(base, { method: 'PATCH', body: JSON.stringify({ role }) }); notify(`${name} : ${roleLabels[role].toLowerCase()}.`) } catch (cause) { setRole(member.role); setError(message(cause, 'Changement de rôle impossible')) } finally { setSavingRole(false) }
  }
  const saveIdentity = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSavingIdentity(true)
    try { await request(base, { method: 'PATCH', body: JSON.stringify({ ...identity, email: identity.email.trim() || null }) }); setEditingIdentity(false); notify('Identité mise à jour.') } catch (cause) { setError(message(cause, 'Mise à jour impossible')) } finally { setSavingIdentity(false) }
  }
  // Errors raised inside a confirmation are surfaced here, in the drawer, next to the member they concern.
  const guarded = (run: () => Promise<void>) => async () => { setError(''); try { await run() } catch (cause) { setError(message(cause, 'Action impossible')) } }
  const resetPassword = () => confirm({ title: 'Réinitialiser le mot de passe', confirm: 'Générer un mot de passe', body: <>Un mot de passe temporaire sera généré pour <strong>{name}</strong>. Ses sessions actuelles seront fermées et il devra choisir un nouveau mot de passe à la prochaine connexion.</>, run: guarded(async () => { const body = await request(`${base}/reset-password`, { method: 'POST' }); reveal({ name, username: user.username, password: String(body.temporaryPassword) }) }) })
  const disconnect = () => confirm({ title: 'Déconnecter tous les appareils', confirm: 'Déconnecter', body: <><strong>{name}</strong> devra se reconnecter sur chaque appareil. Son mot de passe ne change pas.</>, run: guarded(async () => { await request(`${base}/invalidate-sessions`, { method: 'POST' }); notify('Sessions fermées.') }) })
  const toggleAccess = () => confirm(user.isActive
    ? { title: 'Désactiver l’accès', confirm: 'Désactiver', destructive: true, body: <><strong>{name}</strong> ne pourra plus se connecter et sera déconnecté immédiatement. Son historique est conservé ; vous pourrez réactiver l’accès à tout moment.</>, run: guarded(async () => { await request(base, { method: 'PATCH', body: JSON.stringify({ isActive: false }) }); notify('Accès désactivé.') }) }
    : { title: 'Réactiver l’accès', confirm: 'Réactiver', body: <><strong>{name}</strong> pourra de nouveau se connecter avec son mot de passe actuel.</>, run: guarded(async () => { await request(base, { method: 'PATCH', body: JSON.stringify({ isActive: true }) }); notify('Accès réactivé.') }) })

  return <Drawer close={close} eyebrow={roleLabels[member.role]} title={<span className="flex items-center gap-2">{name}{isSelf && <span className="text-xs font-normal text-black/60">(vous)</span>}</span>}>
    {error && <div className="mx-5 mt-4"><Notice tone="error">{error}</Notice></div>}
    <DrawerSection title="Identité" action={!editingIdentity && <button onClick={() => { setIdentity(saved); setEditingIdentity(true) }} className={buttonClass.ghost}>Modifier</button>}>
      {editingIdentity ? <form onSubmit={saveIdentity} className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2"><TextField label="Prénom" value={identity.firstName} set={(firstName) => setIdentity({ ...identity, firstName })} required autoFocus /><TextField label="Nom" value={identity.lastName} set={(lastName) => setIdentity({ ...identity, lastName })} required /></div>
        <TextField label="Identifiant de connexion" value={identity.username} set={(username) => setIdentity({ ...identity, username })} required hint={identity.username !== saved.username ? 'Le membre devra utiliser ce nouvel identifiant pour se connecter.' : undefined} />
        <TextField label="E-mail" type="email" value={identity.email} set={(email) => setIdentity({ ...identity, email })} placeholder="Facultatif" />
        <div className="flex items-center justify-end gap-2">{identityDirty && <span className="mr-auto text-xs font-medium text-amber-800">Non enregistré</span>}<button type="button" onClick={() => setEditingIdentity(false)} className={buttonClass.secondary}>Annuler</button><button disabled={!identityDirty || savingIdentity} className={buttonClass.primary}>{savingIdentity ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </form> : <>
        <Row label="Prénom et nom" value={`${user.firstName} ${user.lastName}`} />
        <Row label="Identifiant" value={`@${user.username}`} />
        <Row label="E-mail" value={user.email || '—'} />
        <Row label="Membre depuis" value={formatDate(member.createdAt)} />
      </>}
    </DrawerSection>
    <DrawerSection title="Accès">
      <label className="block"><span className="text-xs font-medium text-black/70">Rôle dans l’organisation</span>
        <div className="mt-1 flex gap-2"><select disabled={savingRole || lastAdmin} value={role} onChange={(e) => setRole(e.target.value)} className={`${inputClass} disabled:cursor-not-allowed disabled:bg-black/[.03]`}>{roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}</select>{role !== member.role && <button onClick={() => void saveRole()} disabled={savingRole} className={`${buttonClass.primary} shrink-0`}>{savingRole ? '…' : 'Appliquer'}</button>}</div>
      </label>
      <p className="mt-1.5 text-xs text-black/60">{lastAdmin ? 'Dernier administrateur actif : nommez-en un autre avant de changer ce rôle.' : roleDescriptions[role]}</p>
      <div className="mt-3 flex items-center justify-between text-sm"><span className="text-black/60">Statut</span>{user.isActive ? <Badge tone="positive">Actif</Badge> : <Badge tone="neutral">Désactivé</Badge>}</div>
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
      <ul className="space-y-2">{activity.slice(0, 6).map((item) => <li key={item.id} className="flex justify-between gap-3 text-sm"><span>{activityLabel(item)}</span><time className="shrink-0 text-xs text-black/60" title={formatDate(item.createdAt)}>{formatRelative(item.createdAt)}</time></li>)}</ul>
    </DrawerSection>}
    <div className="px-5 pb-6 pt-4">
      <div className={`rounded-lg border p-4 ${user.isActive ? 'border-red-200' : 'border-black/[.08]'}`}>
        <p className="text-sm font-medium">{user.isActive ? 'Désactiver l’accès' : 'Réactiver l’accès'}</p>
        <p className="mt-0.5 text-xs text-black/60">{user.isActive ? (lastAdmin ? 'Impossible : l’organisation doit garder au moins un administrateur actif.' : isSelf ? 'Vous serez déconnecté immédiatement.' : 'Bloque la connexion sans supprimer l’historique.') : 'Le membre pourra de nouveau se connecter.'}</p>
        <button onClick={toggleAccess} disabled={lastAdmin} className={`${user.isActive ? buttonClass.danger : buttonClass.secondary} mt-3`}>{user.isActive ? 'Désactiver l’accès' : 'Réactiver l’accès'}</button>
      </div>
    </div>
  </Drawer>
}

function DrawerSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="border-b border-black/[.06] px-5 py-4"><div className="mb-3 flex min-h-[20px] items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wide text-black/60">{title}</h3>{action}</div>{children}</section>
}
function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex items-center justify-between gap-4 py-1 text-sm"><span className="text-black/60">{label}</span><span className="min-w-0 truncate text-right">{value}</span></div>
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
  const field = (key: 'firstName' | 'lastName' | 'username' | 'email', label: string, props: { required?: boolean; autoFocus?: boolean; placeholder?: string; type?: string } = {}) => <TextField label={label} value={form[key]} set={(value) => setForm({ ...form, [key]: value })} {...props} />
  return <Modal title="Ajouter un membre" close={close}>
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">{field('firstName', 'Prénom', { required: true, autoFocus: true })}{field('lastName', 'Nom', { required: true })}</div>
      {field('username', 'Identifiant de connexion', { required: true, placeholder: 'prenom.nom' })}
      {field('email', 'E-mail (facultatif)', { type: 'email' })}
      <label className="block"><span className="text-xs font-medium text-black/70">Rôle</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={`${inputClass} mt-1`}>{roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}</select><span className="mt-1 block text-xs text-black/60">{roleDescriptions[form.role]}</span></label>
      {error && <Notice tone="error">{message(new Error(error), error)}</Notice>}
      <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={close} className={buttonClass.secondary}>Annuler</button><button disabled={busy} className={buttonClass.primary}>{busy ? 'Création…' : 'Créer le membre'}</button></div>
      <p className="text-xs text-black/60">Un mot de passe temporaire sera généré ; le membre le changera à sa première connexion.</p>
    </form>
  </Modal>
}

function ConfirmModal({ value, close }: { value: Confirmation; close: () => void }) {
  const [busy, setBusy] = useState(false)
  const run = async () => { setBusy(true); try { await value.run() } finally { setBusy(false); close() } }
  return <Modal title={value.title} close={close}>
    <p className="text-sm leading-6 text-black/70">{value.body}</p>
    <div className="mt-5 flex justify-end gap-2"><button onClick={close} className={buttonClass.secondary}>Annuler</button><button autoFocus disabled={busy} onClick={() => void run()} className={value.destructive ? buttonClass.danger : buttonClass.primary}>{busy ? '…' : value.confirm}</button></div>
  </Modal>
}

function CredentialModal({ value, close }: { value: { name: string; username: string; password: string }; close: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => { void navigator.clipboard.writeText(value.password).then(() => setCopied(true)) }
  return <Modal title="Mot de passe temporaire" close={close}>
    <p className="text-sm text-black/60">Transmettez ces identifiants à <strong>{value.name}</strong> par un canal sûr. </p>
    <p className="mt-2 text-sm text-black/60">Il lui sera demandé de choisir son propre mot de passe à la première connexion. <strong className="font-medium text-amber-800">Ce mot de passe ne sera plus affiché après fermeture.</strong></p>
    <dl className="mt-4 space-y-2 rounded-lg bg-[#f4f5f1] p-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-black/60">Identifiant</dt><dd className="font-mono">{value.username}</dd></div><div className="flex items-center justify-between gap-3"><dt className="text-black/60">Mot de passe</dt><dd className="break-all font-mono">{value.password}</dd></div></dl>
    <div className="mt-5 flex justify-end gap-2"><button onClick={copy} className={buttonClass.secondary}>{copied ? 'Copié ✓' : 'Copier le mot de passe'}</button><button onClick={close} className={buttonClass.primary}>Terminé</button></div>
  </Modal>
}

// ─── Activity ────────────────────────────────────────────────────────────────

// Identity edits and platform-issued configuration are both stored as ORGANIZATION_UPDATED; metadata tells them apart.
function activityLabel(item: Activity) {
  if (item.metadata?.kind === 'USER_IDENTITY_UPDATED') return 'Identité du membre modifiée'
  if (item.metadata?.source === 'GERARD_PLATFORM') return 'Configuration mise à jour par Gerard'
  return auditLabel(item.action)
}

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
  if (!items.length) return <p className="px-4 py-8 text-center text-sm text-black/60">Aucune action administrative pour l’instant.</p>
  return <ul className="divide-y divide-black/[.05]">{items.map((item) => { const detail = describe(item, members); return <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm"><div className="min-w-0"><p className="font-medium">{activityLabel(item)}</p><p className="truncate text-xs text-black/60">{detail ? `${detail} · ` : ''}par {`${item.actor.firstName} ${item.actor.lastName}`.trim() || item.actor.username}</p></div><time className="shrink-0 text-xs text-black/60" title={formatDate(item.createdAt)}>{compact ? formatRelative(item.createdAt) : formatDate(item.createdAt)}</time></li> })}</ul>
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

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const user = await getCurrentUser(req)
  if (!user || user.organizationRole !== 'ORG_ADMIN' || !user.isActive || user.mustChangePassword) { res.statusCode = 403; return { props: { accessDenied: true } } }
  return { props: { platformAdmin: Boolean(user.platformRole), currentUserId: user.id } }
}
