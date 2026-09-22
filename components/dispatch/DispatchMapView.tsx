'use client'

import {
  ControlButton,
  Icons,
  controlFieldClass,
  controlPanelClass,
} from '../ui/ControlKit'

import {
  GoogleMap,
  InfoWindow,
  MarkerF,
  PolylineF,
  useJsApiLoader,
} from '@react-google-maps/api'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  DispatchDay,
  Driver,
  Mission,
  Truck,
  TruckStatus,
} from '../../lib/dispatch/mock-data'
import { GERARD_BASE } from '../../lib/dispatch/base-location'
import { dayLabels, dispatchDays } from '../../lib/dispatch/mock-data'
import { decodePolyline } from '../../lib/dispatch/polyline'
import { MissionCard } from './MissionCard'

type MissionPlacement = {
  assignmentId?: string
  driverId?: string | null
  planningRowId?: string | null
  truckId?: string | null
  day: DispatchDay
  approachDistanceMeters?: number
  approachDurationSeconds?: number
  approachPolyline?: string
  approachCalculatedAt?: string
  approachProvider?: string
}

type TruckPosition = {
  id: string
  truckId: string
  driverId?: string | null
  latitude: number
  longitude: number
  speedKmh?: number | null
  heading?: number | null
  provider?: string | null
  recordedAt: string
}

type DispatchMapViewProps = {
  drivers: Driver[]
  trucks: Truck[]
  missions: Mission[]
  placements: Record<string, MissionPlacement | null>
  truckAssignments: Record<string, string | null>
  truckPositions?: TruckPosition[]
  weekStart: string
  onMissionClick?: (mission: Mission) => void
  onTruckOpen?: () => void
  onApproachRouteUpdate?: (
    missionId: string,
    approach: Pick<
      MissionPlacement,
      | 'approachDistanceMeters'
      | 'approachDurationSeconds'
      | 'approachPolyline'
      | 'approachCalculatedAt'
      | 'approachProvider'
    >
  ) => void
  onMissionRouteUpdate?: (
    missionId: string,
    route: Pick<
      Mission,
      | 'routeDistanceMeters'
      | 'routeDurationSeconds'
      | 'routePolyline'
      | 'routeCalculatedAt'
      | 'routeProvider'
    >
  ) => void
  onTruckReturnRouteUpdate?: (
    truckId: string,
    route: Pick<
      Truck,
      | 'returnToBaseDistanceMeters'
      | 'returnToBaseDurationSeconds'
      | 'returnToBasePolyline'
      | 'returnToBaseCalculatedAt'
      | 'returnToBaseProvider'
    >
  ) => void
  onTruckStatusUpdate?: (
    truckId: string,
    status: TruckStatus,
    statusUpdatedAt?: string | null
  ) => void
}

type TruckMapMarker = {
  id: string
  position: google.maps.LatLngLiteral
  truck: Truck
  driver?: Driver
  mission?: Mission
  placement?: MissionPlacement
  speedKmh?: number | null
  provider?: string | null
  recordedAt: string
}

type MissionMapMarker = {
  id: string
  kind: 'pickup' | 'delivery'
  position: google.maps.LatLngLiteral
  mission: Mission
  driver?: Driver
  truck?: Truck
}

type SelectedMarker =
  | {
      type: 'truck'
      id: string
    }
  | {
      type: 'mission'
      id: string
    }
  | null

type MarkerIcon = {
  url: string
  scaledSize: google.maps.Size
  anchor: google.maps.Point
}

type MissionRouteResponse = {
  missionId: string
  distanceMeters: number
  distanceKm: number
  durationSeconds: number
  durationLabel: string
  polyline: string
  cached: boolean
}

type WeekRoutesResponse = {
  computed: MissionRouteResponse[]
  skipped: Array<{
    missionId: string
    reason: string
  }>
  failed: Array<{
    missionId: string
    error: string
  }>
  remainingCount: number
}

type ApproachRouteResponse = {
  assignmentId: string
  missionId: string
  truckId: string
  distanceMeters: number
  distanceKm: number
  durationSeconds: number
  durationLabel: string
  polyline: string
  cached: boolean
}

type ReturnToBaseRouteResponse = {
  truckId: string
  distanceMeters: number
  distanceKm: number
  durationSeconds: number
  durationLabel: string
  polyline: string
  cached: boolean
}

type UpdateTruckStatusResponse = {
  truck: Truck
}

type TruckEventItem = {
  id: string
  fromStatus: TruckStatus | null
  toStatus: TruckStatus
  message?: string | null
  createdAt: string
  actor?: {
    id: string
    name: string
    email: string
  } | null
}

type TruckEventsResponse = {
  events: TruckEventItem[]
}

type ApproachRouteErrorResponse = {
  error?: string
  reason?: string
  status?: number
  assignmentId?: string
  truckId?: string | null
  missionId?: string
  details?: unknown
}

type RoutePolyline = {
  mission: Mission
  path: google.maps.LatLngLiteral[]
}

type ApproachPolyline = {
  mission: Mission
  placement: MissionPlacement
  path: google.maps.LatLngLiteral[]
}

type ReturnToBasePolyline = {
  truck: Truck
  path: google.maps.LatLngLiteral[]
}

type StatusFilter = Mission['status'] | 'all'

const luxembourgCenter = {
  lat: 49.8153,
  lng: 6.1296,
}

