import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import { prepareAutoPlanningWeek } from '../../../../lib/dispatch/auto-planning/preparation'
import { simulateAutoPlanning } from '../../../../lib/dispatch/auto-planning/simulation'
import { parseWeekStartParam } from '../../../../lib/dispatch/date-utils'
import { optimizationStrategies } from '../../../../lib/dispatch/optimization'

const runningByUserId = new Set<string>()
const maximumResponseBytes = 2 * 1024 * 1024

function parseBody(body: unknown) {
  if (!body || typeof body !== 'object') return null
  const value = body as Record<string, unknown>
  const weekStart =
    typeof value.weekStart === 'string'
      ? parseWeekStartParam(value.weekStart)
      : null
  const strategy =
    typeof value.strategy === 'string' &&
    optimizationStrategies.includes(
      value.strategy as (typeof optimizationStrategies)[number]
    )
      ? (value.strategy as (typeof optimizationStrategies)[number])
      : null
  if (!weekStart || !strategy) return null
  return {
    weekStart,
    strategy,
    compareStrategies: value.compareStrategies === true,
    includeExistingForced: value.includeExistingForced === true,
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await requirePermission(req, res, permissions.dispatchAssign)
  if (!user) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }
  const body = parseBody(req.body)
  if (!body) {
    return res.status(400).json({ error: 'Paramètres de planification invalides' })
  }
  if (runningByUserId.has(user.id)) {
    return res.status(429).json({
      error: 'Une planification est déjà en cours pour cet utilisateur.',
    })
  }

  runningByUserId.add(user.id)
  try {
    const preparation = await prepareAutoPlanningWeek({
      weekStartDate: body.weekStart,
      includeExistingForced: body.includeExistingForced,
    })
    const simulation = await simulateAutoPlanning({
      userId: user.id,
      weekStartDate: body.weekStart,
      strategy: body.strategy,
      compareStrategies: body.compareStrategies,
      includeExistingForced: body.includeExistingForced,
    })
    const result = { ...simulation, preparation }
    if (Buffer.byteLength(JSON.stringify(result)) > maximumResponseBytes) {
      return res.status(413).json({
        error: 'Le résultat dépasse la taille maximale autorisée.',
      })
    }
    return res.status(200).json(result)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'SIMULATION_VOLUME_EXCEEDED'
    ) {
      return res.status(413).json({
        error: 'La période contient trop de missions pour une simulation.',
      })
    }
    console.error('Auto-planning preparation failed', error)
    return res.status(500).json({
      error: 'La planification automatique n’a pas pu être préparée.',
    })
  } finally {
    runningByUserId.delete(user.id)
  }
}
