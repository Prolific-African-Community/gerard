import type { NextApiRequest, NextApiResponse } from 'next'

import { homeForRole, requireAuthenticatedUser } from '../../../lib/auth/authorization'
import { hashPassword, verifyPassword } from '../../../lib/auth/password'
import { createSessionToken, setSessionCookie } from '../../../lib/auth/session'
import { passwordError } from '../../../lib/auth/validation'
import { prisma } from '../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Méthode non autorisée' }) }
  const currentUser = await requireAuthenticatedUser(req, res)
  if (!currentUser) return
  if (!currentUser.isActive) return res.status(403).json({ error: 'Compte inactif' })
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : ''
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : ''
  const user = await prisma.user.findUnique({ where: { id: currentUser.id } })
  if (!user?.passwordHash || !verifyPassword(currentPassword, user.passwordHash)) return res.status(400).json({ error: 'Le mot de passe actuel est incorrect.' })
  const error = passwordError(newPassword)
  if (error) return res.status(400).json({ error })
  if (newPassword !== req.body?.newPasswordConfirmation) return res.status(400).json({ error: 'La confirmation ne correspond pas.' })
  if (verifyPassword(newPassword, user.passwordHash)) return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent.' })
  const updated = await prisma.user.update({ where: { id: user.id }, data: {
    passwordHash: hashPassword(newPassword), mustChangePassword: false,
    passwordChangedAt: new Date(), temporaryPasswordIssuedAt: null,
    sessionVersion: { increment: 1 },
  } })
  setSessionCookie(res, createSessionToken(updated))
  return res.status(200).json({ ok: true, redirectTo: homeForRole(updated.role) })
}
