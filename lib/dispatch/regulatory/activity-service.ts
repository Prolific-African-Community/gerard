import type {
  DriverActivityEvent,
  DriverRegulatoryDeclaration,
  Mission,
  MissionAssignment,
} from '@prisma/client'
import { MissionStatus } from '@prisma/client'

import { prisma } from '../../prisma'
import {
  calculateDriverActivityState,
  regulatoryHistoryStart,
  startOfIsoWeek,
} from './activity-calculator'
import { presentDriverRegulatoryState } from './presentation'
import { buildDriverRegulatoryAssessment } from './assessment'
import {
  configuredOperatingBase,
  resolveDriverPosition,
} from '../driver-position'

type AssignmentWithMission = MissionAssignment & { mission: Mission }

function assignmentWindow(assignment: AssignmentWithMission) {
  const startsAt =
    assignment.mission.pickupDate ?? assignment.scheduledDate
  const routeSeconds = assignment.mission.routeDurationSeconds
  const endsAt =
    assignment.mission.deliveryDate ??
    (typeof routeSeconds === 'number'
      ? new Date(startsAt.getTime() + routeSeconds * 1000)
      : null)
  return {
    id: assignment.missionId,
    reference: assignment.mission.reference,
    startsAt,
    endsAt,
    plannedDrivingSeconds: routeSeconds,
  }
}

export function calculateStoredDriverActivity(input: {
  events: DriverActivityEvent[]
  assignments: AssignmentWithMission[]
  declaration: DriverRegulatoryDeclaration | null
  at: Date
}) {
  return calculateDriverActivityState({
    events: input.events,
    missions: input.assignments.map(assignmentWindow),
    at: input.at,
    baseline: input.declaration
      ? {
          referenceAt: input.declaration.referenceAt,
          validUntil: input.declaration.validUntil,
          weeklyDrivingSeconds: input.declaration.weeklyDrivingSeconds,
          dailyDrivingSeconds: input.declaration.dailyDrivingSeconds,
          drivingSinceValidBreakSeconds:
            input.declaration.drivingSinceValidBreakSeconds,
        }
      : null,
  })
}

export async function getDriverActivityState(driverId: string, at = new Date()) {
  const weekStart = startOfIsoWeek(at)
  const historyStart = regulatoryHistoryStart(at)
  const [
    driver,
    events,
    assignments,
    declaration,
    latestGps,
    completedAssignment,
  ] = await Promise.all([
    prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, name: true, status: true },
    }),
    prisma.driverActivityEvent.findMany({
      where: {
        driverId,
        effectiveAt: { gte: historyStart, lte: at },
      },
      orderBy: [
        { effectiveAt: 'asc' },
        { recordedAt: 'asc' },
        { id: 'asc' },
      ],
      include: {
        authorUser: {
          select: { id: true, name: true, username: true },
        },
        mission: { select: { id: true, reference: true } },
      },
    }),
    prisma.missionAssignment.findMany({
      where: {
        OR: [{ driverId }, { planningRow: { driverId } }],
        scheduledDate: {
          gte: new Date(weekStart.getTime() - 24 * 60 * 60 * 1000),
          lte: new Date(at.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      include: { mission: true },
      orderBy: [{ scheduledDate: 'asc' }, { sortOrder: 'asc' }],
    }),
    prisma.driverRegulatoryDeclaration.findFirst({
      where: { driverId, referenceAt: { lte: at } },
      orderBy: { referenceAt: 'desc' },
    }),
    prisma.driverPosition.findFirst({
      where: {
        driverId,
        provider: 'DRIVER_PHONE',
        recordedAt: { lte: at },
      },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.missionAssignment.findFirst({
      where: {
        OR: [{ driverId }, { planningRow: { driverId } }],
        mission: {
          status: MissionStatus.DONE,
          deliveryDate: { lte: at },
          deliveryLat: { not: null },
          deliveryLng: { not: null },
        },
      },
      orderBy: { mission: { deliveryDate: 'desc' } },
      include: {
        mission: {
          select: {
            id: true,
            reference: true,
            deliveryDate: true,
            deliveryLat: true,
            deliveryLng: true,
          },
        },
      },
    }),
  ])
  if (!driver) return null
  const summary = calculateStoredDriverActivity({
    events,
    assignments,
    declaration,
    at,
  })
  const position = resolveDriverPosition({
    at,
    gps: latestGps
      ? {
          latitude: latestGps.latitude,
          longitude: latestGps.longitude,
          recordedAt: latestGps.recordedAt,
          accuracy: latestGps.accuracy,
        }
      : null,
    lastCompletedMission:
      completedAssignment?.mission.deliveryDate &&
      typeof completedAssignment.mission.deliveryLat === 'number' &&
      typeof completedAssignment.mission.deliveryLng === 'number'
        ? {
            missionId: completedAssignment.mission.id,
            reference: completedAssignment.mission.reference,
            latitude: completedAssignment.mission.deliveryLat,
            longitude: completedAssignment.mission.deliveryLng,
            completedAt: completedAssignment.mission.deliveryDate,
          }
        : null,
    operatingBase: configuredOperatingBase(),
  })
  return {
    driver,
    summary,
    assessment: buildDriverRegulatoryAssessment({
      driverStatus: driver.status,
      summary,
      declaration,
      at,
    }),
    presentation: presentDriverRegulatoryState({
      driverStatus: driver.status,
      summary,
      events,
    }),
    events,
    declaration,
    position,
  }
}

export function serializeActivityEvent(
  event: DriverActivityEvent & {
    authorUser?: {
      id: string
      name: string | null
      username: string | null
    } | null
    mission?: { id: string; reference: string } | null
  }
) {
  return {
    id: event.id,
    driverId: event.driverId,
    type: event.type,
    effectiveAt: event.effectiveAt.toISOString(),
    recordedAt: event.recordedAt.toISOString(),
    source: event.source,
    note: event.note,
    missionId: event.missionId,
    mission: event.mission ?? null,
    retrospective: event.retrospective,
    isVoided: event.isVoided,
    correctedEventId: event.correctedEventId,
    previousType: event.previousType,
    previousEffectiveAt: event.previousEffectiveAt?.toISOString() ?? null,
    previousNote: event.previousNote,
    correctionReason: event.correctionReason,
    author: event.authorUser
      ? {
          id: event.authorUser.id,
          name: event.authorUser.name,
          username: event.authorUser.username,
        }
      : null,
  }
}
