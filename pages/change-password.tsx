import type { GetServerSideProps } from 'next'
import { useRouter } from 'next/router'
import { FormEvent, useState } from 'react'
import { getCurrentUser, homeForRole } from '../lib/auth/authorization'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('')
    const response = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword, newPasswordConfirmation: confirmation }) })
    const data = await response.json()
    setLoading(false)
    if (!response.ok) return setError(data.error ?? 'Impossible de modifier le mot de passe.')
    await router.push(data.redirectTo)
  }
  return <main className="flex min-h-screen items-center justify-center bg-[#F4F5F1] px-5 text-[#171814]">
    <section className="w-full max-w-lg rounded-[32px] border border-black/10 bg-white p-6 shadow-[0_24px_80px_rgba(17,18,15,.12)] sm:p-9">
      <img src="/logo_gerard_texte.png" alt="Gerard" className="h-10 w-auto" />
      <p className="mt-8 text-[10px] font-bold uppercase tracking-[.22em] text-[#73796d]">Sécurisation du compte</p>
      <h1 className="mt-2 text-3xl font-semibold">Choisir un nouveau mot de passe</h1>
      <p className="mt-3 text-sm text-[#6d7268]">12 caractères minimum, avec majuscule, minuscule, chiffre et symbole.</p>
      <form onSubmit={submit} className="mt-7 space-y-4">
        {[['Mot de passe temporaire', currentPassword, setCurrentPassword, 'current-password'], ['Nouveau mot de passe', newPassword, setNewPassword, 'new-password'], ['Confirmation', confirmation, setConfirmation, 'new-password']].map(([label, value, setter, auto]) => <label key={label as string} className="block text-xs font-bold uppercase tracking-wider text-[#656b61]">{label as string}<input required type="password" autoComplete={auto as string} value={value as string} onChange={e => (setter as (v:string)=>void)(e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-black/10 px-4 text-sm normal-case tracking-normal outline-none focus:border-[#93bd00]" /></label>)}
        {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
        <button disabled={loading} className="h-12 w-full rounded-2xl bg-[#11130f] font-semibold text-white hover:bg-[#C8FF00] hover:text-black disabled:opacity-50">{loading ? 'Enregistrement…' : 'Enregistrer le mot de passe'}</button>
      </form>
    </section>
  </main>
}

export const getServerSideProps: GetServerSideProps = async ({ req }) => {
  const user = await getCurrentUser(req)
  if (!user || !user.isActive) return { redirect: { destination: '/login', permanent: false } }
  if (!user.mustChangePassword) return { redirect: { destination: homeForRole(user.role), permanent: false } }
  return { props: {} }
}
