import {
  DriverStatus,
  PlanningAssignmentOrigin,
  TruckStatus,
} from '@prisma/client'
import type { Prisma } from '@prisma/client'

import { prisma } from '../prisma'
import { requireActiveOrganizationId } from '../auth/organization-context'

type EnsureWeekPlanningRowsResult = {
  initialized: boolean
  sourceWeekStartDate: Date | null
  createdRowCount: number
}

type ExistingRow = {
  driverId: string | null
  truckId: string | null
  sortOrder: number
}

type SourceRow = ExistingRow & {
  pairLocked: boolean
  assignmentOrigin: PlanningAssignmentOrigin
  usualTruckIdSnapshot: string | null
  isExceptionalReplacement: boolean
  driverActive: boolean
  truckActive: boolean
}

type ActiveDriver = {
  id: string
  usualTruckId: string | null
}

type PlannedRow = {
  driverId: string | null
  truckId: string | null
  sortOrder: number
  pairLocked: boolean
  assignmentOrigin: PlanningAssignmentOrigin
  usualTruckIdSnapshot: string | null
  isExceptionalReplacement: boolean
}

/**
 * Computes only missing structural rows. Explicit rows in the target week
 * always win; missions, assignments and trailers are deliberately absent.
 */
export function planMissingPlanningRows(input: {
  existingRows: ExistingRow[]
  sourceRows: SourceRow[]
  activeDrivers: ActiveDriver[]
}): PlannedRow[] {
  const usedDriverIds = new Set(
    input.existingRows
      .map((row) => row.driverId)
      .filter((id): id is string => Boolean(id))
  )
  const usedTruckIds = new Set(
    input.existingRows
      .map((row) => row.truckId)
      .filter((id): id is string => Boolean(id))
  )
  const planned: PlannedRow[] = []
  let nextSortOrder =
    input.existingRows.reduce(
      (maximum, row) => Math.max(maximum, row.sortOrder),
      -1
    ) + 1

  const append = (
    driverId: string | null,
    truckId: string | null,
    metadata?: Partial<Omit<PlannedRow, 'driverId' | 'truckId' | 'sortOrder'>>
  ) => {
    if (driverId && usedDriverIds.has(driverId)) return
    if (truckId && usedTruckIds.has(truckId)) return
    planned.push({
      driverId,
      truckId,
      sortOrder: nextSortOrder++,
      pairLocked: metadata?.pairLocked ?? false,
      assignmentOrigin:
        metadata?.assignmentOrigin ?? PlanningAssignmentOrigin.AUTOMATIC,
      usualTruckIdSnapshot: metadata?.usualTruckIdSnapshot ?? null,
      isExceptionalReplacement:
        metadata?.isExceptionalReplacement ?? false,
    })
    if (driverId) usedDriverIds.add(driverId)
    if (truckId) usedTruckIds.add(truckId)
  }

  // Preserve the previous manual order among inherited rows. Disabled
  // resources are removed independently, leaving the other resource usable.
  for (const source of [...input.sourceRows].sort(
    (left, right) => left.sortOrder - right.sortOrder
  )) {
    const driverId = source.driverActive ? source.driverId : null
    const truckId = source.truckActive ? source.truckId : null
    if (!driverId && !truckId) continue
    const fullPairPreserved =
      driverId === source.driverId && truckId === source.truckId
    append(driverId, truckId, {
      pairLocked: fullPairPreserved ? source.pairLocked : false,
      assignmentOrigin: fullPairPreserved
        ? source.assignmentOrigin
        : PlanningAssignmentOrigin.AUTOMATIC,
      usualTruckIdSnapshot: driverId ? source.usualTruckIdSnapshot : null,
      isExceptionalReplacement: fullPairPreserved
        ? source.isExceptionalReplacement
        : false,
    })
  }

  const existingEmptyCount = input.existingRows.filter(
    (row) => !row.driverId && !row.truckId
  ).length
  const sourceEmptyCount = input.sourceRows.filter(
    (row) => !row.driverId && !row.truckId
  ).length
  for (
    let emptyIndex = existingEmptyCount;
    emptyIndex < sourceEmptyCount;
    emptyIndex += 1
  ) {
    append(null, null, {
      assignmentOrigin: PlanningAssignmentOrigin.MANUAL,
    })
  }

  // Active drivers absent from both weeks fall back to their usual truck.
  for (const driver of input.activeDrivers) {
    const usualTruckId =
      driver.usualTruckId && !usedTruckIds.has(driver.usualTruckId)
        ? driver.usualTruckId
        : null
    append(driver.id, usualTruckId, {
      assignmentOrigin: PlanningAssignmentOrigin.AUTOMATIC,
      usualTruckIdSnapshot: driver.usualTruckId,
    })
  }

  return planned
}

