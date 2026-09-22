import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import { DriverStatus, MissionStatus, UserRole } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { hashPassword } from '../../../../lib/auth/password'
import { usernameError } from '../../../../lib/auth/validation'
import { requirePermission } from '../../../../lib/auth/authorization'
import { hasPermission, permissions } from '../../../../lib/auth/permissions'
import { prisma } from '../../../../lib/prisma'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getDriverId(queryValue: string | string[] | undefined) {
  return typeof queryValue === 'string' && queryValue.trim().length > 0
    ? queryValue.trim()
    : null
}

function getOptionalString(value: unknown): string | null | undefined {
  if (typeof value === 'undefined') {
    return undefined
  }

  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const trimmedValue = value.trim()

  return trimmedValue.length > 0 ? trimmedValue : null
}

function getOptionalNumber(value: unknown): number | null | undefined {
  if (typeof value === 'undefined') {
    return undefined
  }

  if (value === null || value === '') {
    return null
  }

  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
      ? Number(value)
      : Number.NaN

  return Number.isFinite(numberValue) ? numberValue : undefined
}

function isDriverStatus(value: unknown): value is DriverStatus {
  return Object.values(DriverStatus).some((status) => status === value)
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase()
}

function getDriverResponse<
  TDriver extends {
    user?: {
      username: string | null
    } | null
  }
>(driver: TDriver) {
  return {
    ...driver,
    username: driver.user?.username ?? null,
    user: undefined,
  }
}

function parsePayload(body: unknown) {
  if (!isRecord(body)) {
    return null
  }

  const name = getOptionalString(body.name)
  const phone = getOptionalString(body.phone)
  const email = getOptionalString(body.email)
  const truckId = getOptionalString(body.truckId)
  const username = getOptionalString(body.username)
  const password = getOptionalString(body.password)
  const hourlyCostAmount = getOptionalNumber(body.hourlyCostAmount)
  const hourlyCostCurrency = getOptionalString(body.hourlyCostCurrency)

  if (typeof body.name !== 'undefined' && !name) {
    return null
  }

  if (typeof body.status !== 'undefined' && !isDriverStatus(body.status)) {
    return null
  }

  if (
    (typeof username === 'string' && usernameError(normalizeUsername(username))) ||
    typeof username === 'string' &&
    (username.length < 3 || username.length > 32)
  ) {
    return null
  }

  if (typeof password === 'string' && password.length < 8) {
    return null
  }

  if (
    (typeof body.hourlyCostAmount !== 'undefined' &&
      typeof hourlyCostAmount === 'undefined') ||
    (typeof hourlyCostAmount === 'number' && hourlyCostAmount < 0)
  ) {
    return null
  }

  return {
    name,
    phone,
    email,
    truckId,
    username:
      typeof username === 'string' ? normalizeUsername(username) : username,
    password,
    status: isDriverStatus(body.status) ? body.status : undefined,
    hourlyCostAmount,
    hourlyCostCurrency:
      typeof hourlyCostCurrency === 'string' ? hourlyCostCurrency : undefined,
  }
}

