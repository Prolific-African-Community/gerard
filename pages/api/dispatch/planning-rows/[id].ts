import {
  MissionEventType,
  MissionStatus,
  Prisma,
  TrailerStatus,
} from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import { getPlanningPairMetadata } from '../../../../lib/dispatch/driver-truck-pairs'
import { synchronizeParkPresence } from '../../../../lib/park/service'
import { prisma } from '../../../../lib/prisma'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getPlanningRowId(queryValue: string | string[] | undefined) {
  return typeof queryValue === 'string' && queryValue.trim().length > 0
    ? queryValue.trim()
    : null
}

function getNullableString(value: unknown) {
  if (typeof value === 'undefined') return undefined
  if (value === null) return null
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function getOptionalBoolean(value: unknown) {
  if (typeof value === 'undefined') return undefined
  return typeof value === 'boolean' ? value : null
}

type RowState = {
  id: string
  driverId: string | null
  truckId: string | null
  pairLocked: boolean
  assignmentOrigin: 'MANUAL' | 'AUTOMATIC' | 'ADJUSTED'
  usualTruckIdSnapshot: string | null
  isExceptionalReplacement: boolean
}

function isPairChanged(
  before: Pick<RowState, 'driverId' | 'truckId'>,
  after: Pick<RowState, 'driverId' | 'truckId'>
) {
  return before.driverId !== after.driverId || before.truckId !== after.truckId
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!(await requirePermission(req, res, permissions.dispatchAssign))) return
  const rowId = getPlanningRowId(req.query.id)

  if (!rowId) {
    return res.status(400).json({ error: 'Planning row id is required' })
  }

  if (req.method === 'PATCH') {
    if (!isRecord(req.body)) {
      return res.status(400).json({ error: 'Invalid request body' })
    }

    const driverId = getNullableString(req.body.driverId)
    const truckId = getNullableString(req.body.truckId)
    const trailerId = getNullableString(req.body.trailerId)
    const pairLocked = getOptionalBoolean(req.body.pairLocked)

    if (pairLocked === null) {
      return res.status(400).json({ error: 'pairLocked must be a boolean' })
    }
    if (
      typeof driverId === 'undefined' &&
      typeof truckId === 'undefined' &&
      typeof trailerId === 'undefined' &&
      typeof pairLocked === 'undefined'
    ) {
      return res.status(400).json({ error: 'No row update provided' })
    }

    try {
      const row = await prisma.$transaction(
        async (tx) => {
          const existingRow = await tx.planningRow.findUnique({
            where: { id: rowId },
          })
          if (!existingRow) throw new Error('Planning row not found')

          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(
              hashtext(${`dispatch-planning-week:${existingRow.weekStartDate.toISOString()}`})
            )
          `

          const [weekRows, driver, truck, trailer] = await Promise.all([
            tx.planningRow.findMany({
              where: { weekStartDate: existingRow.weekStartDate },
            }),
            typeof driverId === 'string'
              ? tx.driver.findUnique({ where: { id: driverId } })
              : null,
            typeof truckId === 'string'
              ? tx.truck.findUnique({ where: { id: truckId } })
              : null,
            typeof trailerId === 'string'
              ? tx.trailer.findUnique({ where: { id: trailerId } })
              : null,
          ])

          if (typeof driverId === 'string' && !driver) {
            throw new Error('Driver not found')
          }
          if (typeof truckId === 'string' && !truck) {
            throw new Error('Truck not found')
          }
          if (typeof trailerId === 'string' && !trailer) {
            throw new Error('Trailer not found')
          }
          if (
            trailer &&
            (trailer.status === TrailerStatus.IN_MAINTENANCE ||
              trailer.status === TrailerStatus.MAINTENANCE_EXT ||
              trailer.status === TrailerStatus.OUT_OF_SERVICE)
          ) {
            throw new Error('Trailer unavailable')
          }

          const originalById = new Map(
            weekRows.map((planningRow) => [
              planningRow.id,
              {
                id: planningRow.id,
                driverId: planningRow.driverId,
                truckId: planningRow.truckId,
                pairLocked: planningRow.pairLocked,
                assignmentOrigin: planningRow.assignmentOrigin,
                usualTruckIdSnapshot: planningRow.usualTruckIdSnapshot,
                isExceptionalReplacement:
                  planningRow.isExceptionalReplacement,
              } as RowState,
            ])
          )
          const finalById = new Map(
            Array.from(originalById.entries()).map(([id, state]) => [
              id,
              { ...state },
            ])
          )
          const target = finalById.get(rowId)
          const originalTarget = originalById.get(rowId)
          if (!target || !originalTarget) throw new Error('Planning row not found')

          const nextDriverId =
            typeof driverId === 'undefined' ? target.driverId : driverId
          const nextTruckId =
            typeof truckId === 'undefined' ? target.truckId : truckId
          if (typeof driverId !== 'undefined' && driverId !== target.driverId) {
            const source = Array.from(finalById.values()).find(
              (candidate) =>
                candidate.id !== rowId && candidate.driverId === driverId
            )
            if (source) {
              // Le geste manuel déplace uniquement la ressource demandée.
              // L'ancienne ressource de la cible retourne au pool.
              source.driverId = null
            }
            target.driverId = driverId
          }

          if (typeof truckId !== 'undefined' && truckId !== target.truckId) {
            const source = Array.from(finalById.values()).find(
              (candidate) =>
                candidate.id !== rowId && candidate.truckId === truckId
            )
            if (source) {
              source.truckId = null
            }
            target.truckId = truckId
          }

          const nextPairLocked =
            typeof pairLocked === 'boolean' ? pairLocked : target.pairLocked
          // Métadonnée historique uniquement : elle reste disponible pour les
          // propositions automatiques mais ne bloque plus le cockpit manuel.
          target.pairLocked = nextPairLocked

          const affected = Array.from(finalById.values()).filter((state) => {
            const original = originalById.get(state.id)
            return (
              !original ||
              isPairChanged(original, state) ||
              original.pairLocked !== state.pairLocked
            )
          })

          for (const state of affected) {
            if (state.id !== rowId && isPairChanged(originalById.get(state.id)!, state)) {
              const original = originalById.get(state.id)!
              await tx.planningRow.update({
                where: { id: state.id },
                data: {
                  driverId:
                    original.driverId !== state.driverId
                      ? state.driverId
                      : undefined,
                  truckId:
                    original.truckId !== state.truckId
                      ? state.truckId
                      : undefined,
                },
              })
            }
          }

          const updatePairState = async (state: RowState) => {
            const original = originalById.get(state.id)!
            const changed = isPairChanged(original, state)
            const metadata = await getPlanningPairMetadata(
              tx,
              state.driverId,
              state.truckId,
              original.assignmentOrigin,
              changed,
              original.usualTruckIdSnapshot,
              original.isExceptionalReplacement
            )
            await tx.planningRow.update({
              where: { id: state.id },
              data: {
                driverId: state.driverId,
                truckId: state.truckId,
                pairLocked: state.pairLocked,
                ...metadata,
              },
            })
            if (changed) {
              await tx.missionAssignment.updateMany({
                where: { planningRowId: state.id },
                data: {
                  driverId: state.driverId,
                  truckId: state.truckId,
                },
              })
            }
          }

          await updatePairState(target)
          for (const state of affected) {
            if (state.id !== rowId) await updatePairState(state)
          }

          let trailerSourceRowIds: string[] = []
          if (typeof trailerId === 'string' && trailerId !== existingRow.trailerId) {
            trailerSourceRowIds = weekRows
              .filter(
                (planningRow) =>
                  planningRow.id !== rowId &&
                  planningRow.trailerId === trailerId
              )
              .map((planningRow) => planningRow.id)
            await tx.planningRow.updateMany({
              where: {
                weekStartDate: existingRow.weekStartDate,
                trailerId,
                id: { not: rowId },
              },
              data: { trailerId: null },
            })
            if (trailerSourceRowIds.length > 0) {
              await tx.missionAssignment.updateMany({
                where: { planningRowId: { in: trailerSourceRowIds } },
                data: { trailerId: null },
              })
            }
          }
          if (typeof trailerId !== 'undefined') {
            await tx.planningRow.update({
              where: { id: rowId },
              data: { trailerId },
            })
            await tx.missionAssignment.updateMany({
              where: { planningRowId: rowId },
              data: { trailerId },
            })
          }

          const affectedRows = await tx.planningRow.findMany({
            where: {
              id: {
                in: Array.from(
                  new Set([
                    rowId,
                    ...affected.map((state) => state.id),
                    ...trailerSourceRowIds,
                  ])
                ),
              },
            },
            include: { driver: true, truck: true, trailer: true },
          })
          const updatedTarget = affectedRows.find(
            (planningRow) => planningRow.id === rowId
          )
          if (!updatedTarget) throw new Error('Planning row not found')

          return { row: updatedTarget, affectedRows }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )

      await synchronizeParkPresence()
      return res.status(200).json(row)
    } catch (error) {
      if (
        error instanceof Error &&
        [
          'Planning row not found',
          'Driver not found',
          'Truck not found',
          'Trailer not found',
        ].includes(error.message)
      ) {
        return res.status(404).json({ error: error.message })
      }
      if (error instanceof Error && error.message === 'Trailer unavailable') {
        return res
          .status(400)
          .json({ error: 'Trailer cannot be assigned while unavailable' })
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        return res.status(409).json({
          error:
            'Cette ressource vient d’être affectée ailleurs. Actualisez puis réessayez.',
        })
      }

      console.error('Failed to update planning row', { rowId, error })
      return res.status(500).json({ error: 'Failed to update planning row' })
    }
  }

  if (req.method === 'DELETE') {
    try {
      await prisma.$transaction(async (tx) => {
        const row = await tx.planningRow.findUnique({
          where: { id: rowId },
          include: { assignments: { include: { mission: true } } },
        })
        if (!row) throw new Error('Planning row not found')
        for (const assignment of row.assignments) {
          await tx.missionAssignment.delete({
            where: { missionId: assignment.missionId },
          })
          await tx.mission.update({
            where: { id: assignment.missionId },
            data: { status: MissionStatus.PENDING },
          })
          await tx.missionEvent.create({
            data: {
              missionId: assignment.missionId,
              driverId: assignment.driverId,
              truckId: assignment.truckId,
              type: MissionEventType.UNASSIGNED,
              message: 'Mission removed with dispatcher planning row.',
              fromStatus: assignment.mission.status,
              toStatus: MissionStatus.PENDING,
              metadata: {
                planningRowId: rowId,
                previousAssignment: assignment,
              },
            },
          })
        }
        await tx.planningRow.delete({ where: { id: rowId } })
      })

      await synchronizeParkPresence()
      return res.status(200).json({ ok: true })
    } catch (error) {
      if (error instanceof Error && error.message === 'Planning row not found') {
        return res.status(404).json({ error: 'Planning row not found' })
      }
      console.error('Failed to delete planning row', { rowId, error })
      return res.status(500).json({ error: 'Failed to delete planning row' })
    }
  }

  res.setHeader('Allow', 'PATCH, DELETE')
  return res.status(405).json({ error: 'Method not allowed' })
}