const basePosition = {
  lat: GERARD_BASE.lat,
  lng: GERARD_BASE.lng,
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidCoordinate(lat: unknown, lng: unknown) {
  return isFiniteNumber(lat) && isFiniteNumber(lng)
}

function isValidMapPoint(point: unknown): point is google.maps.LatLngLiteral {
  if (!point || typeof point !== 'object') {
    return false
  }

  const candidate = point as Partial<google.maps.LatLngLiteral>

  return isValidCoordinate(candidate.lat, candidate.lng)
}

function safeDecodePolyline(encodedPolyline?: string | null) {
  if (!encodedPolyline || typeof encodedPolyline !== 'string') {
    return []
  }

  try {
    const path = decodePolyline(encodedPolyline)

    if (!Array.isArray(path)) {
      return []
    }

    return path.filter(isValidMapPoint)
  } catch (error) {
    console.warn('Invalid polyline ignored', error)
    return []
  }
}

function canRenderPolylinePath(path: google.maps.LatLngLiteral[]) {
  return Array.isArray(path) && path.length >= 2
}

const containerStyle = {
  width: '100%',
  height: '100%',
}

const statusLabels: Record<Mission['status'], string> = {
  pending: 'À planifier',
  assigned: 'Assignée',
  in_progress: 'En cours',
  done: 'Terminée',
  issue: 'Problème',
  cancelled: 'Annulée',
}

const missionStatusBadgeStyles: Record<Mission['status'], string> = {
  pending: 'border-black/10 bg-[#f4f5f1] text-[#56594f]',
  assigned: 'border-lime-300 bg-lime-100 text-[#49630b]',
  in_progress: 'border-sky-200 bg-sky-100 text-sky-800',
  done: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  issue: 'border-red-200 bg-red-100 text-red-800',
  cancelled: 'border-black/10 bg-[#e6e8e1] text-[#34372f]',
}

const truckStatusLabels: Record<TruckStatus, string> = {
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

const truckStatusBadgeStyles: Record<TruckStatus, string> = {
  AVAILABLE: 'border-black/10 bg-white text-[#11130f]',
  ASSIGNED: 'border-lime-300 bg-lime-100 text-[#49630b]',
  EN_ROUTE_TO_PICKUP: 'border-sky-200 bg-sky-100 text-sky-800',
  AT_PICKUP: 'border-orange-200 bg-orange-100 text-orange-900',
  ON_MISSION: 'border-[#11130f] bg-[#11130f] text-white',
  RETURNING_TO_BASE: 'border-orange-300 bg-[#FF9F1C] text-[#11130f]',
  AT_BASE: 'border-black/10 bg-[#f4f5f1] text-[#11130f]',
  IN_MAINTENANCE: 'border-amber-200 bg-amber-100 text-amber-900',
  MAINTENANCE_EXT: 'border-violet-200 bg-violet-100 text-violet-900',
  OUT_OF_SERVICE: 'border-red-200 bg-red-100 text-red-800',
}

const truckStatusOptions: TruckStatus[] = [
  'AVAILABLE',
  'ASSIGNED',
  'EN_ROUTE_TO_PICKUP',
  'AT_PICKUP',
  'ON_MISSION',
  'RETURNING_TO_BASE',
  'AT_BASE',
  'IN_MAINTENANCE',
  'MAINTENANCE_EXT',
  'OUT_OF_SERVICE',
]

const statusFilterOptions: Array<{
  value: StatusFilter
  label: string
}> = [
  {
    value: 'all',
    label: 'Tous',
  },
  {
    value: 'assigned',
    label: 'Assignée',
  },
  {
    value: 'in_progress',
    label: 'En cours',
  },
  {
    value: 'done',
    label: 'Terminée',
  },
  {
    value: 'issue',
    label: 'Problème',
  },
  {
    value: 'cancelled',
    label: 'Annulée',
  },
]

const truckMissionPriority: Record<Mission['status'], number> = {
  issue: 5,
  in_progress: 4,
  assigned: 3,
  pending: 2,
  done: 1,
  cancelled: 0,
}

const truckMarkerStyles: Record<
  TruckStatus,
  { background: string; color: string }
> = {
  AVAILABLE: {
    background: '#FFFFFF',
    color: '#11130F',
  },
  ASSIGNED: {
    background: '#B9FF4A',
    color: '#49630B',
  },
  EN_ROUTE_TO_PICKUP: {
    background: '#DBF1FF',
    color: '#075985',
  },
  AT_PICKUP: {
    background: '#FED7AA',
    color: '#7C2D12',
  },
  ON_MISSION: {
    background: '#11130F',
    color: '#FFFFFF',
  },
  RETURNING_TO_BASE: {
    background: '#FF9F1C',
    color: '#11130F',
  },
  AT_BASE: {
    background: '#F4F5F1',
    color: '#11130F',
  },
  IN_MAINTENANCE: {
    background: '#FEF3C7',
    color: '#78350F',
  },
  MAINTENANCE_EXT: {
    background: '#EDE9FE',
    color: '#5B21B6',
  },
  OUT_OF_SERVICE: {
    background: '#FEE2E2',
    color: '#991B1B',
  },
}

const routeStatusStyles: Record<Mission['status'], string> = {
  pending: '#A7AAA2',
  assigned: '#8CC63F',
  in_progress: '#0284C7',
  done: '#059669',
  issue: '#DC2626',
  cancelled: '#4B5563',
}

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  clickableIcons: false,
  styles: [
    {
      featureType: 'all',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#34372f' }],
    },
    {
      featureType: 'landscape',
      elementType: 'geometry',
      stylers: [{ color: '#f1f2ec' }],
    },
    {
      featureType: 'poi',
      stylers: [{ visibility: 'off' }],
    },
    {
      featureType: 'road',
      elementType: 'geometry',
      stylers: [{ color: '#ffffff' }],
    },
    {
      featureType: 'road',
      elementType: 'labels.icon',
      stylers: [{ visibility: 'off' }],
    },
    {
      featureType: 'water',
      elementType: 'geometry',
      stylers: [{ color: '#dfe8e6' }],
    },
  ],
}

export function DispatchMapView({
  drivers,
  trucks,
  missions,
  placements,
  truckAssignments,
  truckPositions = [],
  weekStart,
  onApproachRouteUpdate,
  onMissionClick,
  onTruckOpen,
  onMissionRouteUpdate,
  onTruckStatusUpdate,
  onTruckReturnRouteUpdate,
}: DispatchMapViewProps) {
  const browserKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY

  if (!browserKey) {
    return (
      <MockMapFallback
        drivers={drivers}
        trucks={trucks}
        missions={missions}
        placements={placements}
        truckAssignments={truckAssignments}
        truckPositions={truckPositions}
        weekStart={weekStart}
        onMissionClick={onMissionClick}
        onTruckStatusUpdate={onTruckStatusUpdate}
        onTruckReturnRouteUpdate={onTruckReturnRouteUpdate}
      />
    )
  }

  return (
    <GoogleDispatchMap
      apiKey={browserKey}
      drivers={drivers}
      trucks={trucks}
      missions={missions}
      placements={placements}
      truckAssignments={truckAssignments}
      truckPositions={truckPositions}
      weekStart={weekStart}
      onApproachRouteUpdate={onApproachRouteUpdate}
      onMissionClick={onMissionClick}
      onTruckOpen={onTruckOpen}
      onMissionRouteUpdate={onMissionRouteUpdate}
      onTruckStatusUpdate={onTruckStatusUpdate}
      onTruckReturnRouteUpdate={onTruckReturnRouteUpdate}
    />
  )
}

function GoogleDispatchMap({
  apiKey,
  drivers,
  trucks,
  missions,
  placements,
  truckAssignments,
  truckPositions = [],
  weekStart,
  onApproachRouteUpdate,
  onMissionClick,
  onTruckOpen,
  onMissionRouteUpdate,
  onTruckStatusUpdate,
  onTruckReturnRouteUpdate,
}: DispatchMapViewProps & { apiKey: string }) {
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const [selectedMarker, setSelectedMarker] = useState<SelectedMarker>(null)
  const [selectedMapMissionId, setSelectedMapMissionId] = useState<
    string | null
  >(null)
  const [isRouteLoading, setIsRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routeBatchMessage, setRouteBatchMessage] = useState<string | null>(
    null
  )
  const [isApproachLoading, setIsApproachLoading] = useState(false)
  const [approachMessage, setApproachMessage] = useState<string | null>(null)
  const [approachError, setApproachError] = useState<string | null>(null)
  const [isRouteToolsOpen, setIsRouteToolsOpen] = useState(false)
  const [returnBaseLoadingTruckId, setReturnBaseLoadingTruckId] = useState<
    string | null
  >(null)
  const [returnBaseError, setReturnBaseError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [driverFilter, setDriverFilter] = useState('all')
  const [truckFilter, setTruckFilter] = useState('all')
  const [dayFilter, setDayFilter] = useState<DispatchDay | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    id: 'gerard-dispatch-map',
  })

  const driversById = useMemo(() => {
    return drivers.reduce<Record<string, Driver>>((items, driver) => {
      items[driver.id] = driver
      return items
    }, {})
  }, [drivers])

  const trucksByDriverId = useMemo(() => {
    return trucks.reduce<Record<string, Truck>>((items, truck) => {
      const driverId = truckAssignments[truck.id]

      if (driverId) {
        items[driverId] = truck
      }

      return items
    }, {})
  }, [trucks, truckAssignments])

  const selectedMapMission = useMemo(() => {
    if (!selectedMapMissionId) {
      return null
    }

    return (
      missions.find((mission) => mission.id === selectedMapMissionId) ?? null
    )
  }, [missions, selectedMapMissionId])

  useEffect(() => {
    if (!selectedMapMissionId || selectedMapMission) {
      return
    }

    setSelectedMapMissionId(null)
    setSelectedMarker(null)
  }, [selectedMapMission, selectedMapMissionId])

  const truckMarkers = useMemo<TruckMapMarker[]>(() => {
    return truckPositions.flatMap((position) => {
      if (!isValidCoordinate(position.latitude, position.longitude)) {
        return []
      }

      const truck = trucks.find((item) => item.id === position.truckId)

      if (!truck) {
        return []
      }

      const driverId =
        position.driverId ??
        truckAssignments[truck.id] ??
        truck.driverId ??
        null
      const driverMission = driverId
        ? missions
            .filter((mission) => placements[mission.id]?.driverId === driverId)
            .sort(
              (firstMission, secondMission) =>
                truckMissionPriority[secondMission.status] -
                truckMissionPriority[firstMission.status]
            )[0]
        : undefined
      const placement = driverMission ? placements[driverMission.id] : null

      return [
        {
          id: `truck:${position.id}`,
          position: {
            lat: position.latitude,
            lng: position.longitude,
          },
          truck,
          driver: driverId ? driversById[driverId] : undefined,
          mission: driverMission,
          placement: placement ?? undefined,
          speedKmh: position.speedKmh,
          provider: position.provider,
          recordedAt: position.recordedAt,
        },
      ]
    })
  }, [
    driversById,
    missions,
    placements,
    truckAssignments,
    truckPositions,
    trucks,
  ])

  const [positionNow, setPositionNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setPositionNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const assignedMissions = useMemo(
    () => missions.filter((mission) => placements[mission.id] !== null),
    [missions, placements]
  )

  const filteredMapMissions = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(searchQuery)

    return assignedMissions.filter((mission) => {
      const placement = placements[mission.id]

      if (!placement) {
        return false
      }

      const truck = placement.driverId
        ? trucksByDriverId[placement.driverId]
        : placement.truckId
        ? trucks.find((item) => item.id === placement.truckId)
        : undefined

      if (statusFilter !== 'all' && mission.status !== statusFilter) {
        return false
      }

      if (driverFilter !== 'all' && placement.driverId !== driverFilter) {
        return false
      }

      if (truckFilter !== 'all' && truck?.id !== truckFilter) {
        return false
      }

      if (dayFilter !== 'all' && placement.day !== dayFilter) {
        return false
      }

      if (!normalizedQuery) {
        return true
      }

      return normalizeSearchValue(
        [
          mission.reference,
          mission.clientName,
          mission.pickupCity,
          mission.deliveryCity,
        ].join(' ')
      ).includes(normalizedQuery)
    })
  }, [
    assignedMissions,
    dayFilter,
    driverFilter,
    placements,
    searchQuery,
    statusFilter,
    truckFilter,
    trucks,
    trucksByDriverId,
  ])

  useEffect(() => {
    if (
      !selectedMapMissionId ||
      filteredMapMissions.some((mission) => mission.id === selectedMapMissionId)
    ) {
      return
    }

    setSelectedMapMissionId(null)
    setSelectedMarker(null)
  }, [filteredMapMissions, selectedMapMissionId])

  const visibleTruckMarkers = useMemo(() => {
    return truckMarkers.filter((marker) => {
      if (driverFilter !== 'all' && marker.driver?.id !== driverFilter) {
        return false
      }

      if (truckFilter !== 'all' && marker.truck.id !== truckFilter) {
        return false
      }

      return true
    })
  }, [driverFilter, truckFilter, truckMarkers])

  const missionMarkers = useMemo<MissionMapMarker[]>(() => {
    return filteredMapMissions.flatMap((mission) => {
      const placement = placements[mission.id]

      if (!placement) {
        return []
      }

      const driver = placement.driverId
        ? driversById[placement.driverId]
        : undefined
      const truck = placement.driverId
        ? trucksByDriverId[placement.driverId]
        : placement.truckId
        ? trucks.find((item) => item.id === placement.truckId)
        : undefined
      const markers: MissionMapMarker[] = []

      const pickupLat = mission.pickupLat
      const pickupLng = mission.pickupLng
      const deliveryLat = mission.deliveryLat
      const deliveryLng = mission.deliveryLng

      if (isFiniteNumber(pickupLat) && isFiniteNumber(pickupLng)) {
        markers.push({
          id: `mission:${mission.id}:pickup`,
          kind: 'pickup',
          position: {
            lat: pickupLat,
            lng: pickupLng,
          },
          mission,
          driver,
          truck,
        })
      }

      if (isFiniteNumber(deliveryLat) && isFiniteNumber(deliveryLng)) {
        markers.push({
          id: `mission:${mission.id}:delivery`,
          kind: 'delivery',
          position: {
            lat: deliveryLat,
            lng: deliveryLng,
          },
          mission,
          driver,
          truck,
        })
      }

      return markers
    })
  }, [driversById, filteredMapMissions, placements, trucks, trucksByDriverId])

  const routePolylines = useMemo<RoutePolyline[]>(() => {
    return filteredMapMissions.flatMap((mission) => {
      const path = safeDecodePolyline(mission.routePolyline)

      if (!canRenderPolylinePath(path)) {
        return []
      }

      return [
        {
          mission,
          path,
        },
      ]
    })
  }, [filteredMapMissions])

  const approachPolylines = useMemo<ApproachPolyline[]>(() => {
    return filteredMapMissions.flatMap((mission) => {
      const placement = placements[mission.id]
      const path = safeDecodePolyline(placement?.approachPolyline)

      if (!placement || !canRenderPolylinePath(path)) {
        return []
      }

      return [
        {
          mission,
          placement,
          path,
        },
      ]
    })
  }, [filteredMapMissions, placements])

  const returnToBasePolylines = useMemo<ReturnToBasePolyline[]>(() => {
    return visibleTruckMarkers.flatMap((marker) => {
      const path = safeDecodePolyline(marker.truck.returnToBasePolyline)

      if (!canRenderPolylinePath(path)) {
        return []
      }

      return [
        {
          truck: marker.truck,
          path,
        },
      ]
    })
  }, [visibleTruckMarkers])

  const selectedTruckMarker =
    selectedMarker?.type === 'truck'
      ? truckMarkers.find((marker) => marker.id === selectedMarker.id) ?? null
      : null
  const selectedMissionMarker =
    selectedMarker?.type === 'mission'
      ? missionMarkers.find((marker) => marker.id === selectedMarker.id) ?? null
      : null
  const handleMapLoad = useCallback((loadedMap: google.maps.Map) => {
    setMap(loadedMap)
  }, [])

  async function handleComputeWeekRoutes(forceRefresh = false) {
    if (forceRefresh) {
      const shouldRefresh = window.confirm(
        'Recalculer consomme des appels Google Routes. Continuer ?'
      )

      if (!shouldRefresh) {
        return
      }
    }

    try {
      setIsRouteLoading(true)
      setRouteError(null)
      setRouteBatchMessage(null)

      const response = await fetch('/api/dispatch/compute-week-routes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          weekStart,
          forceRefresh,
        }),
      })

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as {
          error?: string
        } | null

        throw new Error(
          errorBody?.error ?? 'Impossible de calculer les itinéraires.'
        )
      }

      const result = (await response.json()) as WeekRoutesResponse

      result.computed.forEach((route) => {
        onMissionRouteUpdate?.(route.missionId, {
          routeDistanceMeters: route.distanceMeters,
          routeDurationSeconds: route.durationSeconds,
          routePolyline: route.polyline,
          routeCalculatedAt: new Date().toISOString(),
          routeProvider: 'GOOGLE_ROUTES',
        })
      })

      setRouteBatchMessage(
        `${result.computed.length} itinéraire(s) calculé(s)${
          result.remainingCount > 0
            ? ` · ${result.remainingCount} restant(s)`
            : ''
        }${
          result.failed.length > 0 ? ` · ${result.failed.length} échec(s)` : ''
        }`
      )
    } catch (error) {
      console.error('Unable to compute route', error)
      setRouteError(
        error instanceof Error
          ? error.message
          : 'Impossible de calculer les itinéraires.'
      )
    } finally {
      setIsRouteLoading(false)
    }
  }

  async function handleComputeApproachRoutes() {
    const missionsToCompute = filteredMapMissions
      .filter((mission) => {
        const placement = placements[mission.id]
        const hasTruckPosition = placement?.truckId
          ? truckPositions.some(
              (position) => position.truckId === placement.truckId
            )
          : false

        return (
          placement?.assignmentId &&
          placement.truckId &&
          hasTruckPosition &&
          typeof mission.pickupLat === 'number' &&
          typeof mission.pickupLng === 'number'
        )
      })
      .slice(0, 10)

    if (missionsToCompute.length === 0) {
      setApproachMessage(null)
      setApproachError('Aucune approche calculable dans la vue filtrée.')
      return
    }

    try {
      setIsApproachLoading(true)
      setApproachMessage(null)
      setApproachError(null)

      let computedCount = 0
      let failedCount = 0
      const failedReasons: string[] = []

      for (const mission of missionsToCompute) {
        const placement = placements[mission.id]

        if (!placement?.assignmentId) {
          continue
        }

        try {
          const response = await fetch('/api/dispatch/compute-approach-route', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              assignmentId: placement.assignmentId,
              forceRefresh: false,
            }),
          })

          if (!response.ok) {
            failedCount += 1
            const errorPayload = (await response
              .json()
              .catch(() => null)) as ApproachRouteErrorResponse | null
            failedReasons.push(getApproachErrorLabel(errorPayload))
            console.error('Unable to compute approach route', {
              missionId: mission.id,
              assignmentId: placement.assignmentId,
              payload: errorPayload,
            })
            continue
          }

          const route = (await response.json()) as ApproachRouteResponse
          computedCount += 1
          onApproachRouteUpdate?.(route.missionId, {
            approachDistanceMeters: route.distanceMeters,
            approachDurationSeconds: route.durationSeconds,
            approachPolyline: route.polyline,
            approachCalculatedAt: new Date().toISOString(),
            approachProvider: 'GOOGLE_ROUTES',
          })
        } catch (error) {
          failedCount += 1
          failedReasons.push(
            error instanceof Error ? error.message : 'erreur inconnue'
          )
          console.error('Unable to compute approach route', mission.id, error)
        }
      }

      setApproachMessage(
        `${computedCount} approche(s) calculée(s)${
          failedCount > 0 ? ` · ${failedCount} échec(s)` : ''
        }`
      )
      setApproachError(
        failedReasons.length > 0
          ? Array.from(new Set(failedReasons)).slice(0, 3).join(' · ')
          : null
      )
    } finally {
      setIsApproachLoading(false)
    }
  }

  async function handleComputeApproachForTruck(marker: TruckMapMarker) {
    const mission = marker.mission
    const placement = marker.placement

    if (!mission || !placement?.assignmentId) {
      setApproachError('Aucune mission assignée pour ce camion.')
      return
    }

    try {
      setIsApproachLoading(true)
      setApproachMessage(null)
      setApproachError(null)

      const response = await fetch('/api/dispatch/compute-approach-route', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assignmentId: placement.assignmentId,
          forceRefresh: false,
        }),
      })

      if (!response.ok) {
        const errorPayload = (await response
          .json()
          .catch(() => null)) as ApproachRouteErrorResponse | null
        console.error('Unable to compute approach route', {
          missionId: mission.id,
          assignmentId: placement.assignmentId,
          payload: errorPayload,
        })
        setApproachError(getApproachErrorLabel(errorPayload))
        return
      }

      const route = (await response.json()) as ApproachRouteResponse
      onApproachRouteUpdate?.(route.missionId, {
        approachDistanceMeters: route.distanceMeters,
        approachDurationSeconds: route.durationSeconds,
        approachPolyline: route.polyline,
        approachCalculatedAt: new Date().toISOString(),
        approachProvider: 'GOOGLE_ROUTES',
      })
      setApproachMessage('Approche calculée.')
    } catch (error) {
      console.error('Unable to compute approach route', mission.id, error)
      setApproachError(
        error instanceof Error ? error.message : 'Approche impossible.'
      )
    } finally {
      setIsApproachLoading(false)
    }
  }

  async function handleUpdateTruckStatus(truckId: string, status: TruckStatus) {
    const response = await fetch('/api/dispatch/update-truck-status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        truckId,
        status,
      }),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      console.error('Unable to update truck status', {
        truckId,
        status,
        payload,
      })
      throw new Error('Statut camion impossible à mettre à jour.')
    }

    const result = (await response.json()) as UpdateTruckStatusResponse
    onTruckStatusUpdate?.(
      truckId,
      result.truck.status ?? status,
      result.truck.statusUpdatedAt
    )
  }

  async function handleComputeReturnToBase(
    truckId: string,
    forceRefresh = false
  ) {
    try {
      setReturnBaseLoadingTruckId(truckId)
      setReturnBaseError(null)

      const response = await fetch(
        '/api/dispatch/compute-return-to-base-route',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            truckId,
            forceRefresh,
          }),
        }
      )

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        console.error('Unable to compute return-to-base route', {
          truckId,
          payload,
        })
        setReturnBaseError('Retour base impossible pour ce camion.')
        return
      }

      const route = (await response.json()) as ReturnToBaseRouteResponse
      onTruckReturnRouteUpdate?.(route.truckId, {
        returnToBaseDistanceMeters: route.distanceMeters,
        returnToBaseDurationSeconds: route.durationSeconds,
        returnToBasePolyline: route.polyline,
        returnToBaseCalculatedAt: new Date().toISOString(),
        returnToBaseProvider: 'GOOGLE_ROUTES',
      })

      if (!forceRefresh) {
        await handleUpdateTruckStatus(route.truckId, 'RETURNING_TO_BASE')
      }
    } catch (error) {
      console.error('Unable to compute return-to-base route', truckId, error)
      setReturnBaseError('Retour base impossible pour ce camion.')
    } finally {
      setReturnBaseLoadingTruckId(null)
    }
  }

  useEffect(() => {
    if (!map || typeof window === 'undefined' || !window.google) {
      return
    }

    const positions = [
      basePosition,
      ...visibleTruckMarkers.map((marker) => marker.position),
      ...missionMarkers.map((marker) => marker.position),
      ...routePolylines.flatMap((route) => route.path),
      ...approachPolylines.flatMap((route) => route.path),
      ...returnToBasePolylines.flatMap((route) => route.path),
    ].filter(isValidMapPoint)

    if (positions.length === 0) {
      map.setCenter(luxembourgCenter)
      map.setZoom(7)
      return
    }

    const bounds = new window.google.maps.LatLngBounds()
    positions.forEach((position) => bounds.extend(position))
    map.fitBounds(bounds, 72)

    if (positions.length === 1) {
      map.setZoom(9)
    }
  }, [
    approachPolylines,
    map,
    missionMarkers,
    returnToBasePolylines,
    routePolylines,
    visibleTruckMarkers,
  ])

  const createMarkerIcon = useCallback(
    ({
      label,
      background,
      color,
      size,
    }: {
      label: string
      background: string
      color: string
      size: number
    }): MarkerIcon | undefined => {
      if (!isLoaded || typeof window === 'undefined' || !window.google) {
        return undefined
      }

      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <defs>
            <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#11130f" flood-opacity="0.28"/>
            </filter>
          </defs>
          <circle cx="${size / 2}" cy="${size / 2}" r="${
        size / 2 - 4
      }" fill="${background}" stroke="#ffffff" stroke-width="3" filter="url(#shadow)"/>
          <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${
            label.length > 3 ? 9 : 11
          }" font-weight="900" fill="${color}">${label}</text>
        </svg>
      `

      return {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
        scaledSize: new window.google.maps.Size(size, size),
        anchor: new window.google.maps.Point(size / 2, size / 2),
      }
    },
    [isLoaded]
  )

  const getTruckIcon = useCallback(
    (marker: TruckMapMarker) => {
      const markerStyle = truckMarkerStyles[marker.truck.status ?? 'AVAILABLE']

      return createMarkerIcon({
        label: marker.truck.plateNumber.slice(-3),
        background: markerStyle.background,
        color: markerStyle.color,
        size: 42,
      })
    },
    [createMarkerIcon]
  )

  const pickupIcon = useMemo(() => {
    if (!isLoaded || typeof window === 'undefined' || !window.google) {
      return undefined
    }

    return createMarkerIcon({
      label: 'DÉP',
      background: '#EFFF00',
      color: '#11130f',
      size: 40,
    })
  }, [createMarkerIcon, isLoaded])

  const deliveryIcon = useMemo(() => {
    if (!isLoaded || typeof window === 'undefined' || !window.google) {
      return undefined
    }

    return createMarkerIcon({
      label: 'LIV',
      background: '#FFB020',
      color: '#11130f',
      size: 40,
    })
  }, [createMarkerIcon, isLoaded])

  const baseIcon = useMemo(() => {
    if (!isLoaded || typeof window === 'undefined' || !window.google) {
      return undefined
    }

    return createMarkerIcon({
      label: 'BASE',
      background: '#11130f',
      color: '#ffffff',
      size: 42,
    })
  }, [createMarkerIcon, isLoaded])

  if (loadError) {
    return (
      <MapShell>
        <div className="flex h-full items-center justify-center p-8 text-center">
          <div className="max-w-sm rounded-[26px] border border-black/5 bg-white p-5 shadow-[0_18px_55px_rgba(17,18,15,0.14)]">
            <p className="text-sm font-semibold text-[#151611]">
              Google Maps indisponible
            </p>
            <p className="mt-2 text-xs font-medium leading-relaxed text-[#6f7469]">
              La carte n’a pas pu être chargée. Le planning reste disponible.
            </p>
          </div>
        </div>
      </MapShell>
    )
  }

  if (!isLoaded) {
    return (
      <MapShell>
        <div className="flex h-full items-center justify-center">
          <div className="rounded-full border border-black/5 bg-white px-4 py-2 text-xs font-semibold text-[#4f5549] shadow-[0_14px_38px_rgba(17,18,15,0.12)]">
            Chargement Google Maps...
          </div>
        </div>
      </MapShell>
    )
  }

  return (
    <MapShell>
      <GoogleMap
        center={luxembourgCenter}
        mapContainerStyle={containerStyle}
        onClick={() => setSelectedMarker(null)}
        onLoad={handleMapLoad}
        options={mapOptions}
        zoom={7}
      >
        <MarkerF icon={baseIcon} position={basePosition} />

        {visibleTruckMarkers.map((marker) => (
          <MarkerF
            key={marker.id}
            icon={getTruckIcon(marker)}
            onClick={() => {
              setReturnBaseError(null)
              onTruckOpen?.()
              setSelectedMarker({
                type: 'truck',
                id: marker.id,
              })
            }}
            position={marker.position}
          />
        ))}

        {missionMarkers.map((marker) => (
          <MarkerF
            key={marker.id}
            icon={marker.kind === 'pickup' ? pickupIcon : deliveryIcon}
            onClick={() =>
              setSelectedMarker({
                type: 'mission',
                id: marker.id,
              })
            }
            position={marker.position}
          />
        ))}

        {routePolylines.map((route) => (
          <PolylineF
            key={route.mission.id}
            options={{
              strokeColor: routeStatusStyles[route.mission.status],
              strokeOpacity:
                route.mission.id === selectedMapMissionId ? 1 : 0.75,
              strokeWeight: route.mission.id === selectedMapMissionId ? 7 : 5,
              clickable: false,
            }}
            path={route.path}
          />
        ))}

        {approachPolylines.map((route) => (
          <PolylineF
            key={`approach:${route.placement.assignmentId ?? route.mission.id}`}
            options={{
              strokeColor: '#38BDF8',
              strokeOpacity: 0.85,
              strokeWeight: 4,
              clickable: false,
              icons: [
                {
                  icon: {
                    path: 'M 0,-1 0,1',
                    strokeOpacity: 1,
                    scale: 3,
                  },
                  offset: '0',
                  repeat: '18px',
                },
              ],
            }}
            path={route.path}
          />
        ))}

        {returnToBasePolylines.map((route) => (
          <PolylineF
            key={`return-base:${route.truck.id}`}
            options={{
              strokeColor: '#FF9F1C',
              strokeOpacity: 0.9,
              strokeWeight: 4,
              clickable: false,
              icons: [
                {
                  icon: {
                    path: 'M 0,-1 0,1',
                    strokeOpacity: 1,
                    scale: 3,
                  },
                  offset: '0',
                  repeat: '18px',
                },
              ],
            }}
            path={route.path}
          />
        ))}

        {selectedTruckMarker ? (
          <InfoWindow
            onCloseClick={() => setSelectedMarker(null)}
            position={selectedTruckMarker.position}
          >
            <TruckInfoCard
              error={returnBaseError}
              isApproachLoading={isApproachLoading}
              isLoading={
                returnBaseLoadingTruckId === selectedTruckMarker.truck.id
              }
              marker={selectedTruckMarker}
              positionNow={positionNow}
              onClose={() => setSelectedMarker(null)}
              onComputeApproach={() =>
                handleComputeApproachForTruck(selectedTruckMarker)
              }
              onComputeReturnToBase={(forceRefresh) =>
                handleComputeReturnToBase(
                  selectedTruckMarker.truck.id,
                  forceRefresh
                )
              }
              onTruckStatusChange={(status) =>
                handleUpdateTruckStatus(
                  selectedTruckMarker.truck.id,
                  status
                ).catch((error) => {
                  console.error('Unable to update truck status', error)
                  setReturnBaseError('Statut camion impossible à corriger.')
                })
              }
            />
          </InfoWindow>
        ) : null}

        {selectedMissionMarker ? (
          <InfoWindow
            onCloseClick={() => setSelectedMarker(null)}
            position={selectedMissionMarker.position}
          >
            <MissionInfoCard
              marker={selectedMissionMarker}
              onClose={() => setSelectedMarker(null)}
              onMissionClick={(mission) => {
                setSelectedMarker(null)
                onMissionClick?.(mission)
              }}
            />
          </InfoWindow>
        ) : null}
      </GoogleMap>

      <MapFilters
        dayFilter={dayFilter}
        driverFilter={driverFilter}
        drivers={drivers}
        onDayChange={setDayFilter}
        onDriverChange={setDriverFilter}
        onReset={() => {
          setStatusFilter('all')
          setDriverFilter('all')
          setTruckFilter('all')
          setDayFilter('all')
          setSearchQuery('')
        }}
        onSearchChange={setSearchQuery}
        onStatusChange={setStatusFilter}
        onTruckChange={setTruckFilter}
        searchQuery={searchQuery}
        statusFilter={statusFilter}
        truckFilter={truckFilter}
        trucks={trucks}
      />

      <MapRouteTools
        approachCount={approachPolylines.length}
        approachError={approachError}
        approachMessage={approachMessage}
        error={routeError}
        isOpen={isRouteToolsOpen}
        isApproachLoading={isApproachLoading}
        isLoading={isRouteLoading}
        message={routeBatchMessage}
        missingCoordinatesCount={
          filteredMapMissions.filter(
            (mission) =>
              typeof mission.pickupLat !== 'number' ||
              typeof mission.pickupLng !== 'number' ||
              typeof mission.deliveryLat !== 'number' ||
              typeof mission.deliveryLng !== 'number'
          ).length
        }
        routeCount={routePolylines.length}
        totalMissionCount={filteredMapMissions.length}
        onCompute={() => handleComputeWeekRoutes(false)}
        onComputeApproaches={handleComputeApproachRoutes}
        onOpenChange={setIsRouteToolsOpen}
        onRefresh={() => handleComputeWeekRoutes(true)}
      />

      <div className="pointer-events-none absolute bottom-5 left-5 z-10 grid w-[340px] grid-cols-3 gap-2 rounded-[34px] border border-black/5 bg-[#F3F4F0] p-2">
        <Metric label="Camions" value={String(visibleTruckMarkers.length)} />
        <Metric label="Positions récentes" value={String(visibleTruckMarkers.filter((marker) => isRecentPosition(marker.recordedAt, positionNow)).length)} />
        <Metric
          label="Tracés"
          value={`${routePolylines.length}+${approachPolylines.length}+${returnToBasePolylines.length}`}
        />
      </div>

      <p className="pointer-events-none absolute bottom-20 left-5 z-10 rounded-xl bg-white/95 px-2 py-1 text-[10px] font-semibold text-[#4f5549] shadow-sm">
        {visibleTruckMarkers.length === 0
          ? 'Position téléphone indisponible'
          : `${visibleTruckMarkers.filter((marker) => !isRecentPosition(marker.recordedAt, positionNow)).length} position(s) ancienne(s) · dernière heure dans la fiche camion`}
      </p>

      <MissionOverlay
        missions={filteredMapMissions}
        placements={placements}
        onMissionSelect={(mission) => {
          setSelectedMapMissionId(mission.id)
          setSelectedMarker(null)
          setRouteError(null)
          onMissionClick?.(mission)
        }}
        selectedMissionId={selectedMapMissionId}
      />
    </MapShell>
  )
}

function MapShell({ children }: { children: ReactNode }) {
  return (
    <section className="relative h-[calc(100vh-296px)] min-h-[560px] overflow-hidden rounded-[30px] bg-[#eef0ea] shadow-[0_22px_72px_rgba(17,18,15,0.12)]">
      {children}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[26px] border border-black/[0.04] bg-white px-3 py-2 shadow-none">
      <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#62665b]">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-[#151611]">{value}</p>
    </div>
  )
}

function MapFilters({
  dayFilter,
  driverFilter,
  drivers,
  onDayChange,
  onDriverChange,
  onReset,
  onSearchChange,
  onStatusChange,
  onTruckChange,
  searchQuery,
  statusFilter,
  truckFilter,
  trucks,
}: {
  dayFilter: DispatchDay | 'all'
  driverFilter: string
  drivers: Driver[]
  onDayChange: (value: DispatchDay | 'all') => void
  onDriverChange: (value: string) => void
  onReset: () => void
  onSearchChange: (value: string) => void
  onStatusChange: (value: StatusFilter) => void
  onTruckChange: (value: string) => void
  searchQuery: string
  statusFilter: StatusFilter
  truckFilter: string
  trucks: Truck[]
}) {
  return (
    <div className={`absolute left-[84px] right-[365px] top-5 z-10 p-2.5 ${controlPanelClass}`}>
      <div className="grid grid-cols-[1.2fr_0.9fr_0.9fr_0.9fr_0.9fr_auto] items-end gap-2">
        <FilterField label="Recherche">
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Référence, client, ville..."
            className={controlFieldClass}
          />
        </FilterField>

        <FilterField label="Statut">
          <select
            value={statusFilter}
            onChange={(event) =>
              onStatusChange(event.target.value as StatusFilter)
            }
            className={controlFieldClass}
          >
            {statusFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Chauffeur">
          <select
            value={driverFilter}
            onChange={(event) => onDriverChange(event.target.value)}
            className={controlFieldClass}
          >
            <option value="all">Tous</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.name}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Camion">
          <select
            value={truckFilter}
            onChange={(event) => onTruckChange(event.target.value)}
            className={controlFieldClass}
          >
            <option value="all">Tous</option>
            {trucks.map((truck) => (
              <option key={truck.id} value={truck.id}>
                {truck.plateNumber}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Jour">
          <select
            value={dayFilter}
            onChange={(event) =>
              onDayChange(event.target.value as DispatchDay | 'all')
            }
            className={controlFieldClass}
          >
            <option value="all">Tous</option>
            {dispatchDays.map((day) => (
              <option key={day} value={day}>
                {dayLabels[day]}
              </option>
            ))}
          </select>
        </FilterField>

        <ControlButton
          label="Réinitialiser les filtres"
          icon={<Icons.refresh />}
          onClick={onReset}
        />
      </div>
    </div>
  )
}

function FilterField({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[9px] font-bold uppercase tracking-[0.16em] text-[#62665b]">
        {label}
      </span>
      {children}
    </label>
  )
}

type MiniIconProps = {
  className?: string
}

function TruckMiniIcon({ className = 'h-4 w-4' }: MiniIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h10v9H4z" />
      <path d="M14 10h3l3 3v3h-6z" />
      <path d="M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
      <path d="M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
    </svg>
  )
}

function UserMiniIcon({ className = 'h-4 w-4' }: MiniIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function SpeedMiniIcon({ className = 'h-4 w-4' }: MiniIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 14a8 8 0 1 1 16 0" />
      <path d="M12 14l4-4" />
      <path d="M5 19h14" />
    </svg>
  )
}

function RouteIcon({ className = 'h-4 w-4' }: MiniIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 19a3 3 0 1 1 0-6h12a3 3 0 1 0 0-6H8" />
      <path d="M8 7l-3 3 3 3" />
    </svg>
  )
}

function BaseMiniIcon({ className = 'h-4 w-4' }: MiniIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 21h18" />
      <path d="M5 21V9l7-4 7 4v12" />
      <path d="M9 21v-6h6v6" />
    </svg>
  )
}

function RefreshMiniIcon({ className = 'h-4 w-4' }: MiniIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 1-15 6.7" />
      <path d="M3 12a9 9 0 0 1 15-6.7" />
      <path d="M18 3v5h-5" />
      <path d="M6 21v-5h5" />
    </svg>
  )
}

function MapRouteTools({
  approachCount,
  approachError,
  approachMessage,
  error,
  isOpen,
  isApproachLoading,
  isLoading,
  message,
  missingCoordinatesCount,
  routeCount,
  totalMissionCount,
  onCompute,
  onComputeApproaches,
  onOpenChange,
  onRefresh,
}: {
  approachCount: number
  approachError: string | null
  approachMessage: string | null
  error: string | null
  isOpen: boolean
  isApproachLoading: boolean
  isLoading: boolean
  message: string | null
  missingCoordinatesCount: number
  routeCount: number
  totalMissionCount: number
  onCompute: () => void
  onComputeApproaches: () => void
  onOpenChange: (isOpen: boolean) => void
  onRefresh: () => void
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target

      if (!(target instanceof Node)) {
        return
      }

      if (popoverRef.current?.contains(target)) {
        return
      }

      onOpenChange(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onOpenChange(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onOpenChange])

  return (
    <div ref={popoverRef} className="absolute left-5 top-5 z-20">
      <button
        type="button"
        aria-label="Calculs itinéraires"
        title="Calculs itinéraires"
        onClick={() => onOpenChange(!isOpen)}
        className="group flex h-[46px] w-[46px] items-center justify-center rounded-[18px] border border-black/5 bg-white text-[#11130f] shadow-[0_14px_38px_rgba(17,18,15,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.03] hover:shadow-[0_18px_46px_rgba(17,18,15,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/60"
      >
        <RouteIcon className="h-[18px] w-[18px]" />
      </button>

      {isOpen ? (
        <div className="mt-3 w-[320px] rounded-[26px] border border-black/5 bg-white p-4 shadow-[0_18px_55px_rgba(17,18,15,0.14)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#62665b]">
                Calculs itinéraires
              </p>
              <p className="mt-1 text-xs font-semibold text-[#151611]">
                {routeCount} mission · {approachCount} approche ·{' '}
                {totalMissionCount} visible(s)
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full bg-black/[0.04] px-2 py-1 text-xs font-bold text-[#62665b] transition hover:bg-black/[0.08]"
            >
              ×
            </button>
          </div>

          <p className="mt-3 rounded-2xl bg-[#F3F4F0] px-3 py-2 text-[11px] font-semibold leading-snug text-[#62665b]">
            Les calculs utilisent Google Routes uniquement sur demande.
          </p>

          {missingCoordinatesCount > 0 ? (
            <p className="mt-2 rounded-2xl bg-[#F3F4F0] px-3 py-2 text-[11px] font-semibold text-[#62665b]">
              {missingCoordinatesCount} mission(s) sans coordonnées.
            </p>
          ) : null}

          {message ? (
            <p className="mt-2 rounded-2xl border border-lime-200 bg-lime-50 px-3 py-2 text-[11px] font-semibold text-[#49630b]">
              {message}
            </p>
          ) : null}

          {approachMessage ? (
            <p className="mt-2 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-800">
              {approachMessage}
            </p>
          ) : null}

          {error || approachError ? (
            <p className="mt-2 rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
              {error ?? approachError}
            </p>
          ) : null}

          <div className="mt-3 grid gap-2">
            <button
              type="button"
              onClick={onCompute}
              disabled={isLoading}
              className="disabled:opacity-55 rounded-2xl bg-[#11130f] px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-[#252820] disabled:cursor-not-allowed"
            >
              {isLoading ? 'Calcul...' : 'Calculer itinéraires'}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="disabled:opacity-55 rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-xs font-semibold text-[#4f5549] transition hover:border-lime-300 disabled:cursor-not-allowed"
            >
              Recalculer itinéraires
            </button>
            <button
              type="button"
              onClick={onComputeApproaches}
              disabled={isApproachLoading}
              className="disabled:opacity-55 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs font-semibold text-sky-800 transition hover:border-sky-300 disabled:cursor-not-allowed"
            >
              {isApproachLoading ? 'Calcul...' : 'Calculer approches'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TruckInfoCard({
  error,
  isApproachLoading,
  isLoading,
  marker,
  positionNow,
  onClose,
  onComputeApproach,
  onComputeReturnToBase,
  onTruckStatusChange,
}: {
  error: string | null
  isApproachLoading: boolean
  isLoading: boolean
  marker: TruckMapMarker
  positionNow: number
  onClose: () => void
  onComputeApproach: () => void
  onComputeReturnToBase: (forceRefresh: boolean) => void
  onTruckStatusChange: (status: TruckStatus) => void
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [events, setEvents] = useState<TruckEventItem[]>([])
  const [isEventsLoading, setIsEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const truckStatus = marker.truck.status ?? 'AVAILABLE'
  const hasReturnToBaseRoute =
    typeof marker.truck.returnToBaseDistanceMeters === 'number' &&
    typeof marker.truck.returnToBaseDurationSeconds === 'number'
  const hasApproachRoute =
    typeof marker.placement?.approachDistanceMeters === 'number' &&
    typeof marker.placement?.approachDurationSeconds === 'number'
  const canComputeApproach =
    Boolean(marker.mission) &&
    typeof marker.mission?.pickupLat === 'number' &&
    typeof marker.mission?.pickupLng === 'number' &&
    !marker.placement?.approachPolyline
  const canRequestReturnToBase =
    truckStatus !== 'RETURNING_TO_BASE' &&
    truckStatus !== 'AT_BASE' &&
    !hasReturnToBaseRoute

  useEffect(() => {
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target

      if (!(target instanceof Node)) {
        return
      }

      if (cardRef.current?.contains(target)) {
        return
      }

      onClose()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  useEffect(() => {
    if (!isHistoryOpen) {
      return
    }

    let isMounted = true

    async function loadTruckEvents() {
      try {
        setIsEventsLoading(true)
        setEventsError(null)

        const response = await fetch(
          `/api/dispatch/truck-events?truckId=${encodeURIComponent(
            marker.truck.id
          )}`
        )

        if (!response.ok) {
          throw new Error(`Truck events API returned ${response.status}`)
        }

        const data = (await response.json()) as TruckEventsResponse

        if (isMounted) {
          setEvents(data.events)
        }
      } catch (historyError) {
        console.error('Unable to load truck events', historyError)

        if (isMounted) {
          setEventsError('Historique indisponible.')
        }
      } finally {
        if (isMounted) {
          setIsEventsLoading(false)
        }
      }
    }

    loadTruckEvents()

    return () => {
      isMounted = false
    }
  }, [isHistoryOpen, marker.truck.id])

  return (
    <div
      ref={cardRef}
      className="w-[280px] rounded-[24px] border border-black/5 bg-white p-3 font-sans text-[#151611] shadow-[0_12px_34px_rgba(17,18,15,0.10)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[13px] bg-[#11130f] text-white">
            <TruckMiniIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight">
              {marker.truck.plateNumber}
            </p>
            <p className="truncate text-[11px] font-semibold text-[#62665b]">
              {marker.truck.model ?? 'Modèle non renseigné'}
            </p>
          </div>
        </div>
        <span
          className={[
            'shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold leading-tight',
            truckStatusBadgeStyles[truckStatus],
          ].join(' ')}
        >
          {truckStatusLabels[truckStatus]}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-semibold text-[#4f5549]">
        <div className="flex min-w-0 items-center gap-1.5 rounded-2xl bg-[#F3F4F0] px-2.5 py-2">
          <UserMiniIcon className="h-3.5 w-3.5 shrink-0 text-[#73796d]" />
          <span className="truncate">
            {marker.driver?.name ?? 'Sans chauffeur'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-2xl bg-[#F3F4F0] px-2.5 py-2">
          <SpeedMiniIcon className="h-3.5 w-3.5 shrink-0 text-[#73796d]" />
          <span>
            {typeof marker.speedKmh === 'number'
              ? `${Math.round(marker.speedKmh)} km/h`
              : 'Vitesse N/A'}
          </span>
        </div>
      </div>

      {marker.mission ? (
        <div className="mt-2 rounded-[18px] border border-black/5 bg-white px-3 py-2 shadow-none">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs font-bold text-[#151611]">
              {marker.mission.reference}
            </p>
            <span
              className={[
                'shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold leading-tight',
                missionStatusBadgeStyles[marker.mission.status],
              ].join(' ')}
            >
              {statusLabels[marker.mission.status]}
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] font-semibold text-[#62665b]">
            {marker.mission.pickupCity} → {marker.mission.deliveryCity}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2 rounded-2xl bg-[#F3F4F0] px-2.5 py-2">
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#73796d]">
                Approche
              </p>
              <p className="mt-0.5 truncate text-[11px] font-semibold text-[#151611]">
                {hasApproachRoute
                  ? `${Math.round(
                      marker.placement!.approachDistanceMeters! / 1000
                    )} km · ${formatRouteDuration(
                      marker.placement!.approachDurationSeconds!
                    )}`
                  : 'À calculer'}
              </p>
            </div>
            {canComputeApproach ? (
              <button
                type="button"
                title="Calculer approche"
                onClick={onComputeApproach}
                disabled={isApproachLoading}
                className="disabled:opacity-55 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-white text-sky-800 transition hover:border-sky-300 hover:bg-sky-50 disabled:cursor-not-allowed"
              >
                <RouteIcon className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-2 rounded-[18px] border border-black/5 bg-white px-3 py-2 shadow-none">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#62665b]">
              Retour base
            </p>
            <p className="mt-0.5 truncate text-xs font-semibold text-[#151611]">
              {hasReturnToBaseRoute
                ? `${Math.round(
                    marker.truck.returnToBaseDistanceMeters! / 1000
                  )} km · ${formatRouteDuration(
                    marker.truck.returnToBaseDurationSeconds!
                  )}`
                : 'Route à calculer'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!hasReturnToBaseRoute && canRequestReturnToBase ? (
              <button
                type="button"
                title="Retour base"
                onClick={() => onComputeReturnToBase(false)}
                disabled={isLoading}
                className="disabled:opacity-55 flex h-8 items-center gap-1.5 rounded-xl bg-[#11130f] px-2.5 text-[11px] font-semibold text-white transition hover:bg-[#252820] disabled:cursor-not-allowed"
              >
                <BaseMiniIcon className="h-3.5 w-3.5" />
                Base
              </button>
            ) : null}
            {hasReturnToBaseRoute ? (
              <button
                type="button"
                title="Recalculer retour base"
                onClick={() => onComputeReturnToBase(true)}
                disabled={isLoading}
                className="disabled:opacity-55 flex h-8 w-8 items-center justify-center rounded-xl border border-black/10 bg-white text-[#4f5549] transition hover:border-orange-300 hover:text-[#11130f] disabled:cursor-not-allowed"
              >
                <RefreshMiniIcon className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
        {hasReturnToBaseRoute ? (
          <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[#73796d]">
            Itinéraire retour prêt
          </p>
        ) : null}
        {error ? (
          <p className="mt-1.5 text-[11px] font-semibold text-red-700">
            {error}
          </p>
        ) : null}
      </div>

      <label className="mt-2 block rounded-[18px] border border-black/5 bg-white px-3 py-2 shadow-none">
        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#62665b]">
          Corriger statut
        </span>
        <select
          value={truckStatus}
          onChange={(event) =>
            onTruckStatusChange(event.target.value as TruckStatus)
          }
          className="mt-1.5 h-8 w-full rounded-xl border border-black/5 bg-[#F3F4F0] px-2 text-[11px] font-semibold text-[#151611] outline-none transition focus:border-lime-300 focus:bg-white"
        >
          {truckStatusOptions.map((status) => (
            <option key={status} value={status}>
              {truckStatusLabels[status]}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={() => setIsHistoryOpen((isOpen) => !isOpen)}
        className="mt-2 flex h-8 w-full items-center justify-between rounded-[16px] border border-black/5 bg-white px-3 text-[11px] font-bold text-[#4f5549] transition hover:bg-[#F3F4F0]"
      >
        Historique
        <span className="text-[#8b9085]">{isHistoryOpen ? '−' : '+'}</span>
      </button>

      {isHistoryOpen ? (
        <div className="mt-2 max-h-[190px] overflow-y-auto rounded-[18px] border border-black/5 bg-white p-2 shadow-none">
          {isEventsLoading ? (
            <p className="rounded-2xl bg-[#F3F4F0] px-3 py-2 text-[11px] font-semibold text-[#62665b]">
              Chargement...
            </p>
          ) : null}

          {eventsError ? (
            <p className="rounded-2xl bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
              {eventsError}
            </p>
          ) : null}

          {!isEventsLoading && !eventsError && events.length === 0 ? (
            <p className="rounded-2xl bg-[#F3F4F0] px-3 py-2 text-[11px] font-semibold text-[#62665b]">
              Aucun changement enregistré.
            </p>
          ) : null}

          <div className="space-y-1.5">
            {events.map((event) => (
              <div
                key={event.id}
                className="rounded-2xl bg-[#F3F4F0] px-3 py-2"
              >
                <p className="text-[11px] font-bold text-[#151611]">
                  {event.fromStatus
                    ? truckStatusLabels[event.fromStatus]
                    : 'Initial'}{' '}
                  → {truckStatusLabels[event.toStatus]}
                </p>
                {event.message ? (
                  <p className="mt-0.5 text-[10px] font-semibold text-[#62665b]">
                    {event.message}
                  </p>
                ) : null}
                <p className="mt-1 text-[10px] font-medium text-[#8b9085]">
                  {formatDateTime(event.createdAt)}
                  {event.actor?.name ? ` · ${event.actor.name}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="mt-2 text-[10px] font-bold text-[#62665b]">
        {isRecentPosition(marker.recordedAt, positionNow) ? 'Position récente' : 'Position ancienne'} · {marker.provider === 'DEMO_SIMULATED' ? 'simulation de démo' : 'téléphone chauffeur'}
      </p>
      <p className="text-[10px] font-medium text-[#8b9085]">
        Dernière position {formatDateTime(marker.recordedAt)}
      </p>
    </div>
  )
}

