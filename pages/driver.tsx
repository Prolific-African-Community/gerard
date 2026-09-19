import type { GetServerSideProps } from 'next'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getCurrentUser } from '../lib/auth/authorization'
import { DriverActivityPanel } from '../components/driver/DriverActivityPanel'

type DriverMissionStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'ISSUE'
  | 'CANCELLED'

type DriverTruckStatus =
  | 'AVAILABLE'
  | 'ASSIGNED'
  | 'EN_ROUTE_TO_PICKUP'
  | 'AT_PICKUP'
  | 'ON_MISSION'
  | 'RETURNING_TO_BASE'
  | 'AT_BASE'
  | 'IN_MAINTENANCE'
  | 'MAINTENANCE_EXT'
  | 'OUT_OF_SERVICE'

type DriverOverview = {
  driver: {
    id: string
    name: string
    phone?: string | null
    status: string
  }
  truck: {
    id: string
    plateNumber: string
    brand?: string | null
    model?: string | null
    status: DriverTruckStatus
  } | null
  trailer: {
    id: string
    plateNumber: string
    type: string
    status: string
  } | null
  activeMission: DriverMission | null
  upcomingMissions: DriverMission[]
}

type DriverMission = {
  id: string
  assignmentId: string
  reference: string
  clientName: string
  pickupCity: string
  pickupAddress?: string | null
  pickupLat?: number | null
  pickupLng?: number | null
  deliveryCity: string
  deliveryAddress?: string | null
  deliveryLat?: number | null
  deliveryLng?: number | null
  pickupDate?: string | null
  deliveryDate?: string | null
  scheduledDate: string
  status: DriverMissionStatus
  clientReference?: string | null
  requiredTruckType?: string | null
  priceAmount?: number | null
  priceCurrency?: string | null
  paymentTerms?: string | null
  preAnnouncementRequired?: boolean
  preAnnouncementSent?: boolean
  notes?: string | null
  requirements?: Record<string, unknown> | null
  contacts?: Record<string, unknown> | null
  billingInfo?: Record<string, unknown> | null
  routeDistanceMeters?: number | null
  routeDurationSeconds?: number | null
}

type DriverPageProps = {
  username: string
}

type DriverAction =
  | 'START_MISSION'
  | 'ARRIVE_PICKUP'
  | 'START_DELIVERY'
  | 'COMPLETE_MISSION'
  | 'REPORT_ISSUE'

type LocationSharingStatus =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'unsupported'
  | 'error'

const missionStatusLabels: Record<DriverMissionStatus, string> = {
  PENDING: 'À planifier',
  ASSIGNED: 'Assignée',
  IN_PROGRESS: 'En cours',
  DONE: 'Terminée',
  ISSUE: 'Problème',
  CANCELLED: 'Annulée',
}

const truckStatusLabels: Record<DriverTruckStatus, string> = {
  AVAILABLE: 'Disponible',
  ASSIGNED: 'Affecté',
  EN_ROUTE_TO_PICKUP: 'Vers pickup',
  AT_PICKUP: 'Au pickup',
  ON_MISSION: 'En mission',
  RETURNING_TO_BASE: 'Retour base',
  AT_BASE: 'À la base',
  IN_MAINTENANCE: 'Maintenance à la base',
  MAINTENANCE_EXT: 'Maintenance extérieure',
  OUT_OF_SERVICE: 'Hors service',
}

const locationPostIntervalMs = 10000
const geolocationOptions: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 10000,
  timeout: 15000,
}

export const getServerSideProps: GetServerSideProps<DriverPageProps> = async ({
  req,
}) => {
  const sessionUser = await getCurrentUser(req)

  if (!sessionUser || !sessionUser.isActive) {
    return {
      redirect: {
        destination: '/login',
        permanent: false,
      },
    }
  }

  if (sessionUser.mustChangePassword) {
    return { redirect: { destination: '/change-password', permanent: false } }
  }

  if (sessionUser.role !== 'DRIVER') {
    return {
      redirect: {
        destination: '/dispatch',
        permanent: false,
      },
    }
  }

  return {
    props: {
      username: sessionUser.username ?? sessionUser.email,
    },
  }
}

