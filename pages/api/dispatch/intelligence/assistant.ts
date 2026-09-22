import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from 'next'
import { answerAssistantQuestion } from '@prolific/gerard-core/intelligence'
import { requireOrganizationModule, requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import { parseWeekStartParam } from '../../../../lib/dispatch/date-utils'

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const user = await requirePermission(req, res, permissions.dispatchView)
  if (!user) return
  if (!(await requireOrganizationModule(req, res, 'ASSISTANT'))) return
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  const weekStart = parseWeekStartParam(typeof req.body?.weekStart === 'string' ? req.body.weekStart : '')
  if (!message || message.length > 1000 || !weekStart) return res.status(400).json({ error: 'Question ou semaine invalide.' })
  const rawContext = req.body?.conversationContext
  const conversationContext = rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext) ? {
    missionReference: typeof rawContext.missionReference === 'string' ? rawContext.missionReference : undefined,
    suggestionId: typeof rawContext.suggestionId === 'string' ? rawContext.suggestionId : undefined,
  } : undefined
  try {
    return res.status(200).json(await answerAssistantQuestion({ message, weekStart, conversationContext }))
  } catch (error) {
    console.error('Gerard assistant failed', error instanceof Error ? error.message : error)
    return res.status(503).json({ error: 'Gerard ne peut pas consulter le planning pour le moment.' })
  }
}

export default withTenantApiRoute(handler)