export async function ensurePlanningRowsForWeek(
  weekStartDate: Date
): Promise<EnsureWeekPlanningRowsResult> {
  const organizationId = requireActiveOrganizationId()
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`dispatch-planning-week:${organizationId}:${weekStartDate.toISOString()}`}))
    `

    const existingRows = await tx.planningRow.findMany({
      where: { weekStartDate },
      orderBy: { sortOrder: 'asc' },
      select: { driverId: true, truckId: true, sortOrder: true },
    })
    const sourceWeek = await findLatestPreviousPlanningWeek(tx, weekStartDate)
    const sourceRows = sourceWeek
      ? await tx.planningRow.findMany({
          where: { weekStartDate: sourceWeek.weekStartDate },
          orderBy: { sortOrder: 'asc' },
          select: {
            driverId: true,
            truckId: true,
            sortOrder: true,
            pairLocked: true,
            assignmentOrigin: true,
            usualTruckIdSnapshot: true,
            isExceptionalReplacement: true,
            driver: { select: { status: true } },
            truck: { select: { status: true } },
          },
        })
      : []
    const activeDrivers = await tx.driver.findMany({
      where: { status: DriverStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        usualTruck: {
          select: { id: true, status: true },
        },
      },
    })

    const plannedRows = planMissingPlanningRows({
      existingRows,
      sourceRows: sourceRows.map((row) => ({
        driverId: row.driverId,
        truckId: row.truckId,
        sortOrder: row.sortOrder,
        pairLocked: row.pairLocked,
        assignmentOrigin: row.assignmentOrigin,
        usualTruckIdSnapshot: row.usualTruckIdSnapshot,
        isExceptionalReplacement: row.isExceptionalReplacement,
        driverActive: row.driver?.status === DriverStatus.ACTIVE,
        truckActive:
          Boolean(row.truck) &&
          row.truck?.status !== TruckStatus.OUT_OF_SERVICE,
      })),
      activeDrivers: activeDrivers.map((driver) => ({
        id: driver.id,
        usualTruckId:
          driver.usualTruck &&
          driver.usualTruck.status !== TruckStatus.OUT_OF_SERVICE
            ? driver.usualTruck.id
            : null,
      })),
    })

    const creationResult = plannedRows.length
      ? await tx.planningRow.createMany({
          data: plannedRows.map((row) => ({
            ...row,
            weekStartDate,
            // Physical trailers remain scoped to their original week.
            trailerId: null,
          })),
          skipDuplicates: true,
        })
      : { count: 0 }

    return {
      initialized: creationResult.count > 0,
      sourceWeekStartDate: sourceWeek?.weekStartDate ?? null,
      createdRowCount: creationResult.count,
    }
  })
}

// Backward-compatible name for existing API consumers.
export const ensureWeekPlanningRowsFromPreviousWeek =
  ensurePlanningRowsForWeek

async function findLatestPreviousPlanningWeek(
  tx: Prisma.TransactionClient,
  weekStartDate: Date
) {
  return tx.planningRow.findFirst({
    where: {
      weekStartDate: {
        lt: weekStartDate,
      },
    },
    orderBy: {
      weekStartDate: 'desc',
    },
    select: {
      weekStartDate: true,
    },
  })
}
