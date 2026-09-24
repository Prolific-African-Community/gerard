import type { GetServerSideProps } from 'next'
import { FormEvent, useEffect, useState } from 'react'

import { LogoutButton } from '../../components/site/LogoutButton'
import { getCurrentUser } from '../../lib/auth/authorization'

const roles = ['ORG_ADMIN', 'MANAGER', 'DISPATCHER', 'SECRETARY', 'ACCOUNTING', 'DRIVER', 'VIEWER'] as const
type Member = { id: string; role: string; user: { firstName: string; lastName: string; username: string; email: string | null; isActive: boolean; mustChangePassword: boolean } }
type Organization = { id: string; name: string; slug: string; status: string; enabledModules: string[]; displayName: string | null; applicationTitle: string | null; accentColor: string | null; users: Member[] }

export default function OrganizationAdminPage({ accessDenied = false, platformAdmin = false }: { accessDenied?: boolean; platformAdmin?: boolean }) {
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [form, setForm] = useState({ firstName: '', lastName: '', username: '', email: '', role: 'VIEWER' })

  async function load() {
    const response = await fetch('/api/admin/organization')
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Chargement impossible')
    setOrganization(body.organization)
  }
  useEffect(() => { if (!accessDenied) void load().catch((cause) => setError(cause.message)) }, [accessDenied])

  async function request(url: string, init: RequestInit) {
    setError(''); setNotice('')
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Opération impossible')
    await load()
    return body
  }

  async function addMember(event: FormEvent) {
    event.preventDefault()
    try {
      const body = await request('/api/admin/organization/members', { method: 'POST', body: JSON.stringify(form) })
      setTemporaryPassword(body.temporaryPassword)
      setNotice('Membre créé. Copiez le mot de passe temporaire maintenant : il ne sera plus affiché.')
      setForm({ firstName: '', lastName: '', username: '', email: '', role: 'VIEWER' })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Création impossible') }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault()
    if (!organization) return
    try {
      await request('/api/admin/organization', { method: 'PATCH', body: JSON.stringify({ name: organization.name, displayName: organization.displayName, applicationTitle: organization.applicationTitle, accentColor: organization.accentColor }) })
      setNotice('Paramètres de l’organisation enregistrés.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Enregistrement impossible') }
  }

  if (accessDenied) return <main className="flex min-h-screen items-center justify-center bg-[#eef0ea] p-6"><section className="max-w-lg rounded-3xl bg-[#11130f] p-8 text-white"><h1 className="text-3xl font-semibold">Accès interdit</h1><p className="mt-3 text-white/60">Cette zone est réservée aux ORG_ADMIN de l’organisation active.</p><a className="mt-6 inline-flex rounded-xl bg-white px-4 py-3 font-bold text-black" href="/dispatch">Retour au dispatch</a></section></main>

  return <main className="min-h-screen bg-[#eef0ea] px-4 py-6 text-[#171914]"><div className="mx-auto max-w-6xl">
    <header className="rounded-[30px] bg-[#11130f] p-7 text-white"><p className="text-xs font-black uppercase tracking-[.25em] text-[#C8FF00]">Organisation</p><h1 className="mt-2 text-4xl font-semibold">Administration de {organization?.displayName || organization?.name || 'votre organisation'}</h1><div className="mt-5 flex gap-2"><a href="/dispatch" className="rounded-xl bg-white/10 px-4 py-3 text-sm font-bold">Dispatch</a>{platformAdmin && <a href="/admin" className="rounded-xl bg-[#C8FF00] px-4 py-3 text-sm font-bold text-black">Administration plateforme</a>}<LogoutButton tone="dark" /></div></header>
    {error && <p className="mt-4 rounded-2xl bg-red-100 p-4 text-red-900">{error}</p>}{notice && <p className="mt-4 rounded-2xl bg-lime-100 p-4 text-lime-950">{notice}</p>}
    {temporaryPassword && <section className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4"><p className="text-sm font-bold">Mot de passe temporaire (affiché une seule fois)</p><code className="mt-2 block break-all rounded-xl bg-white p-3">{temporaryPassword}</code><button className="mt-3 text-sm font-bold" onClick={() => setTemporaryPassword('')}>J’ai copié le mot de passe</button></section>}
    {organization && <><section className="mt-5 grid gap-4 md:grid-cols-2"><form onSubmit={saveSettings} className="rounded-3xl bg-white p-6"><h2 className="text-xl font-semibold">Paramètres</h2><p className="mt-2 text-xs text-[#777]">/{organization.slug} · {organization.status}</p><div className="mt-4 space-y-3">{([['name', 'Nom'], ['displayName', 'Nom affiché'], ['applicationTitle', 'Titre de l’application'], ['accentColor', 'Couleur accent']] as const).map(([field, label]) => <label key={field} className="block text-xs font-bold">{label}<input value={organization[field] || ''} onChange={(event) => setOrganization({ ...organization, [field]: event.target.value || null })} className="mt-1 w-full rounded-xl border p-3 text-sm font-normal" /></label>)}</div><button className="mt-4 rounded-xl bg-black px-4 py-3 text-sm font-bold text-white">Enregistrer</button></form><article className="rounded-3xl bg-white p-6"><h2 className="text-xl font-semibold">Accès et modules</h2><p className="mt-3 text-sm text-[#6f756b]">Les rôles organisation contrôlent les permissions métier. Aucun rôle plateforme ne peut être attribué ici.</p><p className="mt-4 text-sm">Modules actifs : {organization.enabledModules.join(', ')}</p><p className="mt-3 text-xs text-[#777]">Les modules sont pilotés par la plateforme et sont en lecture seule.</p></article></section>
    <section className="mt-5 rounded-3xl bg-white p-6"><h2 className="text-2xl font-semibold">Membres</h2><div className="mt-4 space-y-3">{organization.users.map((membership) => <div key={membership.id} className="flex flex-col gap-3 rounded-2xl bg-[#f5f6f2] p-4 sm:flex-row sm:items-center"><div className="flex-1"><p className="font-semibold">{membership.user.firstName} {membership.user.lastName}</p><p className="text-xs text-[#747a6f]">{membership.user.email || membership.user.username} · {membership.user.isActive ? 'Actif' : 'Inactif'}{membership.user.mustChangePassword ? ' · changement de mot de passe requis' : ''}</p></div><select value={membership.role} onChange={(event) => void request(`/api/admin/organization/members/${membership.id}`, { method: 'PATCH', body: JSON.stringify({ role: event.target.value }) }).catch((cause) => setError(cause.message))} className="rounded-xl border p-2">{roles.map((role) => <option key={role}>{role}</option>)}</select></div>)}</div>
      <form onSubmit={addMember} className="mt-6 grid gap-3 rounded-2xl border p-4 sm:grid-cols-2"><h3 className="sm:col-span-2 font-semibold">Créer un membre</h3>{(['firstName', 'lastName', 'username', 'email'] as const).map((field) => <input key={field} required={field !== 'email'} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} placeholder={{ firstName: 'Prénom', lastName: 'Nom', username: 'Username', email: 'Email (optionnel)' }[field]} className="rounded-xl border p-3" />)}<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className="rounded-xl border p-3">{roles.map((role) => <option key={role}>{role}</option>)}</select><button className="rounded-xl bg-black p-3 font-bold text-white">Créer avec mot de passe temporaire</button></form>
    </section></>}
  </div></main>
}

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const user = await getCurrentUser(req)
  if (!user || user.organizationRole !== 'ORG_ADMIN' || !user.isActive || user.mustChangePassword) { res.statusCode = 403; return { props: { accessDenied: true } } }
  return { props: { platformAdmin: Boolean(user.platformRole) } }
}
