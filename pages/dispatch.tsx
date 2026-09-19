import { UserRole } from '@prisma/client'
import type { GetServerSideProps } from 'next'
import { useEffect, useState } from 'react'

import { MobileDispatchView } from '../components/dispatch/mobile/MobileDispatchView'
import { WeeklyDispatchBoard } from '../components/dispatch/WeeklyDispatchBoard'
import type { ViewMode } from '../components/dispatch/WeeklyDispatchBoard'
import { SiteHeader } from '../components/site/SiteHeader'
import { getCurrentUser } from '../lib/auth/authorization'
import { getDispatchCapabilities, hasPermission, permissions } from '../lib/auth/permissions'
import type { DispatchCapabilities } from '../lib/auth/dispatch-capabilities'
import { buildParkOverview } from '../lib/park/service'
import type { ParkOverviewDTO } from '../lib/park/types'

type DispatchPageProps = {
  displayName: string
  capabilities: DispatchCapabilities
  initialView: ViewMode
  initialParkOverview: ParkOverviewDTO | null
  isAdmin: boolean
}

export default function DispatchPage({
  displayName,
  capabilities,
  initialView,
  initialParkOverview,
  isAdmin,
}: DispatchPageProps) {
  const isMobile = useIsMobile()
  const appLinks: ReadonlyArray<readonly [string, string]> = isAdmin
    ? [['Administration', '/admin']]
    : []

  if (isMobile) {
    return (
      <main className="min-h-screen bg-[#F4F5F1] text-[#171814]">
        <style>{`body{display:block!important;}`}</style>
        <MobileDispatchView
          displayName={displayName}
          capabilities={capabilities}
          initialView={initialView}
          initialParkOverview={initialParkOverview}
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

  const canViewPlanning = hasPermission(user, permissions.dispatchView)
  const canViewPark = hasPermission(user, permissions.parkView)
  if (!canViewPlanning && !canViewPark) {
    return { redirect: { destination: '/login', permanent: false } }
  }

  const requestedView = Array.isArray(query.view) ? query.view[0] : query.view
  const allowedViews: ViewMode[] = [
    ...(canViewPlanning ? (['planning'] as const) : []),
    ...(hasPermission(user, permissions.mapView) ? (['map'] as const) : []),
    ...(hasPermission(user, permissions.profitabilityView)
      ? (['profitability'] as const)
      : []),
    ...(hasPermission(user, permissions.invoicesView)
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
      capabilities: getDispatchCapabilities(user.role),
      initialView,
      initialParkOverview: canViewPark
        ? await buildParkOverview(user.role)
        : null,
      isAdmin: user.role === UserRole.ADMIN,
    },
  }
}
