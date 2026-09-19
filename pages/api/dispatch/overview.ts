import { MaintenanceUrgency, MissionStatus } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePermission } from '../../../lib/auth/authorization'
import { permissions } from '../../../lib/auth/permissions'

import {
  getWeekEndDate,
  getWeekStartDate,
  parseWeekStartParam,
} from '../../../lib/dispatch/date-utils'
import { buildPreparedDriverTruckPairs } from '../../../lib/dispatch/driver-truck-pairs'
import { classifyPlanningMissions } from '../../../lib/dispatch/auto-planning/mission-scope'
import { getDriverActivityState } from '../../../lib/dispatch/regulatory/activity-service'
import { getMissionDisplayLocation } from '../../../lib/dispatch/mission-display-location'
import { prisma } from '../../../lib/prisma'

type ErrorResponse = {
  error: string
  details?: string
}

const terminalMaintenanceStatuses = [
  'COMPLETED',
  'INVOICED',
  'PAID',
  'CLOSED',
  'CANCELLED',
  'QUOTE_REJECTED',
] as const

const maintenanceUrgencyRank: Record<MaintenanceUrgency, number> = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
}

type ActiveMaintenanceRecord = {
  id: string
  truckId: string | null
  trailerId: string | null
  status:
    | 'DRAFT'
    | 'SUBMITTED'
    | 'RECEIVED'
    | 'UNDER_REVIEW'
    | 'QUOTE_RECEIVED'
    | 'QUOTE_APPROVED'
    | 'QUOTE_REJECTED'
    | 'SCHEDULED'
    | 'IN_PROGRESS'
  interventionType:
    | 'DIAGNOSTIC'
    | 'TIRES'
    | 'BRAKES'
    | 'OIL_SERVICE'
    | 'ELECTRICAL'
    | 'BODYWORK'
    | 'TRAILER_REPAIR'
    | 'SAFETY_CHECK'
    | 'OTHER'
  urgency: MaintenanceUrgency
  immobilizationRequired: boolean
  preferredDate: Date | null
  issueDescription: string
  quoteAmount: number | null
  invoiceAmount: number | null
  slInvoiceReference: string | null
  providerRequestId: string | null
  quotePdfUrl: string | null
  invoicePdfUrl: string | null
  createdAt: Date
}

function getIssueDescriptionPreview(issueDescription: string) {
  const normalized = issueDescription.replace(/\s+/g, ' ').trim()

  if (normalized.length <= 120) {
    return normalized
  }

  return `${normalized.slice(0, 117).trimEnd()}...`
}

function compareActiveMaintenance(
  left: ActiveMaintenanceRecord,
  right: ActiveMaintenanceRecord
) {
  if (left.immobilizationRequired !== right.immobilizationRequired) {
    return left.immobilizationRequired ? -1 : 1
  }

  const leftInterventionRank = isInterventionStatus(left.status) ? 0 : 1
  const rightInterventionRank = isInterventionStatus(right.status) ? 0 : 1
  const interventionDifference = leftInterventionRank - rightInterventionRank

  if (interventionDifference !== 0) {
    return interventionDifference
  }

  const createdAtDifference =
    right.createdAt.getTime() - left.createdAt.getTime()

  if (createdAtDifference !== 0) {
    return createdAtDifference
  }

  const urgencyDifference =
    maintenanceUrgencyRank[left.urgency] - maintenanceUrgencyRank[right.urgency]

  if (urgencyDifference !== 0) {
    return urgencyDifference
  }

  return 0
}

function isInterventionStatus(status: ActiveMaintenanceRecord['status']) {
  return (
    status === 'RECEIVED' ||
    status === 'UNDER_REVIEW' ||
    status === 'QUOTE_RECEIVED' ||
    status === 'QUOTE_APPROVED' ||
    status === 'SCHEDULED' ||
    status === 'IN_PROGRESS'
  )
}

