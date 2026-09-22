import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import {
  DriverStatus,
  RegulatoryStateSource,
} from '@prisma/client'
import type { DriverRegulatoryDeclaration } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import { classifyRegulatoryDeclaration } from '../../../../lib/dispatch/regulatory-declaration-status'
import { prisma } from '../../../../lib/prisma'
import { getIsoWeekKey } from '../../../../lib/dispatch/regulatory'

const simplifiedNumericFields = [
  'dailyDrivingSeconds',
  'weeklyDrivingSeconds',
  'fortnightDrivingSeconds',
  'dailyExtensionsUsedThisWeek',
] as const

function serializeDeclaration(
  declaration: DriverRegulatoryDeclaration & {
    createdByUser?: { id: string; name: string | null; username: string | null } | null
  }
) {
  return {
    id: declaration.id,
    driverId: declaration.driverId,
    source: declaration.source,
    referenceAt: declaration.referenceAt.toISOString(),
    validUntil: declaration.validUntil?.toISOString() ?? null,
    timeZone: declaration.timeZone,
    currentIsoWeek: declaration.currentIsoWeek,
    lastValidRestEndedAt: declaration.lastValidRestEndedAt.toISOString(),
    dutyPeriodStartedAt: declaration.dutyPeriodStartedAt.toISOString(),
    weeklyRestDueAt: declaration.weeklyRestDueAt?.toISOString() ?? null,
    drivingSinceValidBreakSeconds: declaration.drivingSinceValidBreakSeconds,
    dailyDrivingSeconds: declaration.dailyDrivingSeconds,
    weeklyDrivingSeconds: declaration.weeklyDrivingSeconds,
    previousWeekDrivingSeconds: declaration.previousWeekDrivingSeconds,
    dailyExtensionsUsedThisWeek: declaration.dailyExtensionsUsedThisWeek,
    reducedDailyRestsUsedSinceWeeklyRest:
      declaration.reducedDailyRestsUsedSinceWeeklyRest,
    splitBreakFirstPartSeconds: declaration.splitBreakFirstPartSeconds,
    splitDailyRestFirstPartSeconds: declaration.splitDailyRestFirstPartSeconds,
    weeklyRestCompensationDueSeconds:
      declaration.weeklyRestCompensationDueSeconds,
    notes: declaration.notes,
    knownFields: declaration.knownFields,
    createdAt: declaration.createdAt.toISOString(),
    updatedAt: declaration.updatedAt.toISOString(),
    // Audit : auteur de la déclaration (dispatcher) ou système.
    author: declaration.createdByUser
      ? {
          id: declaration.createdByUser.id,
          name: declaration.createdByUser.name,
          username: declaration.createdByUser.username,
        }
      : null,
  }
}

