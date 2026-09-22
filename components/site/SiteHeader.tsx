'use client'

import { useEffect, useState } from 'react'
import { LogoutButton } from './LogoutButton'
import { OrganizationLogo } from '../branding/OrganizationLogo'

type ClassValue = string | false | null | undefined

type SiteHeaderProps = {
  activeHref?: string
  ctaHref?: string
  ctaLabel?: string
  userGreeting?: string
  /** Liens applicatifs internes (label, href) affichés en mode connecté. */
  appLinks?: ReadonlyArray<readonly [string, string]>
}

const navLinks = [
  ['Accueil', '/'],
  ['Transport', '/#transport'],
  ['Stockage SED-X', '/#stockage'],
  ['Dashboard', '/dispatch'],
] as const

function cn(...classes: ClassValue[]) {
  return classes.filter(Boolean).join(' ')
}

export function SiteHeader({
  activeHref = '/',
  ctaHref = '/',
  ctaLabel = 'Accueil Gerard',
  userGreeting,
  appLinks,
}: SiteHeaderProps) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const isLogoutCta = /logout|déconnexion|deconnexion/i.test(ctaLabel)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'fixed top-0 z-20 w-full transition-all duration-300',
        isLogoutCta ? 'px-3 sm:px-5' : 'px-5 md:px-10',
        scrolled ? 'pt-0' : 'pt-2'
      )}
    >
      <nav
        className={cn(
          'mx-auto flex w-full items-center justify-between border border-black/5 transition-all duration-300',
          scrolled
            ? 'hidden'
            : isLogoutCta
            ? 'px-2 py-3 sm:px-3'
            : 'px-6 py-3 md:px-12'
        )}
      >
        <a href="/" className="flex shrink-0 items-center no-underline">
          <OrganizationLogo
            className={cn(
              'w-auto object-contain transition-all duration-300',
              scrolled ? 'h-8 md:h-9' : 'h-9 md:h-10'
            )}
          />
        </a>

        {isLogoutCta ? (
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            {appLinks && appLinks.length > 0 ? (
              <nav
                aria-label="Navigation applicative"
                className="flex items-center gap-1.5"
              >
                {appLinks.map(([label, href]) => (
                  <a
                    key={href}
                    href={href}
                    aria-current={activeHref === href ? 'page' : undefined}
                    className={cn(
                      'inline-flex items-center rounded-full px-3 py-2 text-xs font-black uppercase tracking-wide no-underline transition',
                      activeHref === href
                        ? 'bg-[#11130f] text-white'
                        : 'bg-black/[.05] text-[#171914] hover:bg-[var(--brand-accent)] hover:text-black'
                    )}
                  >
                    {label}
                  </a>
                ))}
              </nav>
            ) : null}
            {userGreeting ? (
              <p className="max-w-[180px] truncate text-right text-xs font-medium text-[#747a6f] sm:max-w-none sm:text-sm">
                {userGreeting}
              </p>
            ) : null}
            <LogoutButton />
          </div>
        ) : (
          <a
            href={ctaHref}
            className="group shrink-0 items-center gap-4 rounded-full bg-[#070807] px-5 py-3 text-[9px] text-sm font-black text-white no-underline transition hover:bg-[var(--brand-accent)] hover:text-black lg:inline-flex xl:px-6"
          >
            {ctaLabel}
          </a>
        )}

        {!isLogoutCta ? (
          <button
            type="button"
            onClick={() => setMenuOpen((isOpen) => !isOpen)}
            className="inline-flex items-center justify-center border border-zinc-300 bg-white p-3 text-black transition hover:border-black lg:hidden"
            aria-label="Ouvrir le menu"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              {menuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        ) : null}
      </nav>

      {menuOpen ? (
        <div className="mx-auto w-full border-x border-b border-black/5 bg-white px-6 py-6 shadow-[0_18px_60px_rgba(0,0,0,0.08)] lg:hidden">
          <div className="flex flex-col gap-5 text-sm font-black uppercase tracking-[0.2em]">
            {navLinks.map(([label, href]) => (
              <a
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className="text-black no-underline"
              >
                {label}
              </a>
            ))}

            {!isLogoutCta ? (
              <a
                href={ctaHref}
                onClick={() => setMenuOpen(false)}
                className="mt-4 inline-flex justify-center bg-[#070807] px-6 py-4 text-white no-underline transition hover:bg-[var(--brand-accent)] hover:text-black"
              >
                {ctaLabel} ↗
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  )
}