function formatDate(value?: string | null) {
  if (!value) {
    return 'Non renseigné'
  }

  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatDistance(mission: DriverMission) {
  if (typeof mission.routeDistanceMeters !== 'number') {
    return null
  }

  return `${Math.round(mission.routeDistanceMeters / 1000)} km`
}

function formatDuration(mission: DriverMission) {
  if (typeof mission.routeDurationSeconds !== 'number') {
    return null
  }

  const minutes = Math.round(mission.routeDurationSeconds / 60)
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  return hours > 0 ? `${hours} h ${remainingMinutes} min` : `${minutes} min`
}

function getRequirementBadges(mission: DriverMission) {
  const requirements = mission.requirements ?? {}
  const badges: string[] = []

  if (mission.preAnnouncementRequired) {
    badges.push('Pré-annonce')
  }

  if (requirements.straps) {
    badges.push('Sangles')
  }

  if (requirements.protectiveCorners) {
    badges.push('Coins')
  }

  if (requirements.emptyTrailer) {
    badges.push('Remorque vide')
  }

  if (requirements.safetyVest) {
    badges.push('Veste sécurité')
  }

  return badges
}

function getPhoneContact(mission: DriverMission) {
  const contacts = mission.contacts ?? {}
  const pickupPhone = contacts.pickupPhone
  const deliveryPhone = contacts.deliveryPhone

  if (typeof pickupPhone === 'string' && pickupPhone.trim()) {
    return pickupPhone.trim()
  }

  if (typeof deliveryPhone === 'string' && deliveryPhone.trim()) {
    return deliveryPhone.trim()
  }

  return null
}

function getNavigationUrl(
  mission: DriverMission,
  target: 'pickup' | 'delivery'
) {
  const coordinates =
    target === 'pickup' &&
    typeof mission.pickupLat === 'number' &&
    typeof mission.pickupLng === 'number'
      ? `${mission.pickupLat},${mission.pickupLng}`
      : target === 'delivery' &&
        typeof mission.deliveryLat === 'number' &&
        typeof mission.deliveryLng === 'number'
      ? `${mission.deliveryLat},${mission.deliveryLng}`
      : null
  const address =
    target === 'pickup' ? mission.pickupAddress : mission.deliveryAddress
  const destination = coordinates ?? address

  return destination
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        destination
      )}`
    : null
}

function getPrimaryDriverAction(
  mission: DriverMission,
  truckStatus?: DriverTruckStatus
): {
  action: DriverAction
  label: string
  navigationTarget?: 'pickup' | 'delivery'
} | null {
  const isTruckReadyToStart =
    !truckStatus ||
    truckStatus === 'ASSIGNED' ||
    truckStatus === 'AVAILABLE' ||
    truckStatus === 'AT_BASE'

  if (
    (mission.status === 'ASSIGNED' ||
      mission.status === 'PENDING' ||
      mission.status === 'IN_PROGRESS') &&
    isTruckReadyToStart
  ) {
    return {
      action: 'START_MISSION',
      label: 'Démarrer mission',
      navigationTarget: 'pickup',
    }
  }

  if (
    mission.status === 'IN_PROGRESS' &&
    truckStatus === 'EN_ROUTE_TO_PICKUP'
  ) {
    return {
      action: 'ARRIVE_PICKUP',
      label: 'Arrivé pickup',
      navigationTarget: 'pickup',
    }
  }

  if (mission.status === 'IN_PROGRESS' && truckStatus === 'AT_PICKUP') {
    return {
      action: 'START_DELIVERY',
      label: 'Départ livraison',
      navigationTarget: 'delivery',
    }
  }

  if (mission.status === 'IN_PROGRESS' && truckStatus === 'ON_MISSION') {
    return {
      action: 'COMPLETE_MISSION',
      label: 'Terminer mission',
      navigationTarget: 'delivery',
    }
  }

  return null
}

export default function DriverPage({ username }: DriverPageProps) {
  const router = useRouter()
  const [overview, setOverview] = useState<DriverOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [selectedUpcomingMission, setSelectedUpcomingMission] =
    useState<DriverMission | null>(null)
  const [pendingAction, setPendingAction] = useState<DriverAction | null>(null)
  const [locationSharingStatus, setLocationSharingStatus] =
    useState<LocationSharingStatus>('idle')
  const [lastPositionSentAt, setLastPositionSentAt] = useState<string | null>(
    null
  )
  const locationWatchIdRef = useRef<number | null>(null)
  const lastPositionPostAtRef = useRef(0)
  const mission = overview?.activeMission ?? null
  const primaryAction = mission
    ? getPrimaryDriverAction(mission, overview?.truck?.status)
    : null
  const navigationTarget =
    primaryAction?.navigationTarget ??
    (overview?.truck?.status === 'AT_PICKUP' ||
    overview?.truck?.status === 'ON_MISSION'
      ? 'delivery'
      : 'pickup')
  const navigationUrl = mission
    ? getNavigationUrl(mission, navigationTarget)
    : null
  const phoneContact = mission ? getPhoneContact(mission) : null
  const requirementBadges = mission ? getRequirementBadges(mission) : []
  const canTrackLocation =
    Boolean(mission) &&
    (mission?.status === 'IN_PROGRESS' || mission?.status === 'ISSUE')

  const stopLocationTracking = useCallback(() => {
    if (
      typeof window !== 'undefined' &&
      'geolocation' in navigator &&
      locationWatchIdRef.current !== null
    ) {
      navigator.geolocation.clearWatch(locationWatchIdRef.current)
    }

    locationWatchIdRef.current = null
    lastPositionPostAtRef.current = 0
  }, [])

  const postBrowserPosition = useCallback(
    async (position: GeolocationPosition, force = false) => {
      const now = Date.now()

      if (
        !force &&
        now - lastPositionPostAtRef.current < locationPostIntervalMs
      ) {
        return
      }

      lastPositionPostAtRef.current = now

      const { coords } = position
      const response = await fetch('/api/driver/position', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          speedKmh:
            typeof coords.speed === 'number' && Number.isFinite(coords.speed)
              ? Math.max(0, coords.speed * 3.6)
              : null,
          heading:
            typeof coords.heading === 'number' &&
            Number.isFinite(coords.heading)
              ? coords.heading
              : null,
        }),
      })

      if (!response.ok) {
        throw new Error('driver_position_failed')
      }

      setLastPositionSentAt(new Date().toISOString())
    },
    []
  )

  const startLocationTracking = useCallback(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setLocationSharingStatus('unsupported')
      return
    }

    if (locationWatchIdRef.current !== null) {
      setLocationSharingStatus('active')
      return
    }

    setLocationSharingStatus('requesting')

    let didSendFirstPosition = false
    locationWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        void postBrowserPosition(position, !didSendFirstPosition)
          .then(() => {
            didSendFirstPosition = true
            setLocationSharingStatus('active')
          })
          .catch((positionError) => {
            console.error('Unable to send driver position', positionError)
            setLocationSharingStatus('error')
          })
      },
      (positionError) => {
        console.error('Driver geolocation failed', positionError)

        if (positionError.code === positionError.PERMISSION_DENIED) {
          setLocationSharingStatus('denied')
        } else {
          setLocationSharingStatus('error')
        }

        stopLocationTracking()
      },
      geolocationOptions
    )
  }, [postBrowserPosition, stopLocationTracking])

  async function loadOverview() {
    try {
      setIsLoading(true)
      setError(null)
      const response = await fetch('/api/driver/overview')

      if (!response.ok) {
        throw new Error('driver_overview_failed')
      }

      setOverview((await response.json()) as DriverOverview)
    } catch (loadError) {
      console.error('Unable to load driver overview', loadError)
      setError('Impossible de charger votre espace chauffeur.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadOverview()
  }, [])

  useEffect(() => {
    return () => {
      stopLocationTracking()
    }
  }, [stopLocationTracking])

  useEffect(() => {
    if (!canTrackLocation) {
      stopLocationTracking()
      setLocationSharingStatus('idle')
      setLastPositionSentAt(null)
    }
  }, [canTrackLocation, mission?.id, stopLocationTracking])

  useEffect(() => {
    if (!canTrackLocation || locationSharingStatus !== 'idle') {
      return
    }

    if (
      typeof navigator === 'undefined' ||
      !('permissions' in navigator) ||
      !('geolocation' in navigator)
    ) {
      return
    }

    let isCancelled = false

    navigator.permissions
      .query({ name: 'geolocation' })
      .then((permissionStatus) => {
        if (!isCancelled && permissionStatus.state === 'granted') {
          startLocationTracking()
        }
      })
      .catch(() => {
        // Permission API is optional. The explicit retry button still works.
      })

    return () => {
      isCancelled = true
    }
  }, [canTrackLocation, locationSharingStatus, startLocationTracking])

  async function handleLogout() {
    try {
      setIsLoggingOut(true)
      stopLocationTracking()
      await fetch('/api/auth/logout', {
        method: 'POST',
      })
      await router.push('/login')
    } finally {
      setIsLoggingOut(false)
    }
  }

  async function handleMissionAction(action: DriverAction) {
    if (!mission) {
      return
    }

    try {
      setPendingAction(action)
      setError(null)
      const response = await fetch('/api/driver/mission-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          missionId: mission.id,
          action,
        }),
      })

      if (!response.ok) {
        throw new Error('driver_action_failed')
      }

      await loadOverview()
      setIsDetailsOpen(false)
      setSelectedUpcomingMission(null)

      if (action === 'START_MISSION') {
        startLocationTracking()
      }
    } catch (actionError) {
      console.error('Unable to apply driver action', actionError)
      setError("L'action n'a pas pu être enregistrée.")
    } finally {
      setPendingAction(null)
    }
  }

  const driverName = overview?.driver.name ?? username ?? 'chauffeur'
  const firstName = driverName.trim().split(' ')[0] || 'chauffeur'

  return (
    <main className="min-h-screen bg-[#F4F5F1] text-[#11130F]">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-4 pb-6 pt-3 sm:py-6">
        <header className="sticky top-0 z-20 -mx-4 rounded-b-[28px] bg-white px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <img
              src="/logo_gerard_texte.png"
              alt="Gerard"
              className="h-12 w-auto object-contain"
            />

            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              aria-label="Déconnexion"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] bg-[#11130F] text-white shadow-[0_14px_32px_rgba(17,19,15,0.14)] transition hover:-translate-y-0.5 hover:bg-[#B9FF4A] hover:text-[#11130F] disabled:opacity-50"
              style={{ border: 0 }}
            >
              <LogoutIcon />
            </button>
          </div>
        </header>

        <section className="px-1 pb-1 pt-2">
          <h1 className="mt-3 text-[2rem] font-black leading-[0.95] tracking-[-0.07em] text-[#11130F]">
            Bonjour,
            <br />
            <span className="text-[#73796d]">{firstName}</span>
          </h1>
        </section>

        {isLoading ? (
          <div className="mt-10 rounded-[30px] bg-white p-6 text-sm font-semibold text-[#6e7468] shadow-[0_18px_50px_rgba(17,19,15,0.08)]">
            Chargement de votre tournée...
          </div>
        ) : null}

        {error ? (
          <div className="mt-3 rounded-[24px] border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            {error}
          </div>
        ) : null}

        <DriverActivityPanel />

        {overview ? (
          <>
            <section className="mt-3 rounded-[30px] border border-black/[0.04] bg-white p-4 shadow-[0_18px_50px_rgba(17,19,15,0.08)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#8a9085]">
                    Aujourd'hui
                  </p>
                  <h1 className="mt-1 text-xl font-bold tracking-[-0.03em]">
                    {overview.truck?.plateNumber ?? 'Aucun camion'}
                  </h1>
                </div>
                <span className="rounded-full bg-[#B9FF4A] px-3 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-[#11130F]">
                  {overview.truck
                    ? truckStatusLabels[overview.truck.status]
                    : overview.driver.status}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <MiniMetric
                  label="Camion"
                  value={
                    overview.truck
                      ? [overview.truck.brand, overview.truck.model]
                          .filter(Boolean)
                          .join(' · ') || overview.truck.plateNumber
                      : 'Non affecté'
                  }
                />
                <MiniMetric
                  label="Remorque"
                  value={overview.trailer?.plateNumber ?? 'Non affectée'}
                />
              </div>
            </section>

            {mission ? (
              <section className="mt-4 overflow-hidden rounded-[34px] border border-black/[0.04] bg-white shadow-[0_20px_60px_rgba(17,19,15,0.1)]">
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8a9085]">
                        Mission principale
                      </p>
                      <h2 className="mt-2 truncate text-2xl font-black tracking-[-0.04em]">
                        {mission.reference}
                      </h2>
                      <p className="mt-1 truncate text-sm font-semibold text-[#6e7468]">
                        {mission.clientName}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-lime-300 bg-lime-100 px-3 py-1 text-[11px] font-black text-[#49630b]">
                      {missionStatusLabels[mission.status]}
                    </span>
                  </div>

                  <div className="mt-5 rounded-[26px] bg-[#F4F5F1] p-4">
                    <RoutePoint
                      label="Pickup"
                      city={mission.pickupCity}
                      address={mission.pickupAddress}
                      date={mission.pickupDate ?? mission.scheduledDate}
                    />
                    <div className="ml-[11px] h-8 w-px bg-black/10" />
                    <RoutePoint
                      label="Livraison"
                      city={mission.deliveryCity}
                      address={mission.deliveryAddress}
                      date={mission.deliveryDate}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {[formatDistance(mission), formatDuration(mission)]
                      .filter((item): item is string => Boolean(item))
                      .map((item) => (
                        <Pill key={item}>{item}</Pill>
                      ))}
                    {requirementBadges.map((badge) => (
                      <Pill key={badge}>{badge}</Pill>
                    ))}
                  </div>

                  <div className="mt-5 space-y-3">
                    {primaryAction ? (
                      <button
                        type="button"
                        onClick={() =>
                          handleMissionAction(primaryAction.action)
                        }
                        disabled={pendingAction !== null}
                        className="flex h-14 w-full items-center justify-center gap-2 rounded-[22px] bg-[#11130F] px-5 text-base font-black text-white shadow-[0_18px_42px_rgba(17,19,15,0.18)] transition hover:bg-[#B9FF4A] hover:text-[#11130F] disabled:opacity-50"
                        style={{ border: 0 }}
                      >
                        <PlayIcon />
                        {pendingAction === primaryAction.action
                          ? 'Enregistrement...'
                          : primaryAction.label}
                      </button>
                    ) : null}

                    {mission.status === 'ISSUE' ? (
                      <div className="rounded-[22px] border border-red-100 bg-red-50 px-4 py-3 text-sm font-black text-red-700">
                        Problème signalé · En attente dispatch
                      </div>
                    ) : null}

                    {mission.status === 'IN_PROGRESS' ||
                    mission.status === 'ISSUE' ? (
                      <LocationSharingPanel
                        status={locationSharingStatus}
                        lastPositionSentAt={lastPositionSentAt}
                        onRetry={startLocationTracking}
                      />
                    ) : null}

                    <div className="grid grid-cols-3 gap-2">
                      {navigationUrl ? (
                        <a
                          href={navigationUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-12 items-center justify-center rounded-[18px] bg-[#B9FF4A] text-[#11130F] transition hover:-translate-y-0.5"
                          aria-label="Navigation"
                        >
                          <NavigationIcon />
                        </a>
                      ) : (
                        <DisabledRoundAction label="GPS" />
                      )}
                      {phoneContact ? (
                        <a
                          href={`tel:${phoneContact}`}
                          className="flex h-12 items-center justify-center rounded-[18px] bg-white text-[#11130F] ring-1 ring-black/10 transition hover:-translate-y-0.5"
                          aria-label="Appeler"
                        >
                          <PhoneIcon />
                        </a>
                      ) : (
                        <DisabledRoundAction label="Tel" />
                      )}
                      <button
                        type="button"
                        onClick={() => handleMissionAction('REPORT_ISSUE')}
                        disabled={pendingAction !== null}
                        className="flex h-12 items-center justify-center rounded-[18px] bg-white text-red-600 ring-1 ring-red-100 transition hover:-translate-y-0.5 disabled:opacity-50"
                        aria-label="Signaler problème"
                        style={{ border: 0 }}
                      >
                        <WarningIcon />
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsDetailsOpen((current) => !current)}
                    className="mt-5 flex w-full items-center justify-between rounded-[20px] bg-[#F4F5F1] px-4 py-3 text-left text-sm font-black text-[#11130F]"
                    style={{ border: 0 }}
                  >
                    Détails mission
                    <span>{isDetailsOpen ? '−' : '+'}</span>
                  </button>

                  {isDetailsOpen ? <MissionDetails mission={mission} /> : null}
                </div>
              </section>
            ) : (
              <section className="mt-4 rounded-[34px] bg-white p-6 text-center shadow-[0_20px_60px_rgba(17,19,15,0.1)]">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[22px] bg-[#F4F5F1] text-[#11130F]">
                  <RouteIcon />
                </div>
                <h2 className="mt-5 text-2xl font-black tracking-[-0.04em]">
                  Aucune mission assignée
                </h2>
                <p className="mt-2 text-sm font-semibold text-[#73796d]">
                  Le dispatch vous notifiera dès qu'une mission est disponible.
                </p>
              </section>
            )}

            {overview.upcomingMissions.length > 0 ? (
              <section className="mt-5">
                <p className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-[#8a9085]">
                  Prochaines missions
                </p>
                <div className="mt-2 space-y-2">
                  {overview.upcomingMissions.slice(0, 5).map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => setSelectedUpcomingMission(item)}
                      className="w-full rounded-[24px] border border-black/[0.04] bg-white px-4 py-3 text-left shadow-[0_12px_30px_rgba(17,19,15,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_38px_rgba(17,19,15,0.1)]"
                      style={{ border: 0 }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black">
                            {item.reference}
                          </p>
                          <p className="mt-1 truncate text-xs font-semibold text-[#73796d]">
                            {item.pickupCity} → {item.deliveryCity}
                          </p>
                        </div>
                        <p className="shrink-0 text-[11px] font-black text-[#53594f]">
                          {formatDate(item.scheduledDate)}
                        </p>
                        <ChevronIcon />
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {selectedUpcomingMission ? (
              <UpcomingMissionSheet
                mission={selectedUpcomingMission}
                onClose={() => setSelectedUpcomingMission(null)}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] bg-[#F4F5F1] px-3 py-3">
      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#9aa090]">
        {label}
      </p>
      <p className="mt-1 truncate text-xs font-black text-[#11130F]">{value}</p>
    </div>
  )
}

function LocationSharingPanel({
  lastPositionSentAt,
  onRetry,
  status,
}: {
  lastPositionSentAt: string | null
  onRetry: () => void
  status: LocationSharingStatus
}) {
  const isShared = status === 'active'
  const canRetry =
    status === 'idle' ||
    status === 'denied' ||
    status === 'error' ||
    status === 'unsupported'
  const label =
    status === 'active'
      ? 'Position partagée'
      : status === 'requesting'
      ? 'Autorisation position...'
      : status === 'denied'
      ? 'Mission démarrée · position non partagée'
      : status === 'unsupported'
      ? 'Position indisponible sur ce navigateur'
      : status === 'error'
      ? 'Position non envoyée'
      : 'Position non activée'
  const detail = isShared
    ? lastPositionSentAt
      ? `Dernier envoi ${formatDate(lastPositionSentAt)}`
      : 'Envoi en cours'
    : status === 'requesting'
    ? 'Validez la demande du navigateur.'
    : status === 'unsupported'
    ? 'Utilisez un navigateur compatible GPS.'
    : 'Le dispatch verra le camion dès que la position est partagée.'

  return (
    <div
      className={[
        'rounded-[22px] px-4 py-3',
        isShared
          ? 'border border-lime-200 bg-lime-50 text-[#49630b]'
          : 'border border-amber-100 bg-amber-50 text-[#6e5300]',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black">{label}</p>
          <p className="mt-1 text-[11px] font-semibold leading-snug opacity-80">
            {detail}
          </p>
        </div>
        {canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-full bg-white px-3 py-2 text-[11px] font-black text-[#11130F] shadow-[0_8px_20px_rgba(17,19,15,0.08)]"
            style={{ border: 0 }}
          >
            Réessayer
          </button>
        ) : null}
      </div>
    </div>
  )
}

function RoutePoint({
  address,
  city,
  date,
  label,
}: {
  address?: string | null
  city: string
  date?: string | null
  label: string
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-1 h-5 w-5 shrink-0 rounded-full border-[5px] border-[#11130F] bg-[#B9FF4A]" />
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#8a9085]">
          {label}
        </p>
        <p className="mt-1 text-base font-black tracking-[-0.02em]">{city}</p>
        {address ? (
          <p className="line-clamp-2 mt-1 text-xs font-semibold leading-snug text-[#73796d]">
            {address}
          </p>
        ) : null}
        <p className="mt-2 text-[11px] font-black text-[#4f5549]">
          {formatDate(date)}
        </p>
      </div>
    </div>
  )
}

function Pill({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-[#11130F] px-3 py-1 text-[11px] font-black text-white">
      {children}
    </span>
  )
}

function MissionDetails({ mission }: { mission: DriverMission }) {
  const contacts = mission.contacts ?? {}
  const billingInfo = mission.billingInfo ?? {}
  const requirements = mission.requirements ?? {}

  return (
    <div className="mt-3 space-y-3 rounded-[24px] bg-[#F4F5F1] p-4 text-xs font-semibold text-[#5f665b]">
      <DetailLine label="Référence client" value={mission.clientReference} />
      <DetailLine label="Type camion" value={mission.requiredTruckType} />
      <DetailLine
        label="Paiement"
        value={
          mission.paymentTerms ??
          (mission.priceAmount
            ? `${mission.priceAmount} ${mission.priceCurrency ?? ''}`.trim()
            : null)
        }
      />
      <DetailLine label="Notes" value={mission.notes} />
      <DetailLine
        label="Contact pickup"
        value={
          typeof contacts.pickupPhone === 'string' ? contacts.pickupPhone : null
        }
      />
      <DetailLine
        label="Facturation"
        value={
          typeof billingInfo.instructions === 'string'
            ? billingInfo.instructions
            : null
        }
      />
      <div className="flex flex-wrap gap-2 pt-1">
        {Object.entries(requirements)
          .filter(([, value]) => Boolean(value))
          .map(([key]) => (
            <span
              key={key}
              className="rounded-full bg-white px-3 py-1 text-[10px] font-black text-[#4f5549]"
            >
              {key}
            </span>
          ))}
      </div>
    </div>
  )
}

function UpcomingMissionSheet({
  mission,
  onClose,
}: {
  mission: DriverMission
  onClose: () => void
}) {
  const navigationUrl = getNavigationUrl(mission, 'pickup')
  const phoneContact = getPhoneContact(mission)
  const requirementBadges = getRequirementBadges(mission)

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/25 px-3 pb-3">
      <button
        type="button"
        aria-label="Fermer"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        style={{ border: 0 }}
      />
      <section className="relative z-10 w-full max-w-[430px] rounded-[34px] bg-white p-5 shadow-[0_28px_80px_rgba(17,19,15,0.22)]">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-black/10" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8a9085]">
              Prochaine mission
            </p>
            <h3 className="mt-2 truncate text-2xl font-black tracking-[-0.04em]">
              {mission.reference}
            </h3>
            <p className="mt-1 truncate text-sm font-semibold text-[#73796d]">
              {mission.clientName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] bg-[#F4F5F1] text-lg font-black text-[#11130F]"
            style={{ border: 0 }}
          >
            ×
          </button>
        </div>

        <div className="mt-4 rounded-[26px] bg-[#F4F5F1] p-4">
          <RoutePoint
            label="Pickup"
            city={mission.pickupCity}
            address={mission.pickupAddress}
            date={mission.pickupDate ?? mission.scheduledDate}
          />
          <div className="ml-[11px] h-7 w-px bg-black/10" />
          <RoutePoint
            label="Livraison"
            city={mission.deliveryCity}
            address={mission.deliveryAddress}
            date={mission.deliveryDate}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Pill>{missionStatusLabels[mission.status]}</Pill>
          {[formatDistance(mission), formatDuration(mission)]
            .filter((item): item is string => Boolean(item))
            .map((item) => (
              <Pill key={item}>{item}</Pill>
            ))}
          {requirementBadges.map((badge) => (
            <Pill key={badge}>{badge}</Pill>
          ))}
        </div>

        {mission.notes ? (
          <p className="mt-4 rounded-[22px] bg-[#F4F5F1] px-4 py-3 text-xs font-semibold leading-snug text-[#5f665b]">
            {mission.notes}
          </p>
        ) : null}

        <div className="mt-4 rounded-[22px] bg-lime-50 px-4 py-3 text-xs font-black text-[#49630b]">
          Disponible après la mission en cours.
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {navigationUrl ? (
            <a
              href={navigationUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-12 items-center justify-center gap-2 rounded-[18px] bg-[#B9FF4A] text-sm font-black text-[#11130F]"
            >
              <NavigationIcon />
              GPS pickup
            </a>
          ) : (
            <DisabledRoundAction label="GPS" />
          )}
          {phoneContact ? (
            <a
              href={`tel:${phoneContact}`}
              className="flex h-12 items-center justify-center gap-2 rounded-[18px] bg-[#11130F] text-sm font-black text-white"
            >
              <PhoneIcon />
              Appeler
            </a>
          ) : (
            <DisabledRoundAction label="Tel" />
          )}
        </div>
      </section>
    </div>
  )
}

function DetailLine({
  label,
  value,
}: {
  label: string
  value?: string | number | null
}) {
  if (!value) {
    return null
  }

  return (
    <div>
      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#9aa090]">
        {label}
      </p>
      <p className="mt-1 leading-snug text-[#30342d]">{value}</p>
    </div>
  )
}

function DisabledRoundAction({ label }: { label: string }) {
  return (
    <div className="flex h-12 items-center justify-center rounded-[18px] bg-white text-[11px] font-black text-[#a1a79c] ring-1 ring-black/5">
      {label}
    </div>
  )
}

function LogoutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 6H6.5A2.5 2.5 0 0 0 4 8.5v7A2.5 2.5 0 0 0 6.5 18H10" />
      <path d="M14 8l4 4-4 4" />
      <path d="M18 12H9" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M8 5.7v12.6c0 .85.94 1.36 1.65.9l9.62-6.3a1.06 1.06 0 0 0 0-1.8L9.65 4.8A1.06 1.06 0 0 0 8 5.7z" />
    </svg>
  )
}

function NavigationIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21s7-6.1 7-12A7 7 0 1 0 5 9c0 5.9 7 12 7 12z" />
      <path d="M12 12.5A3.5 3.5 0 1 0 12 5.5a3.5 3.5 0 0 0 0 7z" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 16.9v2.4a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 3.6 2 2 0 0 1 4.1 1.4h2.4a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.45 2.1L7.6 8.9a16 16 0 0 0 7.5 7.5l1.1-1.05a2 2 0 0 1 2.1-.45c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.1.4z" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 1.8 18.5A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.5L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-[#9aa090]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

function RouteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M18 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M6 13V8a3 3 0 0 1 3-3h6" />
      <path d="M18 11v5a3 3 0 0 1-3 3H9" />
    </svg>
  )
}