const manualPositionFields = [
  'currentLatitude',
  'currentLongitude',
  'currentSpeedKmh',
  'currentHeading',
] as const

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const permission = req.method === 'DELETE' ? permissions.driversDelete : permissions.driversManage
  const sessionUser = await requirePermission(req, res, permission)

  if (!sessionUser) {
    return
  }

  const driverId = getDriverId(req.query.id)

  if (!driverId) {
    return res.status(400).json({ error: 'Driver id is required' })
  }

  if (req.method === 'PATCH') {
    if (
      isRecord(req.body) &&
      manualPositionFields.some((field) => field in req.body)
    ) {
      return res.status(400).json({
        error:
          'La position chauffeur provient exclusivement du partage GPS et ne peut pas être saisie dans Dispatch.',
      })
    }
    if (
      isRecord(req.body) &&
      ('truckId' in req.body &&
        !hasPermission(sessionUser, permissions.dispatchAssign))
    ) {
      return res.status(403).json({ error: 'Affectation opérationnelle interdite.' })
    }
    if (
      isRecord(req.body) &&
      ('username' in req.body || 'password' in req.body) &&
      !hasPermission(sessionUser, permissions.driversCredentialsManage)
    ) {
      return res.status(403).json({ error: 'Gestion des accès chauffeur interdite.' })
    }
    const payload = parsePayload(req.body)

    if (!payload) {
      return res.status(400).json({ error: 'Invalid driver payload' })
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const existingDriver = await tx.driver.findUnique({
          where: { id: driverId },
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
            usualTruck: true,
          },
        })

        if (!existingDriver) {
          throw new Error('Driver not found')
        }

        await tx.driver.update({
          where: { id: driverId },
          data: {
            name: payload.name ?? undefined,
            phone: payload.phone,
            email: payload.email,
            status: payload.status,
            hourlyCostAmount: payload.hourlyCostAmount,
            hourlyCostCurrency: payload.hourlyCostCurrency ?? undefined,
          },
        })

        if (typeof payload.username === 'string') {
          const passwordHash =
            typeof payload.password === 'string'
              ? hashPassword(payload.password)
              : undefined

          if (existingDriver.user) {
            await tx.user.update({
              where: {
                id: existingDriver.user.id,
              },
              data: {
                name: payload.name ?? existingDriver.name,
                email: null,
                username: payload.username,
                passwordHash,
                role: UserRole.DRIVER,
              },
            })
          } else {
            if (!passwordHash) {
              throw new Error('Driver password required')
            }

            const driverUser = await tx.user.create({
              data: {
                name: payload.name ?? existingDriver.name,
                email: null,
                username: payload.username,
                passwordHash,
                role: UserRole.DRIVER,
                driverId,
              },
            })
            await tx.organizationUser.create({
              data: {
                organizationId: sessionUser.organizationId,
                userId: driverUser.id,
                role: 'DRIVER',
              },
            })
          }
        } else if (typeof payload.password === 'string') {
          if (!existingDriver.user) {
            throw new Error('Driver username required')
          }

          await tx.user.update({
            where: {
              id: existingDriver.user.id,
            },
            data: {
              passwordHash: hashPassword(payload.password),
            },
          })
        }

        if (typeof payload.truckId !== 'undefined') {
          if (payload.truckId === null) {
            await tx.truck.updateMany({
              where: { driverId },
              data: { driverId: null },
            })
          } else {
            const truck = await tx.truck.findUnique({
              where: { id: payload.truckId },
            })

            if (!truck) {
              throw new Error('Truck not found')
            }

            await tx.truck.updateMany({
              where: { driverId, id: { not: payload.truckId } },
              data: { driverId: null },
            })
            await tx.truck.updateMany({
              where: {
                driverId: { not: driverId },
                id: payload.truckId,
              },
              data: { driverId: null },
            })
            await tx.truck.update({
              where: { id: payload.truckId },
              data: { driverId },
            })
          }
        }

        const [driver, trucks] = await Promise.all([
          tx.driver.findUniqueOrThrow({
            where: { id: driverId },
            include: {
              user: {
                select: {
                  username: true,
                },
              },
              usualTruck: true,
            },
          }),
          tx.truck.findMany({ orderBy: { plateNumber: 'asc' } }),
        ])

        return { driver: getDriverResponse(driver), trucks }
      })

      return res.status(200).json(result)
    } catch (error) {
      if (error instanceof Error && error.message === 'Driver not found') {
        return res.status(404).json({ error: 'Driver not found' })
      }

      if (error instanceof Error && error.message === 'Truck not found') {
        return res.status(404).json({ error: 'Truck not found' })
      }

      if (
        error instanceof Error &&
        (error.message === 'Driver password required' ||
          error.message === 'Driver username required')
      ) {
        return res.status(400).json({ error: error.message })
      }

      if (
        error instanceof Error &&
        error.message.includes('Unique constraint')
      ) {
        return res.status(409).json({ error: 'Username already exists' })
      }

      console.error('Failed to update driver', {
        driverId,
        error,
      })
      return res.status(500).json({ error: 'Failed to update driver' })
    }
  }

  if (req.method === 'DELETE') {
    try {
      const existingDriver = await prisma.driver.findUnique({
        where: { id: driverId },
        include: {
          user: {
            select: {
              id: true,
              role: true,
            },
          },
        },
      })

      if (!existingDriver) {
        return res.status(404).json({ error: 'Driver not found' })
      }

      const activeAssignment = await prisma.missionAssignment.findFirst({
        where: {
          driverId,
          mission: {
            status: {
              in: [
                MissionStatus.PENDING,
                MissionStatus.ASSIGNED,
                MissionStatus.IN_PROGRESS,
                MissionStatus.ISSUE,
              ],
            },
          },
        },
        select: {
          id: true,
        },
      })

      if (activeAssignment) {
        return res.status(409).json({
          error:
            'Ce chauffeur a une mission active. Terminez ou réassignez la mission avant suppression.',
        })
      }

      await prisma.$transaction(async (tx) => {
        await tx.planningRow.updateMany({
          where: { driverId },
          data: { driverId: null },
        })
        await tx.missionAssignment.updateMany({
          where: { driverId },
          data: { driverId: null },
        })
        await tx.truck.updateMany({
          where: { driverId },
          data: { driverId: null },
        })
        await tx.driverPosition.deleteMany({
          where: { driverId },
        })

        if (existingDriver.user?.role === UserRole.DRIVER) {
          await tx.user.delete({
            where: { id: existingDriver.user.id },
          })
        }

        await tx.driver.delete({
          where: { id: driverId },
        })
      })

      return res.status(200).json({ success: true })
    } catch (error) {
      console.error('Failed to delete driver', {
        driverId,
        error,
      })
      return res
        .status(500)
        .json({ error: 'Impossible de supprimer le chauffeur.' })
    }
  }

  res.setHeader('Allow', 'PATCH, DELETE')
  return res.status(405).json({ error: 'Method not allowed' })
}

export default withTenantApiRoute(handler)
