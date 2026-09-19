import {
  DriverStatus,
  MissionPreparationStatus,
  TruckStatus,
} from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import { classifyPlanningMissions } from '../../../../lib/dispatch/auto-planning/mission-scope'
import {
  getWeekEndDate,
  parseWeekStartParam,
} from '../../../../lib/dispatch/date-utils'
import { buildPreparedDriverTruckPairs } from '../../../../lib/dispatch/driver-truck-pairs'
import { evaluateMissionPrerequisites } from '../../../../lib/dispatch/mission-prerequisites'
import { getDriverActivityState } from '../../../../lib/dispatch/regulatory'
import { prisma } from '../../../../lib/prisma'

const unavailableTrucks = new Set<TruckStatus>([
  TruckStatus.IN_MAINTENANCE,
  TruckStatus.MAINTENANCE_EXT,
  TruckStatus.OUT_OF_SERVICE,
])

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!(await requirePermission(req, res, permissions.dispatchView))) return
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }
  const weekStart =
    typeof req.query.weekStart === 'string'
      ? parseWeekStartParam(req.query.weekStart)
      : null
  if (!weekStart) {
    return res.status(400).json({ error: 'Semaine invalide.' })
  }
  const weekEnd = getWeekEndDate(weekStart)
  const [missions, pairs] = await Promise.all([
    prisma.mission.findMany({
      orderBy: [{ pickupDate: 'asc' }, { id: 'asc' }],
      include: {
        assignment: { select: { scheduledDate: true, driverId: true } },
      },
    }),
    buildPreparedDriverTruckPairs(weekStart),
  ])
  const missionScope = classifyPlanningMissions({
    missions,
    periodStart: weekStart,
    periodEnd: weekEnd,
    includeExistingForced: false,
  })
  const included = missions.filter((mission) =>
    missionScope.includedMissionIds.includes(mission.id)
  )
  const driverIds = Array.from(
    new Set([
      ...pairs
        .map((pair) => pair.driver?.id)
        .filter((id): id is string => Boolean(id)),
      ...included
        .map((mission) => mission.assignment?.driverId)
        .filter((id): id is string => Boolean(id)),
    ])
  )
  const regulatoryReferenceAt =
    new Date() >= weekStart && new Date() <= weekEnd ? new Date() : weekStart
  const regulatoryStates = await Promise.all(
    driverIds.map((driverId) =>
      getDriverActivityState(driverId, regulatoryReferenceAt)
    )
  )
  const regulatoryByDriverId = new Map(
    regulatoryStates
      .filter((state): state is NonNullable<typeof state> => Boolean(state))
      .map((state) => [state.driver.id, state])
  )
  const regulatedDriverIds = new Set(
    regulatoryStates
      .filter(
        (state): state is NonNullable<typeof state> =>
          Boolean(state) &&
          !state!.assessment.controls.some(
            (control) =>
              (control.key === 'HISTORY' ||
                control.key === 'DRIVING_AVAILABLE') &&
              control.status === 'AVERTISSEMENT'
          )
      )
      .map((state) => state.driver.id)
  )
  const missionItems = included.map((mission) => {
    const assignedDriverId = mission.assignment?.driverId ?? null
    return {
      missionId: mission.id,
      reference: mission.reference,
      preparationStatus: mission.preparationStatus,
      missingData: Array.isArray(mission.preparationMissingData)
        ? mission.preparationMissingData
        : [],
      prerequisites: evaluateMissionPrerequisites(mission, {
        assigned: Boolean(assignedDriverId),
        regulatoryStateKnown: Boolean(
          assignedDriverId && regulatedDriverIds.has(assignedDriverId)
        ),
      }),
      pickupResolutionStatus: mission.pickupResolutionStatus,
      deliveryResolutionStatus: mission.deliveryResolutionStatus,
      pickupResolutionReason: mission.pickupResolutionReason,
      deliveryResolutionReason: mission.deliveryResolutionReason,
      pickupCandidates: Array.isArray(mission.pickupResolutionCandidates)
        ? mission.pickupResolutionCandidates
        : [],
      deliveryCandidates: Array.isArray(mission.deliveryResolutionCandidates)
        ? mission.deliveryResolutionCandidates
        : [],
    }
  })
  const pairItems = pairs.map((pair) => {
    const regulatory = pair.driver
      ? regulatoryByDriverId.get(pair.driver.id)
      : null
    return {
      rowId: pair.rowId,
      driverId: pair.driver?.id ?? null,
      driverName: pair.driver?.name ?? null,
      truckId: pair.assignedTruck?.id ?? null,
      truckPlateNumber: pair.assignedTruck?.plateNumber ?? null,
      missingPosition: Boolean(
        pair.assignedTruck &&
          !regulatory?.position.usable
      ),
      missingRegulatoryState: Boolean(
        pair.driver && !regulatedDriverIds.has(pair.driver.id)
      ),
      regulatoryStatus: regulatory?.assessment.status ?? 'AVERTISSEMENT',
      regulatoryControls: regulatory?.assessment.controls ?? [],
      unavailable: Boolean(
        !pair.driver ||
          !pair.assignedTruck ||
          pair.driver.status !== DriverStatus.ACTIVE ||
          unavailableTrucks.has(pair.assignedTruck.status)
      ),
    }
  })
  // §10 : la base opérationnelle est configurée exclusivement par variables
  // d'environnement (source de vérité unique, modification par redéploiement).
  const baseLatitude = Number(process.env.DISPATCH_BASE_LATITUDE)
  const baseLongitude = Number(process.env.DISPATCH_BASE_LONGITUDE)
  const baseConfigured =
    Number.isFinite(baseLatitude) && Number.isFinite(baseLongitude)
  return res.status(200).json({
    missionScope,
    base: {
      configured: baseConfigured,
      latitude: baseConfigured ? baseLatitude : null,
      longitude: baseConfigured ? baseLongitude : null,
      source: 'ENVIRONMENT',
    },
    missions: missionItems,
    pairs: pairItems,
    counts: {
      readyMissions: missionItems.filter(
        (mission) =>
          mission.preparationStatus === MissionPreparationStatus.READY
      ).length,
      pendingAddresses: missionItems.filter(
        (mission) =>
          mission.pickupResolutionStatus === 'PENDING' ||
          mission.deliveryResolutionStatus === 'PENDING'
      ).length,
      ambiguousAddresses: missionItems.filter(
        (mission) =>
          mission.pickupResolutionStatus === 'REVIEW_REQUIRED' ||
          mission.deliveryResolutionStatus === 'REVIEW_REQUIRED'
      ).length,
      missingRoutes: missionItems.filter((mission) =>
        mission.missingData.includes('MISSION_ROUTE')
      ).length,
      missingPositions: pairItems.filter((pair) => pair.missingPosition).length,
      missingRegulatoryStates: pairItems.filter(
        (pair) => pair.missingRegulatoryState
      ).length,
      outsidePeriod: missionScope.counts.outsidePeriod,
      unavailableResources: pairItems.filter((pair) => pair.unavailable).length,
    },
  })
}
