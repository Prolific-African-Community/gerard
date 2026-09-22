/**
 * Garantit l'existence d'un compte administrateur dans la base Gerard
 * (DATABASE_URL), sans toucher aux autres donnees.
 *
 * Identifiants lus dans l'environnement local :
 *   GERARD_ADMIN_USERNAME (defaut: gerard.superadmin)
 *   GERARD_ADMIN_PASSWORD (obligatoire)
 *   GERARD_ADMIN_EMAIL    (optionnel)
 *
 * Le mot de passe n'est jamais stocke en clair : il passe par le hash
 * d'authentification normal de Gerard (scrypt, lib/auth/password).
 */
import 'dotenv/config'

import { UserRole } from '@prisma/client'

import { hashPassword } from '../lib/auth/password'
import { createGerardPrisma } from './bootstrap/gerard-initial-data'

const prisma = createGerardPrisma()

async function main() {
  const username = process.env.GERARD_ADMIN_USERNAME?.trim() || 'gerard.superadmin'
  const password = process.env.GERARD_ADMIN_PASSWORD?.trim()
  const email = process.env.GERARD_ADMIN_EMAIL?.trim() || null

  if (!password) {
    throw new Error("GERARD_ADMIN_PASSWORD est obligatoire (aucune valeur par defaut).")
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ id: 'demo-gerard-user-admin' }, { username }] },
  })
  const passwordHash = hashPassword(password)
  const now = new Date()
  const organization = await prisma.organization.upsert({
    where: { slug: 'gerard' },
    create: { id: 'org-gerard-default', name: 'Gerard', slug: 'gerard', status: 'ACTIVE' },
    update: { status: 'ACTIVE' },
  })

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        username,
        passwordHash,
        role: UserRole.ADMIN,
        isActive: true,
        mustChangePassword: false,
        passwordChangedAt: now,
        // Invalide les sessions ouvertes avec l'ancien mot de passe.
        sessionVersion: { increment: 1 },
        ...(email ? { email } : {}),
      },
    })
    await prisma.organizationUser.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: existing.id } },
      create: { organizationId: organization.id, userId: existing.id, role: 'ORG_ADMIN' },
      update: { role: 'ORG_ADMIN' },
    })
    console.info(`Compte admin mis a jour : ${username}`)
    return
  }

  const created = await prisma.user.create({
    data: {
      name: 'Gerard Admin',
      firstName: 'Gerard',
      lastName: 'Admin',
      username,
      email,
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
      mustChangePassword: false,
      passwordChangedAt: now,
    },
  })
  await prisma.organizationUser.create({
    data: { organizationId: organization.id, userId: created.id, role: 'ORG_ADMIN' },
  })
  console.info(`Compte admin cree : ${username}`)
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
