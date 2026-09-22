import type { NextApiRequest, NextApiResponse } from 'next'
import { requireAdmin } from '../../../../../lib/auth/authorization'
import { hashPassword } from '../../../../../lib/auth/password'
import { passwordError } from '../../../../../lib/auth/validation'
import { prisma } from '../../../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Méthode non autorisée' }) }
  const admin = await requireAdmin(req, res)
  if (!admin) return
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const error = passwordError(password)
  if (error) return res.status(400).json({ error })
  if (password !== req.body?.passwordConfirmation) return res.status(400).json({ error: 'La confirmation ne correspond pas.' })
  const result = await prisma.user.updateMany({ where: { id, organizationMemberships: { some: { organizationId: admin.organizationId } } }, data: {
    passwordHash: hashPassword(password), mustChangePassword: true,
    temporaryPasswordIssuedAt: new Date(), sessionVersion: { increment: 1 },
  } })
  if (!result.count) return res.status(404).json({ error: 'Utilisateur introuvable.' })
  return res.status(200).json({ ok: true })
}