function getActiveMaintenanceSummary(records: ActiveMaintenanceRecord[]) {
  if (!records.length) {
    return null
  }

  const activeRequest = [...records].sort(compareActiveMaintenance)[0]

  return {
    id: activeRequest.id,
    status: activeRequest.status,
    interventionType: activeRequest.interventionType,
    urgency: activeRequest.urgency,
    immobilizationRequired: activeRequest.immobilizationRequired,
    preferredDate: activeRequest.preferredDate,
    issueDescription: getIssueDescriptionPreview(
      activeRequest.issueDescription
    ),
    quoteAmount: activeRequest.quoteAmount,
    invoiceAmount: activeRequest.invoiceAmount,
    slInvoiceReference: activeRequest.slInvoiceReference,
    providerRequestId: activeRequest.providerRequestId,
    quotePdfUrl: activeRequest.quotePdfUrl,
    invoicePdfUrl: activeRequest.invoicePdfUrl,
  }
}

function getRequestedWeekStartDate(queryValue: string | string[] | undefined) {
  if (typeof queryValue === 'undefined') {
    return getWeekStartDate()
  }

  if (Array.isArray(queryValue)) {
    return null
  }

  return parseWeekStartParam(queryValue)
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<unknown | ErrorResponse>
) {
  const user = await requirePermission(req, res, permissions.dispatchView)
  if (!user) return
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({
      error: 'Method not allowed',
    })
  }

  const weekStartDate = getRequestedWeekStartDate(req.query.weekStart)

  if (!weekStartDate) {
    return res.status(400).json({
      error: 'Invalid weekStart',
    })
  }

  const weekEndDate = getWeekEndDate(weekStartDate)

  try {
    const [
      rawDrivers,
      trucks,
      missions,
      assignments,
      planningRows,
      driverPositions,
      trailers,
      activeMaintenanceRequests,
    ] = await Promise.all([
      prisma.driver.findMany({
        orderBy: {
          name: 'asc',
        },
        include: {
          user: {
            select: {
              username: true,
            },
          },
        },
      }),

      prisma.truck.findMany({
        orderBy: {
          plateNumber: 'asc',
        },
      }),

      prisma.mission.findMany({
        orderBy: {
          createdAt: 'asc',
        },
        include: {
          sourceEmail: {
            select: {
              id: true,
            },
          },
          // Affectation réelle de la mission, volontairement NON restreinte à
          // la semaine affichée : c'est la source de vérité du bandeau.
          assignment: {
            select: {
              id: true,
              scheduledDate: true,
              plannedEndAt: true,
              planningRowId: true,
              driverId: true,
              truckId: true,
            },
          },
        },
      }),

      prisma.missionAssignment.findMany({
        where: {
          scheduledDate: { lte: weekEndDate },
          OR: [
            { scheduledDate: { gte: weekStartDate } },
            { plannedEndAt: { gt: weekStartDate } },
            {
              plannedEndAt: null,
              mission: { deliveryDate: { gt: weekStartDate } },
            },
          ],
        },
        orderBy: [
          {
            scheduledDate: 'asc',
          },
          {
            sortOrder: 'asc',
          },
        ],
        include: {
          mission: {
            include: {
              sourceEmail: {
                select: {
                  id: true,
                },
              },
            },
          },
          driver: true,
          truck: true,
          trailer: {
            include: {
              custodyEvents: {
                orderBy: { occurredAt: 'desc' },
                take: 20,
                include: {
                  fromDriver: { select: { id: true, name: true } },
                  toDriver: { select: { id: true, name: true } },
                },
              },
            },
          },
          planningRow: true,
        },
      }),

      prisma.planningRow.findMany({
        where: {
          weekStartDate,
        },
        orderBy: {
          sortOrder: 'asc',
        },
        include: {
          driver: true,
          truck: true,
          trailer: true,
        },
      }),

      prisma.driverPosition.findMany({
        where: {
          truckId: {
            not: null,
          },
          provider: { in: ['DRIVER_PHONE', 'DEMO_SIMULATED'] },
        },
        orderBy: {
          recordedAt: 'desc',
        },
        include: {
          truck: true,
          driver: true,
        },
      }),

      prisma.trailer.findMany({
        orderBy: {
          plateNumber: 'asc',
        },
        include: {
          truck: true,
        },
      }),

      prisma.maintenanceRequest.findMany({
        where: {
          status: {
            notIn: [...terminalMaintenanceStatuses],
          },
        },
        select: {
          id: true,
          truckId: true,
          trailerId: true,
          status: true,
          interventionType: true,
          urgency: true,
          immobilizationRequired: true,
          preferredDate: true,
          issueDescription: true,
          quoteAmount: true,
          invoiceAmount: true,
          slInvoiceReference: true,
          providerRequestId: true,
          quotePdfUrl: true,
          invoicePdfUrl: true,
          createdAt: true,
        },
      }),
    ])

    const normalizedMissions = missions.map(({ sourceEmail, ...mission }) => ({
      ...mission,
      hasSourceEmail: Boolean(
        sourceEmail?.id ||
          mission.sourceEmailId ||
          mission.sourceEmailFrom ||
          mission.sourceEmailSubject
      ),
    }))

    const normalizedAssignments = assignments.map((assignment) => ({
      ...assignment,
      mission: assignment.mission
        ? {
            ...assignment.mission,
            hasSourceEmail: Boolean(
              assignment.mission.sourceEmail?.id ||
                assignment.mission.sourceEmailId ||
                assignment.mission.sourceEmailFrom ||
                assignment.mission.sourceEmailSubject
            ),
          }
        : assignment.mission,
    }))

    const assignmentByMissionId = new Map(
      normalizedAssignments.map((assignment) => [
        assignment.missionId,
        {
          scheduledDate: assignment.scheduledDate,
          plannedEndAt: assignment.plannedEndAt,
        },
      ])
    )
    const pendingMissions = normalizedMissions.filter((mission) =>
      getMissionDisplayLocation({
        status: mission.status,
        preparationStatus: mission.preparationStatus,
        pickupDate: mission.pickupDate,
        assignment: assignmentByMissionId.get(mission.id) ?? null,
        weekStart: weekStartDate,
        weekEnd: weekEndDate,
      }) !== 'WEEK_GRID'
    )
    const missionScope = classifyPlanningMissions({
      missions: normalizedMissions.map((mission) => ({
        ...mission,
        assignment: assignmentByMissionId.get(mission.id) ?? null,
      })),
      periodStart: weekStartDate,
      periodEnd: weekEndDate,
      includeExistingForced: false,
    })

    const activeMaintenanceByTruckId = activeMaintenanceRequests.reduce<
      Map<string, ActiveMaintenanceRecord[]>
    >((accumulator, request) => {
      if (!request.truckId) {
        return accumulator
      }

      const currentRequests = accumulator.get(request.truckId) ?? []
      currentRequests.push(request as ActiveMaintenanceRecord)
      accumulator.set(request.truckId, currentRequests)
      return accumulator
    }, new Map())

    const activeMaintenanceByTrailerId = activeMaintenanceRequests.reduce<
      Map<string, ActiveMaintenanceRecord[]>
    >((accumulator, request) => {
      if (!request.trailerId) {
        return accumulator
      }

      const currentRequests = accumulator.get(request.trailerId) ?? []
      currentRequests.push(request as ActiveMaintenanceRecord)
      accumulator.set(request.trailerId, currentRequests)
      return accumulator
    }, new Map())

    const enrichedTrucks = trucks.map((truck) => ({
      ...truck,
      activeMaintenance:
        getActiveMaintenanceSummary(
          activeMaintenanceByTruckId.get(truck.id) ?? []
        ) ?? null,
    }))

    // Le bandeau reflète uniquement la présence dans le planning demandé.
    // Le statut métier du camion ne détermine jamais sa visibilité ici.
    const plannedTruckIds = new Set(
      planningRows
        .map((row) => row.truckId)
        .filter((truckId): truckId is string => Boolean(truckId))
    )
    const enrichedAvailableTrucks = enrichedTrucks.filter(
      (truck) => !plannedTruckIds.has(truck.id)
    )

    const enrichedTrailers = trailers.map((trailer) => ({
      ...trailer,
      activeMaintenance:
        getActiveMaintenanceSummary(
          activeMaintenanceByTrailerId.get(trailer.id) ?? []
        ) ?? null,
    }))

    const trucksByDriverId = enrichedTrucks.reduce<
      Record<string, typeof enrichedTrucks[number]>
    >((acc, truck) => {
      if (truck.driverId && !acc[truck.driverId]) {
        acc[truck.driverId] = truck
      }

      return acc
    }, {})

    const driverStates = await Promise.all(
      rawDrivers.map((driver) => getDriverActivityState(driver.id, new Date()))
    )
    const driverStateById = new Map(
      driverStates
        .filter((state): state is NonNullable<typeof state> => Boolean(state))
        .map((state) => [state.driver.id, state])
    )

    const drivers = rawDrivers.map((driver) => {
      const state = driverStateById.get(driver.id)
      const priorityControl = state?.assessment.controls.find(
        (control) => control.status === 'BLOQUANT'
      ) ?? state?.assessment.controls.find(
        (control) => control.status === 'AVERTISSEMENT'
      )
      return {
        ...driver,
        username: driver.user?.username ?? null,
        user: undefined,
        truck: trucksByDriverId[driver.id] ?? null,
        operationalSummary: state
          ? {
              regulatoryStatus: state.assessment.status,
              currentActivity: state.summary.currentStatus,
              openActivity: state.summary.openActivity,
              positionSource: state.position.source,
              positionLabel: state.position.sourceLabel,
              positionObservedAt: state.position.observedAt,
              positionFreshnessSeconds: state.position.freshnessSeconds,
              priorityAction:
                priorityControl?.action.label ??
                (state.assessment.status === 'CONFORME'
                  ? 'Aucune action requise'
                  : 'Consulter la fiche chauffeur'),
            }
          : null,
      }
    })

    const latestTruckPositions = Array.from(
      driverPositions
        .reduce(
          (positionsByTruckId, position) => {
            if (
              position.truckId &&
              Number.isFinite(position.latitude) &&
              Number.isFinite(position.longitude) &&
              !positionsByTruckId.has(position.truckId)
            ) {
              positionsByTruckId.set(position.truckId, {
                id: position.id,
                truckId: position.truckId,
                driverId: position.driverId,
                latitude: position.latitude,
                longitude: position.longitude,
                speedKmh: position.speedKmh,
                heading: position.heading,
                provider: position.provider,
                recordedAt: position.recordedAt,
              })
            }

            return positionsByTruckId
          },
          new Map<
            string,
            {
              id: string
              truckId: string
              driverId: string
              latitude: number
              longitude: number
              speedKmh: number | null
              heading: number | null
              provider: string
              recordedAt: Date
            }
          >()
        )
        .values()
    )
    const preparedPairs = await buildPreparedDriverTruckPairs(weekStartDate)

    return res.status(200).json({
      drivers,
      trucks: enrichedTrucks,
      availableTrucks: enrichedAvailableTrucks,
      missions: normalizedMissions,
      pendingMissions,
      missionScope,
      assignments: normalizedAssignments,
      planningRows,
      preparedPairs,
      truckPositions: latestTruckPositions,
      trailers: enrichedTrailers,
    })
  } catch (error) {
    console.error('Failed to load dispatch overview', error)

    return res.status(500).json({
      error: 'Failed to load dispatch overview',
      details:
        process.env.NODE_ENV === 'development' && error instanceof Error
          ? error.message
          : undefined,
    })
  }
}
