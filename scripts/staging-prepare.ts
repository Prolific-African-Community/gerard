import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolveDeploymentEnvironment } from '@prolific/gerard-core'

import { assertDatabaseForEnvironment } from '../apps/novotralux/scripts/database-target.mjs'
import { redact } from './staging/redact'

// Idempotent preparation of the permanent Staging environments, run by every build and a no-op outside Staging:
// applies migrations to the Staging database and makes sure the stable QA accounts exist. It never resets an existing
// account, never copies data and never touches another environment (docs/CUSTOM_STAGING_WORKFLOW.md).

const environment = resolveDeploymentEnvironment(process.env)
if (environment === 'production') {
  // Static identity check, no connection: a Production build whose database is not a documented Production endpoint
  // fails here, before anything is deployed.
  if (!process.env.DATABASE_URL) throw new Error('PRODUCTION_DATABASE_URL_REQUIRED')
  assertDatabaseForEnvironment('production', process.env.DATABASE_URL)
  console.log('staging-prepare: skipped (production); database identity verified')
  process.exit(0)
}
if (environment !== 'staging') {
  console.log(`staging-prepare: skipped (${environment})`)
  process.exit(0)
}

const url = process.env.DATABASE_URL
if (!url) throw new Error('STAGING_DATABASE_URL_REQUIRED')
assertDatabaseForEnvironment('staging', url)
const custom = process.env.GERARD_APPLICATION_ID === 'novotralux'

async function main() {
  // Migration output names the database host: it is redacted before reaching build or operator logs.
  try {
    process.stdout.write(redact(execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })))
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string }
    process.stdout.write(redact(`${failed.stdout ?? ''}${failed.stderr ?? ''}`))
    throw new Error('STAGING_MIGRATION_FAILED')
  }
  const { prisma } = await import('../lib/prisma')
  const { hashPassword } = await import('../lib/auth/password')
  try {
    if (custom) {
      // Synthetic Novotralux organization; no integration is created, so mail, SL and webhooks stay off.
      await prisma.organization.upsert({ where: { id: 'org-novotralux' }, update: {}, create: { id: 'org-novotralux', name: 'Novotralux Staging', slug: 'novotralux', displayName: 'Novotralux Staging', applicationTitle: 'Novotralux — Staging', accentColor: '#C8FF00' } })
      const existing = await prisma.user.findUnique({ where: { username: 'novotralux.staging.admin' }, select: { id: true } })
      // Unknown password on purpose: access is granted from Gerard Staging with SUPER_ADMIN recovery.
      const admin = existing ?? await prisma.user.create({ data: { username: 'novotralux.staging.admin', firstName: 'Staging', lastName: 'Novotralux', name: 'Staging Novotralux', email: 'novotralux.staging.admin@example.invalid', role: 'ADMIN', passwordHash: hashPassword(randomBytes(32).toString('base64url')), isActive: true, mustChangePassword: true }, select: { id: true } })
      await prisma.organizationUser.upsert({ where: { organizationId_userId: { organizationId: 'org-novotralux', userId: admin.id } }, update: {}, create: { organizationId: 'org-novotralux', userId: admin.id, role: 'ORG_ADMIN' } })
      console.log(`staging-prepare: novotralux.staging.admin ${existing ? 'present' : 'created'}`)
      return
    }
    // Sessions are bound to an organization and to the request domain: map the Staging platform hostnames to the
    // Standard organization, and give the SUPER_ADMIN a read-only VIEWER membership so it holds a valid session.
    for (const hostname of (process.env.GERARD_PLATFORM_HOSTNAMES || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)) {
      const mapped = await prisma.organizationDomain.findFirst({ where: { hostname, pathPrefix: '' }, select: { organizationId: true } })
      if (!mapped) await prisma.organizationDomain.create({ data: { organizationId: 'org-gerard-default', hostname, pathPrefix: '', isPrimary: false, isActive: true } })
      else if (mapped.organizationId !== 'org-gerard-default') throw new Error(`STAGING_HOSTNAME_MAPPED_ELSEWHERE:${hostname}`)
    }
    const membership = (userId: string) => prisma.organizationUser.upsert({ where: { organizationId_userId: { organizationId: 'org-gerard-default', userId } }, update: {}, create: { organizationId: 'org-gerard-default', userId, role: 'VIEWER' } })
    const existing = await prisma.user.findUnique({ where: { username: 'gerard.staging.superadmin' }, select: { id: true } })
    if (existing) { await membership(existing.id); console.log('staging-prepare: gerard.staging.superadmin present'); return }
    // Created once from a Staging-only variable chosen by the operator, and changed at first login.
    const initial = process.env.GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD
    if (!initial || initial.length < 16) { console.warn('staging-prepare: gerard.staging.superadmin missing; set GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD (16+ characters) in Staging to create it'); return }
    const created = await prisma.user.create({ select: { id: true }, data: { username: 'gerard.staging.superadmin', firstName: 'Staging', lastName: 'Super admin', name: 'Staging Super admin', email: 'gerard.staging.superadmin@example.invalid', role: 'ADMIN', platformRole: 'SUPER_ADMIN', passwordHash: hashPassword(initial), isActive: true, mustChangePassword: true } })
    await membership(created.id)
    console.log('staging-prepare: gerard.staging.superadmin created')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => { console.error(`staging-prepare failed: ${error instanceof Error ? error.message : 'unknown'}`); process.exit(1) })