function parseBody(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  const referenceAt = new Date(String(body.referenceAt ?? ''))
  const lastValidRestEndedAt = new Date(
    String(body.lastValidRestEndedAt ?? '')
  )
  const validUntil =
    typeof body.validUntil === 'string' && body.validUntil
      ? new Date(body.validUntil)
      : null
  if (
    typeof body.driverId !== 'string' ||
    !body.driverId.trim() ||
    [referenceAt, lastValidRestEndedAt].some(
      (date) => Number.isNaN(date.getTime())
    ) ||
    (validUntil !== null && Number.isNaN(validUntil.getTime())) ||
    typeof body.operationallyUnavailable !== 'boolean'
  ) {
    return null
  }
  const numbers = Object.fromEntries(
    simplifiedNumericFields.map((field) => [field, body[field]])
  ) as Record<(typeof simplifiedNumericFields)[number], unknown>
  if (
    simplifiedNumericFields.some(
      (field) =>
        typeof numbers[field] !== 'number' ||
        !Number.isInteger(numbers[field]) ||
        Number(numbers[field]) < 0
    ) ||
    Number(numbers.fortnightDrivingSeconds) <
      Number(numbers.weeklyDrivingSeconds)
  ) {
    return null
  }
  if (
    (validUntil !== null && validUntil <= referenceAt) ||
    referenceAt.getTime() > Date.now() + 5 * 60 * 1000
  ) {
    return null
  }
  const weeklyDrivingSeconds = Number(numbers.weeklyDrivingSeconds)
  const fortnightDrivingSeconds = Number(numbers.fortnightDrivingSeconds)
  return {
    driverId: body.driverId.trim(),
    referenceAt,
    validUntil,
    lastValidRestEndedAt,
    dutyPeriodStartedAt: referenceAt,
    currentIsoWeek: getIsoWeekKey(referenceAt, 'Europe/Luxembourg'),
    weeklyRestDueAt: null,
    notes:
      typeof body.notes === 'string' && body.notes.trim()
        ? body.notes.trim()
        : null,
    drivingSinceValidBreakSeconds: 0,
    dailyDrivingSeconds: Number(numbers.dailyDrivingSeconds),
    weeklyDrivingSeconds,
    previousWeekDrivingSeconds:
      fortnightDrivingSeconds - weeklyDrivingSeconds,
    dailyExtensionsUsedThisWeek: Number(
      numbers.dailyExtensionsUsedThisWeek
    ),
    reducedDailyRestsUsedSinceWeeklyRest: 0,
    splitBreakFirstPartSeconds: 0,
    splitDailyRestFirstPartSeconds: 0,
    weeklyRestCompensationDueSeconds: 0,
    knownFields: [
      'dailyDrivingSeconds',
      'weeklyDrivingSeconds',
      'previousWeekDrivingSeconds',
      'dailyExtensionsUsedThisWeek',
      'lastValidRestEndedAt',
      'currentIsoWeek',
    ],
    operationallyUnavailable: body.operationallyUnavailable,
  }
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    // Lecture : autorisée à toute personne pouvant consulter le dispatch.
    if (!(await requirePermission(req, res, permissions.dispatchView))) return
    const driverId =
      typeof req.query.driverId === 'string' ? req.query.driverId.trim() : ''
    if (!driverId) {
      return res.status(400).json({ error: 'Chauffeur requis.' })
    }
    const at =
      typeof req.query.at === 'string' && !Number.isNaN(Date.parse(req.query.at))
        ? new Date(req.query.at)
        : new Date()
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, name: true },
    })
    if (!driver) {
      return res.status(404).json({ error: 'Chauffeur introuvable.' })
    }
    const history = await prisma.driverRegulatoryDeclaration.findMany({
      where: { driverId },
      orderBy: { referenceAt: 'desc' },
      take: 10,
      include: {
        createdByUser: { select: { id: true, name: true, username: true } },
      },
    })
    const current = history[0] ?? null
    return res.status(200).json({
      driver: { id: driver.id, name: driver.name },
      status: classifyRegulatoryDeclaration(current, at),
      referenceAt: at.toISOString(),
      validityDurationSeconds:
        current?.validUntil
          ? Math.round(
              (current.validUntil.getTime() - current.referenceAt.getTime()) /
                1000
            )
          : null,
      current: current ? serializeDeclaration(current) : null,
      history: history.map(serializeDeclaration),
    })
  }

  const user = await requirePermission(req, res, permissions.dispatchAssign)
  if (!user) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }
  const body = parseBody(req.body)
  if (!body) {
    return res.status(400).json({
      error:
        'Les dates ou compteurs réglementaires sont absents, invalides ou trop anciens.',
    })
  }
  const driver = await prisma.driver.findUnique({
    where: { id: body.driverId },
    select: { id: true },
  })
  if (!driver) return res.status(404).json({ error: 'Chauffeur introuvable.' })
  const { operationallyUnavailable, ...declarationInput } = body
  const declaration = await prisma.$transaction(async (tx) => {
    const created = await tx.driverRegulatoryDeclaration.create({
      data: {
        ...declarationInput,
        source: RegulatoryStateSource.DISPATCHER_DECLARATION,
        createdByUserId: user.id,
        timeZone: 'Europe/Luxembourg',
      },
    })
    await tx.driver.update({
      where: { id: body.driverId },
      data: {
        status: operationallyUnavailable
          ? DriverStatus.UNAVAILABLE
          : DriverStatus.ACTIVE,
      },
    })
    return created
  })
  return res.status(201).json({
    declaration: {
      id: declaration.id,
      driverId: declaration.driverId,
      source: declaration.source,
      referenceAt: declaration.referenceAt,
      validUntil: declaration.validUntil,
    },
    validityDurationSeconds: declaration.validUntil
      ? Math.round(
          (declaration.validUntil.getTime() -
            declaration.referenceAt.getTime()) /
            1000
        )
      : null,
    status: classifyRegulatoryDeclaration(declaration, new Date()),
  })
}

export default withTenantApiRoute(handler)
