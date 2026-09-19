'use client'

type LogoutButtonProps = {
  className?: string
  tone?: 'dark' | 'light'
}

export function LogoutButton({
  className = '',
  tone = 'light',
}: LogoutButtonProps) {
  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
    window.location.href = '/login'
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      aria-label="Déconnexion"
      title="Déconnexion"
      className={[
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8FF00] focus-visible:ring-offset-2',
        tone === 'dark'
          ? 'border-white/15 bg-white/10 text-white shadow-[0_10px_24px_rgba(0,0,0,.16)] hover:-translate-y-0.5 hover:bg-white hover:text-[#11130f]'
          : 'hover:border-black/15 border-black/[.07] bg-white text-[#11130f] shadow-[0_10px_24px_rgba(17,18,15,.07)] hover:-translate-y-0.5 hover:bg-[#f8f9f5]',
        className,
      ].join(' ')}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-[18px] w-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
        <path d="M21 19V5" />
      </svg>
    </button>
  )
}
