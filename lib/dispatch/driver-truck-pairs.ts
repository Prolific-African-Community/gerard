import {
  DriverStatus,
  PlanningAssignmentOrigin,
  TruckStatus,
} from '@prisma/client'
import type { Prisma } from '@prisma/client'

import { prisma } from '../prisma'

export const preparedPairIssueCodes = [
  'MISSING_DRIVER',
  'MISSING_TRUCK',
  'NO_USUAL_TRUCK',
  'DRIVER_UNAVAILABLE',
  'TRUCK_UNAVAILABLE',
] as const

export type PreparedPairIssueCode = (typeof preparedPairIssueCodes)[number]

const unavailableTruckStatuses = new Set<TruckStatus>([
  TruckStatus.IN_MAINTENANCE,
  TruckStatus.MAINTENANCE_EXT,
  TruckStatus.OUT_OF_SERVICE,
])

export function classifyDriverTruckPair(
  usualTruckId: string | null,
  assignedTruckId: string | null
) {
  return {
    matchesUsualTruck: Boolean(
      usualTruckId && assignedTruckId && usualTruckId === assignedTruckId
    ),
    isExceptionalReplacement: Boolean(
      usualTruckId && assignedTruckId && usualTruckId !== assignedTruckId
    ),
  }
}

export function getManualAssignmentOrigin(
  previousOrigin: PlanningAssignmentOrigin,
  pairChanged: boolean
) {
  return pairChanged && previousOrigin === PlanningAssignmentOrigin.AUTOMATIC
    ? PlanningAssignmentOrigin.ADJUSTED
    : previousOrigin
}

export async function getPlanningPairMetadata(
  tx: Prisma.TransactionClient,
  driverId: string | null,
  truckId: string | null,
  previousOrigin: PlanningAssignmentOrigin,
  pairChanged: boolean,
  previousSnapshot: string | null,
  previousExceptionalReplacement: boolean
) {
  if (!pairChanged) {
    return {
      usualTruckIdSnapshot: previousSnapshot,
      isExceptionalReplacement: previousExceptionalReplacement,
      assignmentOrigin: previousOrigin,
    }
  }

  const usualTruck = driverId
    ? await tx.truck.findUnique({
        where: { driverId },
        select: { id: true },
      })
    : null

  const classification = classifyDriverTruckPair(usualTruck?.id ?? null, truckId)

  return {
    usualTruckIdSnapshot: usualTruck?.id ?? null,
    isExceptionalReplacement: classification.isExceptionalReplacement,
    assignmentOrigin: getManualAssignmentOrigin(previousOrigin, pairChanged),
  }
}

export async function buildPreparedDriverTruckPairs(weekStartDate: Date) {
  const rows = await prisma.planningRow.findMany({
    where: { weekStartDate },
    orderBy: { sortOrder: 'asc' },
    include: {
      driver: true,
      truck: true,
    },
  })

  const habitualTrucks = await prisma.truck.findMany({
    where: {
      driverId: {
        in: rows
          .map((row) => row.driverId)
          .filter((driverId): driverId is string => Boolean(driverId)),
      },
    },
  })
  const habitualByDriverId = new Map(
    habitualTrucks
      .filter((truck) => truck.driverId)
      .map((truck) => [truck.driverId as string, truck])
  )

  return rows.map((row) => {
    const habitualTruck = row.driverId
      ? habitualByDriverId.get(row.driverId) ?? null
      : null
    const issues: PreparedPairIssueCode[] = []

    if (!row.driver) issues.push('MISSING_DRIVER')
    if (!row.truck) issues.push('MISSING_TRUCK')
    if (row.driver && !habitualTruck) issues.push('NO_USUAL_TRUCK')
    if (row.driver && row.driver.status !== DriverStatus.ACTIVE) {
      issues.push('DRIVER_UNAVAILABLE')
    }
    if (row.truck && unavailableTruckStatuses.has(row.truck.status)) {
      issues.push('TRUCK_UNAVAILABLE')
    }

    return {
      rowId: row.id,
      weekStartDate: row.weekStartDate,
      driver: row.driver,
      assignedTruck: row.truck,
      usualTruck: habitualTruck,
      usualTruckIdSnapshot: row.usualTruckIdSnapshot,
      matchesUsualTruck: Boolean(
        row.truckId && habitualTruck && row.truckId === habitualTruck.id
      ),
      isExceptionalReplacement: row.isExceptionalReplacement,
      pairLocked: row.pairLocked,
      assignmentOrigin: row.assignmentOrigin,
      ready: !issues.some((issue) => issue !== 'NO_USUAL_TRUCK'),
      issues,
    }
  })
}
