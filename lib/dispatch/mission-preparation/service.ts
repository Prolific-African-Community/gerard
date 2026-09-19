import {
  AddressResolutionMethod,
  AddressResolutionStatus,
  MissionEventType,
  MissionPreparationStatus,
} from '@prisma/client'
import type { Prisma } from '@prisma/client'

import { prisma } from '../../prisma'
import {
  computeGoogleRoute,
  searchGoogleAddresses,
} from '../maps/google'
import type { AddressCandidate, CalculatedRoute } from '../maps/google'
import {
  buildGeocodingAttempts,
  detectCountry,
  filterCandidatesByCountry,
  logGeocodingTrace,
  normalizeAddressParts,
  rankCandidates,
  stripCountryMentions,
} from '../maps/europe-coverage'
import type {
  AddressParts,
  SupportedCountryCode,
} from '../maps/europe-coverage'
import { chooseAddressCandidate, normalizeAddressText } from './address'
import {
  evaluateMissionPrerequisites,
  prerequisiteMissingCodes,
} from '../mission-prerequisites'

type PreparationProvider = {
  searchAddress(
    query: string,
    maximumResults?: number,
    options?: { country?: SupportedCountryCode | null }
  ): Promise<AddressCandidate[]>
  computeRoute(input: {
    origin: { latitude: number; longitude: number }
    destination: { latitude: number; longitude: number }
  }): Promise<CalculatedRoute>
}

const defaultProvider: PreparationProvider = {
  searchAddress: searchGoogleAddresses,
  computeRoute: computeGoogleRoute,
}

type Endpoint = 'pickup' | 'delivery'

type MissionForPreparation = Awaited<
  ReturnType<typeof prisma.mission.findUniqueOrThrow>
>

type ResolvedEndpoint = {
  status: AddressResolutionStatus
  method: AddressResolutionMethod
  confidence: number
  reason: string
  sourceAddress: string
  normalizedAddress: string
  resolvedAddress: string | null
  placeId: string | null
  latitude: number | null
  longitude: number | null
  alternatives: AddressCandidate[]
}

function sourceAddress(mission: MissionForPreparation, endpoint: Endpoint) {
  const existing =
    endpoint === 'pickup'
      ? mission.pickupSourceAddress
      : mission.deliverySourceAddress
  if (existing?.trim()) return existing.trim()
  const address =
    endpoint === 'pickup' ? mission.pickupAddress : mission.deliveryAddress
  const city = endpoint === 'pickup' ? mission.pickupCity : mission.deliveryCity
  return [address, city].filter(Boolean).join(', ').trim()
}

function existingCoordinates(
  mission: MissionForPreparation,
  endpoint: Endpoint
) {
  const latitude =
    endpoint === 'pickup' ? mission.pickupLat : mission.deliveryLat
  const longitude =
    endpoint === 'pickup' ? mission.pickupLng : mission.deliveryLng
  const placeId =
    endpoint === 'pickup' ? mission.pickupPlaceId : mission.deliveryPlaceId
  const address =
    endpoint === 'pickup' ? mission.pickupAddress : mission.deliveryAddress
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  return { latitude, longitude, placeId, address }
}

/**
 * Résout une adresse en tentant successivement les quatre niveaux de repli.
 *
 * Exportée pour être testable sans base ni réseau : le fournisseur est injecté.
 */
export async function resolveAddressWithFallback(
  input: AddressParts,
  source: string,
  provider: Pick<PreparationProvider, 'searchAddress'>
) {
  const parts = normalizeAddressParts(input)

  // Repli progressif : adresse brute, puis adresse + pays, puis code postal +
  // ville + pays, puis ville + pays. On s'arrête à la première tentative qui
  // produit une correspondance exploitable.
  const attempts = buildGeocodingAttempts(parts)
  let resolution = chooseAddressCandidate(source, [])

  for (const attempt of attempts) {
    let candidates: AddressCandidate[] = []
    try {
      candidates = await provider.searchAddress(attempt.query, 5, {
        country: parts.country ?? null,
      })
    } catch (searchError) {
      logGeocodingTrace({
        attempt,
        country: parts.country ?? null,
        resultCount: 0,
        failureReason:
          searchError instanceof Error ? searchError.message : 'SEARCH_FAILED',
      })
      continue
    }

    // Priorité au bon pays, puis code postal, puis ville ; les résultats trop
    // génériques (« Espagne ») sont relégués.
    const sameCountry = filterCandidatesByCountry(
      candidates,
      parts.country ?? null
    )
    const relevanceByPlaceId = new Map(
      rankCandidates(sameCountry, parts).map((item) => [
        item.candidate.placeId,
        item.score,
      ])
    )
    // Le pays est déjà traité par la restriction de région et le bonus de
    // pertinence : le laisser dans le texte scoré ne produit que du bruit.
    const scoringSource = stripCountryMentions(attempt.query)
    const attemptResolution = chooseAddressCandidate(
      scoringSource,
      sameCountry,
      (candidate) => relevanceByPlaceId.get(candidate.placeId) ?? 0
    )

    logGeocodingTrace({
      attempt,
      country: parts.country ?? null,
      resultCount: candidates.length,
      chosen: attemptResolution.candidate?.formattedAddress ?? null,
      failureReason:
        attemptResolution.status === 'FAILED' ? attemptResolution.reason : null,
    })

    // Un repli large (code postal/ville) ne doit jamais valider en silence une
    // adresse de rue précise : on garde le résultat mais on demande une
    // confirmation humaine, la précision perdue doit rester visible.
    const isBroadFallback = attempt.tier >= 3 && Boolean(parts.address)
    const effective =
      isBroadFallback && attemptResolution.status === 'AUTO_CONFIRMED'
        ? {
            ...attemptResolution,
            status: 'REVIEW_REQUIRED' as const,
            reason:
              'Adresse exacte introuvable : localisation approchée sur ' +
              `${attempt.label === 'city+country' ? 'la ville' : 'le code postal'}` +
              ' à confirmer.',
          }
        : attemptResolution

    if (effective.confidence > resolution.confidence) {
      resolution = effective
    }

    if (effective.status === 'AUTO_CONFIRMED') break
  }

  return resolution
}

