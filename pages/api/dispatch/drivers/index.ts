import { DriverStatus, UserRole } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { hashPassword } from '../../../../lib/auth/password'
import { usernameError } from '../../../../lib/auth/validation'
import { requirePermission } from '../../../../lib/auth/authorization'
import { hasPermission, permissions } from '../../../../lib/auth/permissions'
import { prisma } from '../../../../lib/prisma'

type DriverPayload = {
  name: string
  phone?: string | null
  email?: string | null
  status?: DriverStatus
  truckId?: string | null
  username?: string | null
  password?: string | null
  hourlyCostAmount?: number | null
  hourlyCostCurrency?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

function parsePayload(body: unknown): DriverPayload | null {
  if (!isRecord(body)) {
    return null
  }

  const name = getOptionalString(body.name)

  if (!name) {
    return null
  }

  if (typeof body.status !== 'undefined' && !isDriverStatus(body.status)) {
    return null
  }

  const truckId = getOptionalString(body.truckId)
  const username = getOptionalString(body.username)
  const password = getOptionalString(body.password)
  const hourlyCostAmount = getOptionalNumber(body.hourlyCostAmount)
  const hourlyCostCurrency = getOptionalString(body.hourlyCostCurrency)

  if (
    typeof username === 'string' &&
    (username.length < 3 || username.length > 32)
  ) {
    return null
  }

  if (typeof password === 'string' && password.length < 8) {
    return null
  }

  if (typeof username === 'string' && (!password || usernameError(normalizeUsername(username)))) {
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
    phone: getOptionalString(body.phone),
    email: getOptionalString(body.email),
    status: isDriverStatus(body.status) ? body.status : DriverStatus.ACTIVE,
    truckId,
    username:
      typeof username === 'string' ? normalizeUsername(username) : username,
    password,
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const permission = req.method === 'GET' ? permissions.driversView : permissions.driversManage
  const sessionUser = await requirePermission(req, res, permission)

  if (!sessionUser) {
    return
  }

  if (req.method === 'GET') {
    try {
      const drivers = await prisma.driver.findMany({
        orderBy: {
          name: 'asc',
        },
        include: {
          user: {
            select: {
              username: true,
            },
          },
          usualTruck: true,
        },
      })

      return res
        .status(200)
        .json({ drivers: drivers.map((driver) => getDriverResponse(driver)) })
    } catch (error) {
      console.error('Failed to load drivers', error)
      return res.status(500).json({ error: 'Failed to load drivers' })
    }
  }

  if (req.method === 'POST') {
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
        const driver = await tx.driver.create({
          data: {
            name: payload.name,
            phone: payload.phone,
            email: payload.email,
            status: payload.status ?? DriverStatus.ACTIVE,
            hourlyCostAmount: payload.hourlyCostAmount,
            hourlyCostCurrency: payload.hourlyCostCurrency ?? 'EUR',
          },
        })

        if (payload.username) {
          await tx.user.create({
            data: {
              name: payload.name,
              email: null,
              username: payload.username,
              passwordHash: hashPassword(payload.password ?? ''),
              role: UserRole.DRIVER,
              driverId: driver.id,
            },
          })
        }

        if (typeof payload.truckId !== 'undefined') {
          if (payload.truckId === null) {
            await tx.truck.updateMany({
              where: { driverId: driver.id },
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
              where: { driverId: driver.id, id: { not: payload.truckId } },
              data: { driverId: null },
            })
            await tx.truck.update({
              where: { id: payload.truckId },
              data: { driverId: driver.id },
            })
          }
        }

        const [updatedDriver, trucks] = await Promise.all([
          tx.driver.findUniqueOrThrow({
            where: { id: driver.id },
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

        return {
          driver: getDriverResponse(updatedDriver),
          trucks,
        }
      })

      return res.status(201).json(result)
    } catch (error) {
      if (error instanceof Error && error.message === 'Truck not found') {
        return res.status(404).json({ error: 'Truck not found' })
      }

      if (
        error instanceof Error &&
        error.message.includes('Unique constraint')
      ) {
        return res.status(409).json({ error: 'Username already exists' })
      }

      console.error('Failed to create driver', error)
      return res.status(500).json({ error: 'Failed to create driver' })
    }
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'Method not allowed' })
}