function MissionInfoCard({
  marker,
  onClose,
  onMissionClick,
}: {
  marker: MissionMapMarker
  onClose: () => void
  onMissionClick?: (mission: Mission) => void
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target

      if (!(target instanceof Node)) {
        return
      }

      if (cardRef.current?.contains(target)) {
        return
      }

      onClose()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={cardRef}
      className="w-[290px] rounded-2xl border border-black/5 bg-white p-3 font-sans text-[#151611] shadow-[0_18px_55px_rgba(17,18,15,0.14)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#62665b]">
            {marker.kind === 'pickup' ? 'Départ' : 'Livraison'}
          </p>
          <p className="mt-1 truncate text-base font-semibold">
            {marker.mission.reference}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[#B9FF4A] px-2 py-1 text-[10px] font-bold text-[#2f3a17]">
          {statusLabels[marker.mission.status]}
        </span>
      </div>
      <p className="mt-2 text-xs font-semibold text-[#34372f]">
        {marker.mission.clientName}
      </p>
      <p className="mt-1 text-xs font-medium text-[#62665b]">
        {marker.mission.pickupCity} -&gt; {marker.mission.deliveryCity}
      </p>
      <p className="mt-2 text-[11px] font-medium text-[#7b8075]">
        {marker.driver?.name ?? 'Chauffeur non assigné'}
        {marker.truck ? ` · ${marker.truck.plateNumber}` : ''}
      </p>
      {onMissionClick ? (
        <button
          type="button"
          onClick={() => onMissionClick(marker.mission)}
          className="mt-3 w-full rounded-2xl bg-[#11130f] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#252820]"
        >
          Voir détail
        </button>
      ) : null}
    </div>
  )
}

function MissionOverlay({
  missions,
  placements,
  onMissionSelect,
  selectedMissionId,
}: {
  missions: Mission[]
  placements: Record<string, MissionPlacement | null>
  onMissionSelect: (mission: Mission) => void
  selectedMissionId: string | null
}) {
  const assignedMissions = missions.filter(
    (mission) => placements[mission.id] !== null
  )

  return (
    <aside className="absolute bottom-5 right-5 top-5 z-10 w-[340px] overflow-hidden rounded-[34px] border border-black/5 bg-[#F3F4F0] p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#62665b]">
            Missions assignées
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight text-[#151611]">
            Semaine active
          </h3>
        </div>
        <span className="rounded-full border border-black/5 bg-white px-3 py-1 text-xs font-bold text-[#34372f]">
          {assignedMissions.length}
        </span>
      </div>

      {!selectedMissionId && assignedMissions.length > 0 ? (
        <p className="mt-3 rounded-[20px] border border-black/[0.04] bg-white px-3 py-2 text-[11px] font-semibold text-[#62665b]">
          Sélectionnez une mission pour afficher son trajet.
        </p>
      ) : null}

      <div className="mt-4 space-y-2 overflow-y-auto pr-1 [max-height:calc(100%-110px)]">
        {assignedMissions.length === 0 ? (
          <p className="rounded-[26px] border border-black/[0.04] bg-white px-4 py-4 text-sm font-medium text-[#62665b]">
            Aucune mission assignée sur cette semaine.
          </p>
        ) : null}

        {assignedMissions.map((mission) => {
          const isSelected = mission.id === selectedMissionId
          const placement = placements[mission.id]

          return (
            <div key={mission.id} className="space-y-1.5">
              <MissionCard
                mission={mission}
                status={mission.status}
                dragDisabled
                compact
                className={[
                  'w-full',
                  isSelected
                    ? 'ring-lime-300/45 border-lime-300 ring-2'
                    : 'hover:border-black/10',
                ].join(' ')}
                onClick={onMissionSelect}
              />
              <div className="rounded-2xl border border-black/[0.04] bg-white px-3 py-2 text-[10px] font-semibold leading-snug text-[#62665b]">
                <p>
                  Camion → pickup :{' '}
                  {placement?.approachDistanceMeters &&
                  placement.approachDurationSeconds
                    ? `${Math.round(
                        placement.approachDistanceMeters / 1000
                      )} km · ${formatRouteDuration(
                        placement.approachDurationSeconds
                      )}`
                    : 'Approche à calculer'}
                </p>
                <p className="mt-0.5">
                  Pickup → livraison :{' '}
                  {mission.routeDistanceMeters && mission.routeDurationSeconds
                    ? `${Math.round(
                        mission.routeDistanceMeters / 1000
                      )} km · ${formatRouteDuration(
                        mission.routeDurationSeconds
                      )}`
                    : 'Route à calculer'}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function MockMapFallback({
  drivers,
  trucks,
  missions,
  onMissionClick,
  placements,
  truckAssignments,
  truckPositions = [],
}: DispatchMapViewProps) {
  const assignedMissions = missions.filter(
    (mission) => placements[mission.id] !== null
  )

  return (
    <section className="relative h-[calc(100vh-296px)] min-h-[560px] overflow-hidden rounded-[30px] bg-[#151713] text-white shadow-[0_24px_80px_rgba(17,18,15,0.16)]">
      <div className="bg-[radial-gradient(circle_at_20%_20%,rgba(185,255,74,0.16),transparent_28%),radial-gradient(circle_at_80%_30%,rgba(255,255,255,0.08),transparent_22%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_42%)] absolute inset-0" />
      <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(255,255,255,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.16)_1px,transparent_1px)] [background-size:56px_56px]" />
      <p className="absolute left-6 top-6 z-10 rounded-full border border-black/5 bg-white px-4 py-2 text-xs font-semibold text-[#62665b] shadow-[0_14px_38px_rgba(17,18,15,0.12)]">
        Clé Google Maps manquante
      </p>
      <div className="absolute bottom-6 left-6 z-10 grid w-[360px] grid-cols-3 gap-2 rounded-[26px] border border-black/5 bg-white p-2 shadow-[0_18px_55px_rgba(17,18,15,0.14)]">
        <FallbackMetric label="Camions" value={String(trucks.length)} />
        <FallbackMetric
          label="Missions"
          value={String(assignedMissions.length)}
        />
        <FallbackMetric
          label="Positions"
          value={String(truckPositions.length)}
        />
      </div>
      <aside className="absolute bottom-6 right-6 top-6 z-10 w-[360px] overflow-hidden rounded-[30px] border border-black/5 bg-white p-4 text-[#151611] shadow-[0_18px_55px_rgba(17,18,15,0.14)]">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#62665b]">
          Missions assignées
        </p>
        <h3 className="mt-1 text-xl font-semibold tracking-tight text-[#151611]">
          Semaine active
        </h3>
        <div className="mt-4 space-y-2">
          {assignedMissions.slice(0, 6).map((mission) => {
            const placement = placements[mission.id]
            const driver = placement
              ? drivers.find((item) => item.id === placement.driverId)
              : undefined
            const truck = placement
              ? trucks.find(
                  (item) =>
                    item.id === placement.truckId ||
                    (placement.driverId &&
                      truckAssignments[item.id] === placement.driverId)
                )
              : undefined

            return (
              <button
                type="button"
                key={mission.id}
                onClick={() => onMissionClick?.(mission)}
                className="w-full rounded-[20px] border border-black/5 bg-white px-3 py-3 text-left shadow-[0_14px_38px_rgba(17,18,15,0.12)] transition hover:border-lime-300"
              >
                <p className="truncate text-sm font-semibold text-[#151611]">
                  {mission.reference}
                </p>
                <p className="mt-1 truncate text-xs font-medium text-[#62665b]">
                  {mission.pickupCity} -&gt; {mission.deliveryCity}
                </p>
                <p className="mt-2 truncate text-[11px] font-semibold text-[#6f7469]">
                  {driver?.name ?? 'Chauffeur non assigné'}
                  {truck ? ` · ${truck.plateNumber}` : ''}
                </p>
              </button>
            )
          })}
        </div>
      </aside>
    </section>
  )
}

function FallbackMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-black/5 bg-white px-3 py-2 shadow-[0_14px_38px_rgba(17,18,15,0.12)]">
      <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#62665b]">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-[#151611]">{value}</p>
    </div>
  )
}

function normalizeSearchValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function getApproachErrorLabel(error: ApproachRouteErrorResponse | null) {
  if (!error) {
    return 'erreur inconnue'
  }

  return error.reason ?? error.error ?? `HTTP ${error.status ?? 500}`
}

function formatRouteDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)

  if (hours <= 0) {
    return `${minutes} min`
  }

  return `${hours} h ${String(minutes).padStart(2, '0')}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-LU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function isRecentPosition(recordedAt: string, now: number) {
  const age = now - new Date(recordedAt).getTime()
  return Number.isFinite(age) && age >= 0 && age <= 5 * 60_000
}
