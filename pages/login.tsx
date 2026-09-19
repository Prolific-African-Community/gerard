import { useRouter } from 'next/router'
import type { FormEvent } from 'react'
import { useState } from 'react'

type LoginResponse = {
  ok: boolean
  redirectTo?: string
}

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!username.trim() || !password) {
      setError('Identifiants incorrects.')
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      })

      if (!response.ok) {
        throw new Error('Invalid credentials')
      }

      const result = (await response.json()) as LoginResponse
      await router.push(result.redirectTo ?? '/dispatch')
    } catch (loginError) {
      console.error('Unable to login', loginError)
      setError('Identifiants incorrects.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F4F5F1] px-5 text-[#171814]">
      <section className="w-full max-w-[460px] rounded-[34px] border border-black/10 bg-white p-6 shadow-[0_24px_80px_rgba(17,18,15,0.12)] sm:p-8">
        <div>
          <img
            src="/logo_gerard_texte.png"
            alt="Gerard"
            className="h-10 w-auto object-contain"
          />
          <p className="mt-8 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#73796d]">
            Accès Gerard
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#11120f]">
            Gerard Dispatch
          </h1>
          <p className="mt-2 text-sm font-medium text-[#747a6f]">
            Connectez-vous pour accéder à votre espace.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Nom d’utilisateur
            </span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition placeholder:text-[#9aa090] focus:border-lime-300 focus:bg-white focus:ring-4"
              placeholder="jerome"
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Mot de passe
            </span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="focus:ring-lime-200/35 mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition placeholder:text-[#9aa090] focus:border-lime-300 focus:bg-white focus:ring-4"
              placeholder="••••••••"
              type="password"
            />
          </label>

          {error ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="h-12 w-full rounded-2xl bg-[#11130f] px-4 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(17,18,15,0.15)] transition hover:bg-[#C8FF00] hover:text-black disabled:cursor-not-allowed disabled:bg-black/20 disabled:text-white"
          >
            {isSubmitting ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>
      </section>
    </main>
  )
}
