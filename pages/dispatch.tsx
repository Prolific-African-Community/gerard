import { UserRole } from '@prisma/client'
import type { GetServerSideProps } from 'next'
import { useEffect, useState } from 'react'

import { MobileDispatchView } from '../components/dispatch/mobile/MobileDispatchView'
import { WeeklyDispatchBoard } from '../components/dispatch/WeeklyDispatchBoard'
import type { ViewMode } from '../components/dispatch/WeeklyDispatchBoard'
import { SiteHeader } from '../components/site/SiteHeader'
import { resolveApplicationNavigation } from '@prolific/gerard-core'
import { useGerardApplication } from '@prolific/gerard-core/react'
import { getCurrentUser, runWithCurrentOrganization } from '../lib/auth/authorization'
import { getDispatchCapabilitiesForUser } from '../lib/auth/permissions'
import type { DispatchCapabilities } from '../lib/auth/dispatch-capabilities'
import { buildParkOverview } from '../lib/park/service'
import type { ParkOverviewDTO } from '../lib/park/types'

type DispatchPageProps = {
  displayName: string
  capabilities: DispatchCapabilities
  initialView: ViewMode
  initialParkOverview: ParkOverviewDTO | null
  isAdmin: boolean
  googleMapsBrowserKey: string | null
}

export default function DispatchPage({
  displayName,
  capabilities,
  initialView,
  initialParkOverview,
  isAdmin,
  googleMapsBrowserKey,
}: DispatchPageProps) {
  const isMobile = useIsMobile()
  const application = useGerardApplication()
  const extensionLinks = resolveApplicationNavigation(application, capabilities)
    .map((item) => [item.label, item.href] as const)
  const appLinks: ReadonlyArray<readonly [string, string]> = [
    ...(isAdmin ? ([['Administration', '/admin']] as const) : []),
    ...extensionLinks,
  ]

  if (isMobile) {
    return (
      <main className="min-h-screen bg-[#F4F5F1] text-[#171814]">
        <style>{`body{display:block!important;}`}</style>
        <MobileDispatchView
          displayName={displayName}
          capabilities={capabilities}
          initialView={initialView}
          initialParkOverview={initialParkOverview}
          googleMapsBrowserKey={googleMapsBrowserKey}
        />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#F4F5F1] text-[#171814]">
      <style>{`body{display:block!important;}`}</style>
      <SiteHeader
        activeHref="/dispatch"
        ctaLabel="Logout"
        userGreeting={`Bonjour, ${displayName}`}
        appLinks={appLinks}
      />

      <div className="mx-auto flex min-h-screen max-w-[1920px] flex-col px-5 pt-28">
        <WeeklyDispatchBoard
          capabilities={capabilities}
          initialView={initialView}
          initialParkOverview={initialParkOverview}
          googleMapsBrowserKey={googleMapsBrowserKey}
        />
      </div>
    </main>
  )
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')

    function handleChange() {
      setIsMobile(mediaQuery.matches)
    }

    handleChange()
    mediaQuery.addEventListener('change', handleChange)

    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return isMobile
}

export const getServerSideProps: GetServerSideProps = async ({ req, query }) => {
  const user = await getCurrentUser(req)
  if (!user || !user.isActive) {
    return {
      redirect: {
        destination: '/login',
        permanent: false,
      },
    }
  }

  if (user.role === 'DRIVER') {
    return { redirect: { destination: '/driver', permanent: false } }
  }

  if (user.mustChangePassword) {
    return { redirect: { destination: '/change-password', permanent: false } }
  }

  const capabilities = getDispatchCapabilitiesForUser(user)
  const canViewPlanning = capabilities.canViewPlanning
  const canViewPark = capabilities.canViewPark
  if (!canViewPlanning && !canViewPark) {
    return { redirect: { destination: '/login', permanent: false } }
  }

  const requestedView = Array.isArray(query.view) ? query.view[0] : query.view
  const allowedViews: ViewMode[] = [
    ...(canViewPlanning ? (['planning'] as const) : []),
    ...(capabilities.canViewMap ? (['map'] as const) : []),
    ...(capabilities.canViewProfitability
      ? (['profitability'] as const)
      : []),
    ...(capabilities.canViewInvoices
      ? (['invoices'] as const)
      : []),
    ...(canViewPark ? (['park'] as const) : []),
  ]
  const initialView = allowedViews.includes(requestedView as ViewMode)
    ? (requestedView as ViewMode)
    : allowedViews[0]

  if (user.role === UserRole.PARK_MANAGER && requestedView !== 'park') {
    return {
      redirect: { destination: '/dispatch?view=park', permanent: false },
    }
  }

  return {
    props: {
      displayName: user.firstName.trim() || user.username,
      capabilities,
      initialView,
      initialParkOverview: canViewPark
        ? await runWithCurrentOrganization(user, () => buildParkOverview(user.role))
        : null,
      isAdmin: Boolean(user.platformRole),
      googleMapsBrowserKey: getRuntimeGoogleMapsBrowserKey(),
    },
  }
}

function getRuntimeGoogleMapsBrowserKey() {
  // Dynamic lookup is intentional: Next inlines static NEXT_PUBLIC references
  // at build time, while Vercel also exposes this public key to SSR at runtime.
  const envName = ['NEXT', 'PUBLIC', 'GOOGLE', 'MAPS', 'BROWSER', 'KEY'].join('_')
  return process.env[envName]?.trim() || null
}