async function resolveEndpoint(
  mission: MissionForPreparation,
  endpoint: Endpoint,
  provider: PreparationProvider
): Promise<ResolvedEndpoint> {
  const source = sourceAddress(mission, endpoint)
  const normalizedAddress = normalizeAddressText(source)
  const coordinates = existingCoordinates(mission, endpoint)
  if (coordinates) {
    return {
      status: coordinates.placeId
        ? AddressResolutionStatus.CONFIRMED
        : AddressResolutionStatus.AUTO_CONFIRMED,
      method: AddressResolutionMethod.PROVIDED_COORDINATES,
      confidence: coordinates.placeId ? 1 : 0.95,
      reason: coordinates.placeId
        ? 'Adresse et coordonnées déjà validées.'
        : 'Coordonnées explicites déjà enregistrées.',
      sourceAddress: source,
      normalizedAddress,
      resolvedAddress: coordinates.address ?? source,
      placeId: coordinates.placeId,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      alternatives: [],
    }
  }
  if (normalizedAddress.length < 3) {
    return {
      status: AddressResolutionStatus.FAILED,
      method: AddressResolutionMethod.GOOGLE_PLACES,
      confidence: 0,
      reason: 'Adresse source insuffisante.',
      sourceAddress: source,
      normalizedAddress,
      resolvedAddress: null,
      placeId: null,
      latitude: null,
      longitude: null,
      alternatives: [],
    }
  }
  const resolution = await resolveAddressWithFallback(
    {
      address:
        endpoint === 'pickup' ? mission.pickupAddress : mission.deliveryAddress,
      city: endpoint === 'pickup' ? mission.pickupCity : mission.deliveryCity,
      country: detectCountry(source),
    },
    source,
    provider
  )
  return {
    status: AddressResolutionStatus[resolution.status],
    method: AddressResolutionMethod.GOOGLE_PLACES,
    confidence: resolution.confidence,
    reason: resolution.reason,
    sourceAddress: source,
    normalizedAddress,
    resolvedAddress: resolution.candidate?.formattedAddress ?? null,
    placeId: resolution.candidate?.placeId ?? null,
    latitude: resolution.candidate?.latitude ?? null,
    longitude: resolution.candidate?.longitude ?? null,
    alternatives: resolution.alternatives,
  }
}

function endpointUpdate(endpoint: Endpoint, result: ResolvedEndpoint) {
  const prefix = endpoint
  return {
    [`${prefix}SourceAddress`]: result.sourceAddress,
    [`${prefix}NormalizedAddress`]: result.normalizedAddress,
    [`${prefix}ResolvedAddress`]: result.resolvedAddress,
    [`${prefix}ResolutionStatus`]: result.status,
    [`${prefix}ResolutionMethod`]: result.method,
    [`${prefix}ResolutionConfidence`]: result.confidence,
    [`${prefix}ResolvedAt`]: new Date(),
    [`${prefix}ResolutionReason`]: result.reason,
    [`${prefix}ResolutionCandidates`]: result.alternatives,
    ...(result.status === AddressResolutionStatus.AUTO_CONFIRMED ||
    result.status === AddressResolutionStatus.CONFIRMED
      ? {
          [`${prefix}Address`]: result.resolvedAddress,
          [`${prefix}PlaceId`]: result.placeId,
          [`${prefix}Lat`]: result.latitude,
          [`${prefix}Lng`]: result.longitude,
        }
      : {}),
  }
}

