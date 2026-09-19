import { useEffect } from 'react'
import Head from 'next/head'
import GerardHero, { DEMO_HREF, Wordmark } from '../components/home/GerardHero'
import GerardWorkflow from '../components/home/GerardWorkflow'
import { GerardCta, GerardFaq } from '../components/home/GerardClosing'
import GerardContact from '../components/home/GerardContact'
import s from '../components/home/GerardHome.module.css'

const MODULES = [
  'Demandes clients',
  'Missions',
  'Planning dispatch',
  'Chauffeurs',
  'Camions & remorques',
  'Suivi',
  'Carte',
  'Rentabilité',
  'Facturation',
  'Parc',
] as const

export default function GerardHome() {
  // Smooth in-page anchors (#film, #workflow, #contact) on the homepage only.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    root.style.scrollBehavior = 'smooth'
    return () => {
      root.style.scrollBehavior = ''
    }
  }, [])

  return (
    <>
      <Head>
        <title>Gerard — Quand tout roule. Pour de vrai.</title>
        <meta
          name="description"
          content="Gerard, le dispatch des entreprises de transport : demandes, missions, planning, chauffeurs, camions, remorques, suivi et facturation sur un seul écran."
        />
        <meta name="theme-color" content="#f3f3ee" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div className={s.page}>
        <header className={s.nav}>
          <a href="/" className={s.navLogo}>
            <Wordmark />
          </a>
          <nav className={s.navLinks}>
            <a href="#film">Le film</a>
            <a href="#workflow">Le workflow</a>
            <a href={DEMO_HREF}>Démo</a>
          </nav>
          <div className={s.navRight}>
            <a href="/login" className={s.navLogin}>
              Connexion
            </a>
            <a href={DEMO_HREF} className={s.navCta}>
              Demander une démo
            </a>
          </div>
        </header>

        <main>
          <GerardHero />

          <GerardWorkflow />

          <div className={s.strip} id="modules" aria-label="Modules Gerard">
            <div className={s.stripTrack}>
              {[...MODULES, ...MODULES].map((m, i) => (
                <span key={i} aria-hidden={i >= MODULES.length}>
                  {m}
                </span>
              ))}
            </div>
          </div>

          <GerardCta demoHref={DEMO_HREF} />

          <GerardFaq demoHref={DEMO_HREF} />

          <GerardContact />
        </main>

        <footer className={s.footer}>
          <Wordmark />
          <span>Gardez le contrôle. Pas tout en tête.</span>
        </footer>
      </div>
    </>
  )
}
