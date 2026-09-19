import { UserRole } from '@prisma/client'
import type { GetServerSideProps } from 'next'
import {
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { getCurrentUser } from '../lib/auth/authorization'
import { LogoutButton } from '../components/site/LogoutButton'

const roleLabels: Record<UserRole, string> = {
  ADMIN: 'Administrateur',
  DISPATCHER: 'Dispatcher',
  SECRETARY: 'Secrétaire',
  PARK_MANAGER: 'Gestionnaire de parc',
  DRIVER: 'Chauffeur',
}
type User = {
  id: string
  firstName: string
  lastName: string
  username: string
  role: UserRole
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  passwordChangedAt: string | null
  createdAt: string
  driverId: string | null
}
type Driver = { id: string; name: string; linkedUserId: string | null }
type Stats = {
  total: number
  active: number
  mustChangePassword: number
  roles: Partial<Record<UserRole, number>>
}
type FormData = {
  firstName: string
  lastName: string
  username: string
  role: UserRole
  isActive: boolean
  driverId: string
  password: string
  passwordConfirmation: string
}
const emptyForm: FormData = {
  firstName: '',
  lastName: '',
  username: '',
  role: UserRole.DISPATCHER,
  isActive: true,
  driverId: '',
  password: '',
  passwordConfirmation: '',
}

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [stats, setStats] = useState<Stats>({
    total: 0,
    active: 0,
    mustChangePassword: 0,
    roles: {},
  })
  const [search, setSearch] = useState(''),
    [roleFilter, setRoleFilter] = useState(''),
    [activeFilter, setActiveFilter] = useState(''),
    [passwordFilter, setPasswordFilter] = useState('')
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [mode, setMode] = useState<'create' | 'edit' | 'reset' | null>(null),
    [selected, setSelected] = useState<User | null>(null),
    [form, setForm] = useState<FormData>(emptyForm),
    [saving, setSaving] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<User | null>(null)
  const requestSequence = useRef(0)

  async function load() {
    const requestId = ++requestSequence.current
    setLoading(true)
    setError('')
    const query = new URLSearchParams()
    if (search) query.set('search', search)
    if (roleFilter) query.set('role', roleFilter)
    if (activeFilter) query.set('active', activeFilter)
    if (passwordFilter) query.set('mustChangePassword', passwordFilter)
    try {
      const response = await fetch(`/api/admin/users?${query}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Chargement impossible.')
      if (requestId === requestSequence.current) {
        setUsers(data.users)
        setDrivers(data.drivers)
        setStats(data.stats)
      }
    } catch (loadError) {
      if (requestId === requestSequence.current)
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Chargement impossible.'
        )
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }
  useEffect(() => {
    const timer = setTimeout(load, 250)
    return () => clearTimeout(timer)
  }, [search, roleFilter, activeFilter, passwordFilter])

  const kpis = useMemo(
    () => [
      ['Total utilisateurs', stats.total, '◎'],
      ['Utilisateurs actifs', stats.active, '●'],
      ['Administrateurs', stats.roles.ADMIN ?? 0, '◆'],
      ['Dispatchers', stats.roles.DISPATCHER ?? 0, '↗'],
      ['Secrétaires', stats.roles.SECRETARY ?? 0, '✦'],
      ['Gestionnaires de parc', stats.roles.PARK_MANAGER ?? 0, '⬡'],
      ['Chauffeurs', stats.roles.DRIVER ?? 0, '◉'],
      ['Changement requis', stats.mustChangePassword, '!'],
    ],
    [stats]
  )
  const hasFilters = Boolean(
    search || roleFilter || activeFilter || passwordFilter
  )
  function resetFilters() {
    setSearch('')
    setRoleFilter('')
    setActiveFilter('')
    setPasswordFilter('')
  }
  function openCreate() {
    setSelected(null)
    setForm(emptyForm)
    setError('')
    setMode('create')
  }
  function openEdit(user: User) {
    setSelected(user)
    setForm({
      ...emptyForm,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      role: user.role,
      isActive: user.isActive,
      driverId: user.driverId ?? '',
    })
    setError('')
    setMode('edit')
  }
  function openReset(user: User) {
    setSelected(user)
    setForm(emptyForm)
    setError('')
    setMode('reset')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    let url = '/api/admin/users',
      method = 'POST',
      body: Record<string, unknown> = { ...form }
    if (mode === 'edit') {
      url = `/api/admin/users/${selected!.id}`
      method = 'PATCH'
      body = {
        firstName: form.firstName,
        lastName: form.lastName,
        username: form.username,
        role: form.role,
        isActive: form.isActive,
        driverId: form.role === UserRole.DRIVER ? form.driverId : null,
      }
    }
    if (mode === 'reset') {
      url = `/api/admin/users/${selected!.id}/reset-password`
      body = {
        password: form.password,
        passwordConfirmation: form.passwordConfirmation,
      }
    }
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Opération impossible.')
      setMode(null)
      setNotice(
        mode === 'reset'
          ? 'Mot de passe temporaire enregistré. Le changement sera obligatoire à la prochaine connexion.'
          : 'Utilisateur enregistré. Le changement du mot de passe temporaire sera obligatoire.'
      )
      await load()
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Opération impossible.'
      )
    } finally {
      setSaving(false)
    }
  }
  async function confirmStatus() {
    if (!pendingStatus) return
    const user = pendingStatus
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          role: user.role,
          isActive: !user.isActive,
          driverId: user.driverId,
        }),
      })
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error ?? 'Modification impossible.')
      setPendingStatus(null)
      setNotice(
        user.isActive
          ? 'Compte désactivé et sessions invalidées.'
          : 'Compte réactivé.'
      )
      await load()
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : 'Modification impossible.'
      )
      setPendingStatus(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#eef0ea] px-4 py-5 text-[#171914] sm:px-7 lg:px-10">
      <div className="mx-auto max-w-[1600px]">
        <header className="rounded-[30px] bg-[#11130f] px-5 py-6 text-white shadow-[0_22px_60px_rgba(15,17,13,.2)] sm:px-7 sm:py-7">
          <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.28em] text-[#C8FF00]">
                GERARD · Centre de contrôle
              </p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
                Administration
              </h1>
              <p className="mt-2 text-sm text-white/60">
                Gestion des utilisateurs et des accès Gerard
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
              <button
                onClick={openCreate}
                className="h-11 flex-1 rounded-2xl bg-[#C8FF00] px-5 text-sm font-black text-black shadow-[0_10px_24px_rgba(200,255,0,.16)] transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white lg:flex-none"
              >
                ＋ Nouvel utilisateur
              </button>
              <a
                href="/dispatch"
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-black/[.07] bg-white px-5 text-sm font-bold text-[#11130f] no-underline shadow-[0_10px_24px_rgba(0,0,0,.16)] transition hover:-translate-y-0.5 hover:bg-[#f5f6f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8FF00] lg:flex-none"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 7h16M7 12h10M9 17h6" />
                </svg>
                Dispatch
              </a>
              <a
                href="/park"
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-black/[.07] bg-white px-5 text-sm font-bold text-[#11130f] no-underline shadow-[0_10px_24px_rgba(0,0,0,.16)] transition hover:-translate-y-0.5 hover:bg-[#f5f6f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8FF00] lg:flex-none"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 9h18M6 9V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M7 15h.01M17 15h.01M5 19v-4h14v4" />
                </svg>
                Parc
              </a>
              <LogoutButton tone="dark" />
            </div>
          </div>
        </header>

        <section
          aria-label="Indicateurs utilisateurs"
          className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8"
        >
          {kpis.map(([label, value, icon]) => (
            <article
              key={String(label)}
              className="rounded-[24px] border border-black/[.06] bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <p className="text-3xl font-semibold">{value}</p>
                <span className="text-[#87ad00]">{icon}</span>
              </div>
              <p className="mt-4 text-[9px] font-black uppercase tracking-[.14em] text-[#747a6f]">
                {label}
              </p>
            </article>
          ))}
        </section>

        <section className="mt-5 rounded-[30px] border border-black/[.06] bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 xl:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Rechercher</span>
              <span className="text-black/35 pointer-events-none absolute left-4 top-3">
                ⌕
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nom ou username…"
                className="h-12 w-full rounded-2xl border border-black/10 bg-[#f7f8f5] pl-10 pr-4 outline-none focus:border-[#8eb800]"
              />
            </label>
            <Select value={roleFilter} set={setRoleFilter}>
              <option value="">Tous les rôles</option>
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select value={activeFilter} set={setActiveFilter}>
              <option value="">Tous les statuts</option>
              <option value="true">Actifs</option>
              <option value="false">Inactifs</option>
            </Select>
            <Select value={passwordFilter} set={setPasswordFilter}>
              <option value="">Tous les mots de passe</option>
              <option value="true">Changement requis</option>
              <option value="false">À jour</option>
            </Select>
            <button
              disabled={!hasFilters}
              onClick={resetFilters}
              className="disabled:opacity-35 h-12 rounded-2xl border border-black/10 px-4 text-sm font-bold"
            >
              Réinitialiser
            </button>
          </div>
          {notice && <Banner tone="success">{notice}</Banner>}
          {error && !mode && <Banner tone="error">{error}</Banner>}
          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <span className="h-9 w-9 animate-spin rounded-full border-4 border-black/10 border-t-[#8eb800]" />
              <span className="sr-only">Chargement</span>
            </div>
          ) : users.length === 0 ? (
            <div className="py-20 text-center">
              <div className="text-4xl text-black/20">⌕</div>
              <h2 className="mt-4 text-lg font-semibold">
                Aucun utilisateur trouvé
              </h2>
              <p className="mt-1 text-sm text-[#747a6f]">
                Modifiez ou réinitialisez les filtres.
              </p>
            </div>
          ) : (
            <UserList
              users={users}
              onEdit={openEdit}
              onReset={openReset}
              onStatus={setPendingStatus}
            />
          )}
        </section>
      </div>

      {mode && (
        <Modal
          title={
            mode === 'create'
              ? 'Nouvel utilisateur'
              : mode === 'edit'
              ? 'Modifier l’utilisateur'
              : 'Réinitialiser le mot de passe'
          }
          close={() => setMode(null)}
        >
          <form onSubmit={submit}>
            {mode === 'reset' ? (
              <div className="space-y-4">
                <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
                  {selected?.firstName} devra changer ce mot de passe temporaire
                  à sa prochaine connexion. Toutes ses sessions seront
                  invalidées.
                </p>
                <Field
                  type="password"
                  label="Nouveau mot de passe temporaire"
                  value={form.password}
                  set={(value) => setForm({ ...form, password: value })}
                />
                <Field
                  type="password"
                  label="Confirmation"
                  value={form.passwordConfirmation}
                  set={(value) =>
                    setForm({ ...form, passwordConfirmation: value })
                  }
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Prénom"
                  value={form.firstName}
                  set={(value) => setForm({ ...form, firstName: value })}
                />
                <Field
                  label="Nom"
                  value={form.lastName}
                  set={(value) => setForm({ ...form, lastName: value })}
                />
                <Field
                  label="Username"
                  value={form.username}
                  set={(value) => setForm({ ...form, username: value })}
                />
                <label className="text-xs font-black uppercase tracking-wider text-[#6d7268]">
                  Rôle
                  <select
                    value={form.role}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        role: e.target.value as UserRole,
                        driverId:
                          e.target.value === UserRole.DRIVER
                            ? form.driverId
                            : '',
                      })
                    }
                    className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-sm normal-case tracking-normal"
                  >
                    {Object.entries(roleLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex h-12 items-center gap-3 self-end rounded-2xl bg-[#f2f4ef] px-4 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) =>
                      setForm({ ...form, isActive: e.target.checked })
                    }
                  />{' '}
                  Compte actif
                </label>
                {form.role === UserRole.DRIVER && (
                  <label className="text-xs font-black uppercase tracking-wider text-[#6d7268] sm:col-span-2">
                    Fiche chauffeur
                    <select
                      required
                      value={form.driverId}
                      onChange={(e) =>
                        setForm({ ...form, driverId: e.target.value })
                      }
                      className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-sm normal-case tracking-normal"
                    >
                      <option value="">Sélectionner une fiche existante</option>
                      {drivers
                        .filter(
                          (d) =>
                            !d.linkedUserId || d.linkedUserId === selected?.id
                        )
                        .map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.name}
                          </option>
                        ))}
                    </select>
                    <span className="mt-2 block font-medium normal-case tracking-normal text-[#8a5b00]">
                      Un compte Chauffeur ne peut pas être créé sans fiche
                      chauffeur disponible.
                    </span>
                  </label>
                )}
                {mode === 'create' && (
                  <>
                    <Field
                      type="password"
                      label="Mot de passe temporaire"
                      value={form.password}
                      set={(value) => setForm({ ...form, password: value })}
                    />
                    <Field
                      type="password"
                      label="Confirmation"
                      value={form.passwordConfirmation}
                      set={(value) =>
                        setForm({ ...form, passwordConfirmation: value })
                      }
                    />
                  </>
                )}
              </div>
            )}
            {mode === 'edit' && selected && (
              <div className="mt-5 grid gap-2 rounded-2xl bg-[#f2f4ef] p-4 text-xs text-[#676c63] sm:grid-cols-2">
                <span>Créé : {formatDate(selected.createdAt)}</span>
                <span>
                  Dernière connexion : {formatDate(selected.lastLoginAt)}
                </span>
                <span>
                  Mot de passe changé : {formatDate(selected.passwordChangedAt)}
                </span>
                <span>
                  Changement requis :{' '}
                  {selected.mustChangePassword ? 'Oui' : 'Non'}
                </span>
              </div>
            )}
            {error && <Banner tone="error">{error}</Banner>}
            <button
              disabled={saving}
              className="mt-6 h-12 w-full rounded-2xl bg-[#11130f] font-bold text-white transition hover:bg-[#C8FF00] hover:text-black disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Confirmer'}
            </button>
          </form>
        </Modal>
      )}
      {pendingStatus && (
        <Modal
          title={
            pendingStatus.isActive
              ? 'Désactiver ce compte ?'
              : 'Réactiver ce compte ?'
          }
          close={() => setPendingStatus(null)}
        >
          <p className="text-sm leading-6 text-[#686e64]">
            {pendingStatus.isActive
              ? `L’accès de ${pendingStatus.firstName} sera immédiatement bloqué et ses sessions invalidées. Les données historiques seront conservées.`
              : `L’accès de ${pendingStatus.firstName} sera de nouveau autorisé.`}
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              onClick={() => setPendingStatus(null)}
              className="h-12 rounded-2xl border border-black/10 font-bold"
            >
              Annuler
            </button>
            <button
              onClick={confirmStatus}
              disabled={saving}
              className="h-12 rounded-2xl bg-[#11130f] font-bold text-white"
            >
              Confirmer
            </button>
          </div>
        </Modal>
      )}
    </main>
  )
}

function UserList({
  users,
  onEdit,
  onReset,
  onStatus,
}: {
  users: User[]
  onEdit: (u: User) => void
  onReset: (u: User) => void
  onStatus: (u: User) => void
}) {
  return (
    <>
      <div className="mt-5 hidden overflow-hidden rounded-2xl border border-black/[.06] lg:block">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#f3f5f0] text-[9px] uppercase tracking-wider text-[#747a6f]">
            <tr>
              {[
                'Utilisateur',
                'Username',
                'Rôle',
                'Statut',
                'Dernière connexion',
                'Mot de passe',
                'Création',
                'Actions',
              ].map((label) => (
                <th key={label} className="px-3 py-4">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-black/[.06]">
                <td className="px-3 py-4 font-bold">{displayName(user)}</td>
                <td className="px-3 py-4 font-semibold">{user.username}</td>
                <td className="px-3 py-4">
                  <Badge>{roleLabels[user.role]}</Badge>
                </td>
                <td className="px-3 py-4">
                  <Badge tone={user.isActive ? 'green' : 'gray'}>
                    {user.isActive ? 'Actif' : 'Inactif'}
                  </Badge>
                </td>
                <td className="text-black/55 px-3 py-4">
                  {formatDate(user.lastLoginAt)}
                </td>
                <td className="px-3 py-4">
                  {user.mustChangePassword ? (
                    <Badge tone="amber">Requis</Badge>
                  ) : (
                    <span className="text-black/45">À jour</span>
                  )}
                </td>
                <td className="text-black/55 px-3 py-4">
                  {formatDate(user.createdAt)}
                </td>
                <td className="px-3 py-4">
                  <div className="flex flex-wrap gap-1.5">
                    <Action label="Modifier" onClick={() => onEdit(user)} />
                    <Action
                      label={user.isActive ? 'Désactiver' : 'Réactiver'}
                      onClick={() => onStatus(user)}
                    />
                    <Action
                      label="Réinitialiser"
                      onClick={() => onReset(user)}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-5 grid gap-3 lg:hidden">
        {users.map((user) => (
          <article
            key={user.id}
            className="rounded-[24px] border border-black/[.07] p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate font-bold">{displayName(user)}</h2>
                <p className="mt-1 break-all text-xs text-black/40">
                  {user.username}
                </p>
              </div>
              <Badge tone={user.isActive ? 'green' : 'gray'}>
                {user.isActive ? 'Actif' : 'Inactif'}
              </Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge>{roleLabels[user.role]}</Badge>
              {user.mustChangePassword && (
                <Badge tone="amber">Changement requis</Badge>
              )}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-black/40">Dernière connexion</dt>
                <dd className="mt-1 font-semibold">
                  {formatDate(user.lastLoginAt)}
                </dd>
              </div>
              <div>
                <dt className="text-black/40">Création</dt>
                <dd className="mt-1 font-semibold">
                  {formatDate(user.createdAt)}
                </dd>
              </div>
            </dl>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <Action label="Modifier" onClick={() => onEdit(user)} />
              <Action
                label={user.isActive ? 'Désactiver' : 'Réactiver'}
                onClick={() => onStatus(user)}
              />
              <Action label="Reset MDP" onClick={() => onReset(user)} />
            </div>
          </article>
        ))}
      </div>
    </>
  )
}
function Modal({
  title,
  close,
  children,
}: {
  title: string
  close: () => void
  children: ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-[30px] bg-white p-6 shadow-2xl sm:rounded-[30px] sm:p-8"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[.2em] text-[#86ad00]">
              Gestion des accès
            </p>
            <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
          </div>
          <button
            onClick={close}
            className="h-10 w-10 rounded-full bg-black/[.05] text-xl"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}
function Field({
  label,
  value,
  set,
  type = 'text',
}: {
  label: string
  value: string
  set: (v: string) => void
  type?: string
}) {
  return (
    <label className="text-xs font-black uppercase tracking-wider text-[#6d7268]">
      {label}
      <input
        required
        type={type}
        value={value}
        autoComplete={type === 'password' ? 'new-password' : undefined}
        onChange={(e) => set(e.target.value)}
        className="mt-2 h-12 w-full rounded-2xl border border-black/10 px-4 text-sm normal-case tracking-normal outline-none focus:border-[#8eb800]"
      />
    </label>
  )
}
function Select({
  value,
  set,
  children,
}: {
  value: string
  set: (v: string) => void
  children: ReactNode
}) {
  return (
    <select
      aria-label="Filtre"
      value={value}
      onChange={(e) => set(e.target.value)}
      className="h-12 min-w-0 rounded-2xl border border-black/10 bg-white px-4 text-sm"
    >
      {children}
    </select>
  )
}
function Badge({
  children,
  tone = 'dark',
}: {
  children: ReactNode
  tone?: 'dark' | 'green' | 'amber' | 'gray'
}) {
  const style = {
    dark: 'bg-[#171914] text-white',
    green: 'bg-lime-100 text-lime-800',
    amber: 'bg-amber-100 text-amber-900',
    gray: 'bg-black/[.06] text-black/55',
  }[tone]
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wide ${style}`}
    >
      {children}
    </span>
  )
}
function Action({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="min-h-[36px] rounded-xl bg-black/[.05] px-2.5 text-[10px] font-bold transition hover:bg-[#C8FF00]"
    >
      {label}
    </button>
  )
}
function Banner({
  children,
  tone,
}: {
  children: ReactNode
  tone: 'success' | 'error'
}) {
  return (
    <p
      className={`mt-4 rounded-2xl px-4 py-3 text-sm font-semibold ${
        tone === 'success'
          ? 'bg-lime-50 text-lime-900'
          : 'bg-red-50 text-red-800'
      }`}
    >
      {children}
    </p>
  )
}
function displayName(user: User) {
  return (
    `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.username
  )
}
function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : 'Jamais'
}

export const getServerSideProps: GetServerSideProps = async ({ req }) => {
  const user = await getCurrentUser(req)
  if (!user) return { redirect: { destination: '/login', permanent: false } }
  if (!user.isActive)
    return { redirect: { destination: '/login', permanent: false } }
  if (user.mustChangePassword)
    return { redirect: { destination: '/change-password', permanent: false } }
  if (user.role !== UserRole.ADMIN)
    return { redirect: { destination: '/dispatch', permanent: false } }
  return { props: {} }
}