function resolutionUsable(result: ResolvedEndpoint) {
  return (
    (result.status === AddressResolutionStatus.AUTO_CONFIRMED ||
      result.status === AddressResolutionStatus.CONFIRMED) &&
    typeof result.latitude === 'number' &&
    typeof result.longitude === 'number'
  )
}

export async function prepareMission(
  missionId: string,
  options: {
    force?: boolean
    provider?: PreparationProvider
  } = {}
) {
  const provider = options.provider ?? defaultProvider
  const currentMission = await prisma.mission.findUniqueOrThrow({
    where: { id: missionId },
  })
  const hasReusableRoute =
    typeof currentMission.routeDistanceMeters === 'number' &&
    currentMission.routeDistanceMeters > 0 &&
    typeof currentMission.routeDurationSeconds === 'number' &&
    currentMission.routeDurationSeconds > 0 &&
    Boolean(currentMission.routePolyline)
  const preparationAlreadyTerminal =
    currentMission.preparationStatus === MissionPreparationStatus.READY
      ? hasReusableRoute
      : currentMission.preparationStatus ===
          MissionPreparationStatus.REVIEW_REQUIRED

  if (!options.force && preparationAlreadyTerminal) {
    return currentMission
  }

  await prisma.mission.update({
    where: { id: missionId },
    data: {
      preparationStatus: MissionPreparationStatus.PROCESSING,
      preparationLastAttemptAt: new Date(),
      preparationError: null,
    },
  })
  const mission = currentMission
  try {
    const [pickup, delivery] = await Promise.all([
      resolveEndpoint(mission, 'pickup', provider),
      resolveEndpoint(mission, 'delivery', provider),
    ])
    const missingData: string[] = []
    if (!resolutionUsable(pickup)) missingData.push('PICKUP_ADDRESS')
    if (!resolutionUsable(delivery)) missingData.push('DELIVERY_ADDRESS')
    const reviewRequired =
      pickup.status === AddressResolutionStatus.REVIEW_REQUIRED ||
      delivery.status === AddressResolutionStatus.REVIEW_REQUIRED
    const routeCached =
      !options.force &&
      typeof mission.routeDistanceMeters === 'number' &&
      typeof mission.routeDurationSeconds === 'number' &&
      Boolean(mission.routePolyline)
    let route: CalculatedRoute | null = null
    if (!missingData.length && !routeCached) {
      route = await provider.computeRoute({
        origin: {
          latitude: pickup.latitude as number,
          longitude: pickup.longitude as number,
        },
        destination: {
          latitude: delivery.latitude as number,
          longitude: delivery.longitude as number,
        },
      })
    }
    if (!routeCached && !route) missingData.push('MISSION_ROUTE')
    missingData.push(
      ...prerequisiteMissingCodes(
        evaluateMissionPrerequisites({
          ...mission,
          pickupResolutionStatus: pickup.status,
          deliveryResolutionStatus: delivery.status,
          pickupLat: pickup.latitude,
          pickupLng: pickup.longitude,
          deliveryLat: delivery.latitude,
          deliveryLng: delivery.longitude,
          routeDistanceMeters:
            route?.distanceMeters ?? mission.routeDistanceMeters,
          routeDurationSeconds:
            route?.durationSeconds ?? mission.routeDurationSeconds,
        })
      ).filter((code) => !missingData.includes(code))
    )
    const preparationStatus = reviewRequired
      ? MissionPreparationStatus.REVIEW_REQUIRED
      : missingData.length
        ? MissionPreparationStatus.FAILED
        : MissionPreparationStatus.READY
    const data: Prisma.MissionUpdateInput = {
      ...endpointUpdate('pickup', pickup),
      ...endpointUpdate('delivery', delivery),
      preparationStatus,
      preparationMissingData: missingData,
      preparationError: null,
      ...(route
        ? {
            routeDistanceMeters: route.distanceMeters,
            routeDurationSeconds: route.durationSeconds,
            routePolyline: route.polyline,
            routeProvider: route.provider,
            routeCalculatedAt: new Date(),
          }
        : {}),
    }
    const updated = await prisma.mission.update({
      where: { id: missionId },
      data,
    })
    await prisma.missionEvent.create({
      data: {
        missionId,
        type: MissionEventType.NOTE_ADDED,
        message:
          preparationStatus === MissionPreparationStatus.READY
            ? 'Mission préparée automatiquement pour la planification.'
            : 'Préparation de mission à compléter.',
        metadata: {
          source: 'mission_preparation',
          preparationStatus,
          missingData,
        },
      },
    })
    return updated
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'MISSION_PREPARATION_FAILED'
    await prisma.mission.update({
      where: { id: missionId },
      data: {
        preparationStatus: MissionPreparationStatus.FAILED,
        preparationError: message.slice(0, 500),
      },
    })
    throw error
  }
}

export type { PreparationProvider }
