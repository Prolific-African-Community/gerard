import { randomBytes } from 'node:crypto'
import { chmodSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import pg from 'pg'

import { deployToStaging } from './deploy'
import {
  APPS, CONFIGURATION_PATH, FORBIDDEN_STAGING_VARIABLES, LABEL, appliesTo, authenticate, automationBypass, config, fail, flags, log, main, neon,
  productionDomain, run, stagingDatabase, stagingEndpoint, stagingEnvironment, stagingOnly, trustsStaging, vercelClient, type App, type TrustedProject, type VercelEnv,
} from './lib'

// npm run staging:setup — one-time (and repeatable) creation of the permanent Staging environments from the operator's
// machine. Idempotent: every resource is looked up first and reused; only what is missing is created. It writes only to
// the Vercel `staging` custom environments and to the two Neon Staging branches, and refuses anything else.
// Flags: --no-deploy (stop before deploying), --allow-dirty (deploy uncommitted changes).

const secret = () => randomBytes(48).toString('base64url')

main(async () => {
  const { has } = flags()
  log('Gerard Staging setup — Production is never written.\n')

  // 1. Authentication (interactive login when needed).
  const token = await authenticate({ interactive: Boolean(process.stdin.isTTY) })
  log('✔ Vercel CLI and Neon CLI authenticated')

  // 2. Projects.
  const vercel = vercelClient(token)
  const projects = await vercel.resolveProjects()
  log(`✔ Vercel scope ${vercel.scope}: ${APPS.map((app) => projects[app].name).join(' + ')}`)
  for (const app of APPS) if (config.productionHosts.includes(config.domains[app].toLowerCase())) fail(`Staging domain ${config.domains[app]} is a Production host: refused.`)

  // 3. Vercel `staging` custom environments.
  const staging = {} as Record<App, string>
  for (const app of APPS) {
    const existing = await stagingEnvironment(vercel, projects[app])
    if (!existing) {
      // Custom environments depend on the Vercel plan: say so instead of failing on the create call.
      const { environments, limit } = await vercel.customEnvironments(projects[app].id)
      const custom = environments.filter((item) => !['production', 'preview', 'development'].includes(item.slug)).length
      if (limit !== undefined && custom >= limit) fail(`${projects[app].name}: the Vercel plan of scope ${vercel.scope} allows ${limit} custom environment(s) and ${custom} exist; a "staging" custom environment needs a Pro/Enterprise slot.`)
    }
    staging[app] = existing?.id ?? (await vercel.createCustomEnvironment(projects[app].id)).id
    log(`✔ ${projects[app].name}: staging environment ${existing ? 'present' : 'created'}`)
  }

  // 4. Neon Staging branches (schema-only, never a data copy).
  let branches = await neon.branches()
  // Existing Staging-named branches are validated before anything is created.
  for (const app of APPS) await stagingDatabase(app, branches)
  for (const app of APPS) {
    if (branches.some((item) => item.name === config.neon.branches[app])) { log(`✔ Neon branch ${config.neon.branches[app]} present`); continue }
    await neon.createBranch(config.neon.branches[app])
    log(`✔ Neon branch ${config.neon.branches[app]} created (schema-only)`)
    branches = await neon.branches()
  }
  const databases = {} as Record<App, NonNullable<Awaited<ReturnType<typeof stagingDatabase>>>>
  for (const app of APPS) databases[app] = await stagingDatabase(app, branches) ?? fail(`Neon branch ${config.neon.branches[app]} not found after creation`)
  if (databases.gerard.endpoint === databases.novotralux.endpoint) fail('Gerard and Novotralux Staging resolve to the same database endpoint: refused.')

  // 5. A schema-only branch carries tables but no migration history: rebuild it from this repository's migrations, only
  //    while it holds no history and no user (a fresh branch). An initialised Staging database is never reset.
  for (const app of APPS) {
    const client = new pg.Client({ connectionString: databases[app].direct })
    await client.connect()
    try {
      const history = (await client.query(`select to_regclass('public._prisma_migrations') as t`)).rows[0].t ? Number((await client.query('select count(*)::int as n from public._prisma_migrations')).rows[0].n) : 0
      if (history) { log(`✔ ${LABEL[app]} database initialised (${history} migrations)`); continue }
      const users = (await client.query(`select to_regclass('public."User"') as t`)).rows[0].t ? Number((await client.query('select count(*)::int as n from public."User"')).rows[0].n) : 0
      if (users) fail(`${LABEL[app]} database has users but no migration history: refusing to reset it.`)
      await client.query('drop schema if exists public cascade; create schema public;')
      log(`✔ ${LABEL[app]} database emptied for migrations (fresh branch)`)
    } finally {
      await client.end()
    }
  }

  // 6. Vercel Staging variables: create what is missing, align what setup owns, never touch another scope.
  const envs = {} as Record<App, VercelEnv[]>
  for (const app of APPS) envs[app] = await vercel.envs(projects[app].id)
  const find = (app: App, key: string) => {
    const matches = envs[app].filter((item) => item.key === key && appliesTo(item, staging[app]))
    if (matches.length > 1) fail(`${projects[app].name}: ${key} is defined twice for staging`)
    if (matches[0] && !stagingOnly(matches[0], staging[app])) fail(`${projects[app].name}: ${key} is shared with another environment; setup only edits Staging-only variables.`)
    return matches[0]
  }
  const read = async (app: App, key: string) => { const item = find(app, key); return item ? vercel.decrypt(projects[app].id, item.id) : undefined }
  const ensure = async (app: App, key: string, value: string, mode: 'align' | 'keep') => {
    const item = find(app, key)
    if (!item) { await vercel.createEnv(projects[app].id, staging[app], key, value); return 'created' }
    if (mode === 'keep' || (await vercel.decrypt(projects[app].id, item.id)) === value) return 'present'
    await vercel.updateEnv(projects[app].id, item.id, value)
    return 'updated'
  }

  // Staging-only secrets: generated here, one shared-secret pair for both Staging apps, independent from Production/Preview.
  const shared = (await read('gerard', 'GERARD_PLATFORM_INSTANCE_SHARED_SECRET')) || (await read('novotralux', 'GERARD_PLATFORM_INSTANCE_SHARED_SECRET')) || secret()
  // Kept in the Staging scope so a rebuilt Staging database can recreate the account; shown only when it creates one.
  const initialPassword = (await read('gerard', 'GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD')) || randomBytes(18).toString('base64url')
  const variables: Record<App, [string, string, 'align' | 'keep'][]> = {
    gerard: [
      ['GERARD_INSTANCE_ENVIRONMENT', 'staging', 'align'],
      ['DATABASE_URL', databases.gerard.direct, 'align'],
      ['GERARD_PLATFORM_HOSTNAMES', config.domains.gerard, 'align'],
      ['GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT', stagingEndpoint(), 'align'],
      ['GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_DOMAIN', config.domains.novotralux, 'align'],
      ['GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION', '0', 'align'],
      ['JWT_SECRET', secret(), 'keep'],
      ['GERARD_PLATFORM_INSTANCE_SHARED_SECRET', shared, 'align'],
      ['GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD', initialPassword, 'keep'],
    ],
    novotralux: [
      ['GERARD_INSTANCE_ENVIRONMENT', 'staging', 'align'],
      ['NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL', databases.novotralux.direct, 'align'],
      ['GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION', '0', 'align'],
      ['JWT_SECRET', secret(), 'keep'],
      ['GERARD_PLATFORM_INSTANCE_SHARED_SECRET', shared, 'align'],
    ],
  }
  for (const app of APPS) {
    const summary: string[] = []
    for (const [key, value, mode] of variables[app]) summary.push(`${key} ${await ensure(app, key, value, mode)}`)
    log(`✔ ${projects[app].name} staging variables: ${summary.join(', ')}`)
    const forbidden = envs[app].filter((item) => appliesTo(item, staging[app]) && FORBIDDEN_STAGING_VARIABLES.test(item.key)).map((item) => item.key)
    if (forbidden.length) log(`⚠ ${projects[app].name}: remove from Staging (integration/Production variables): ${forbidden.join(', ')}`)
  }

  // 7. Stable domains attached to the staging environment only.
  for (const app of APPS) {
    const attached = (await vercel.domains(projects[app].id)).find((item) => item.name.toLowerCase() === config.domains[app].toLowerCase())
    if (attached && attached.customEnvironmentId !== staging[app]) fail(`${config.domains[app]} is attached to ${productionDomain(attached) ? 'Production' : 'another environment'} of ${projects[app].name}: refused.`)
    if (!attached) await vercel.addDomain(projects[app].id, config.domains[app], staging[app])
    log(`✔ ${LABEL[app]} domain https://${config.domains[app]} ${attached ? 'present' : 'attached'}`)
  }

  // 8. Deployment Protection stays on; an automation bypass lets staging:check reach the protected Staging endpoints.
  for (const app of APPS) {
    if (automationBypass(projects[app])) continue
    await vercel.generateBypass(projects[app].id)
    log(`✔ ${projects[app].name}: automation bypass generated for readiness checks (protection unchanged)`)
  }

  // 8b. Trusted Sources: Gerard Staging calls Novotralux Staging with its Vercel OIDC token. Ensure the Novotralux project
  //     trusts the Gerard project for staging → staging; existing rules and every other environment are left as they are.
  const trusted = projects.novotralux.trustedSources ?? {}
  const entry = trusted.projects?.[projects.gerard.id]
  if (trustsStaging(entry)) log(`✔ ${projects.novotralux.name} trusts ${projects.gerard.name} for staging → staging`)
  else {
    const rule = { from: { slugs: [config.vercel.environment] }, to: { slugs: [config.vercel.environment] } }
    const updated: TrustedProject = { ...entry, label: entry?.label ?? 'Gerard Platform', customAllow: [...(entry?.customAllow ?? []), rule] }
    await vercel.updateTrustedSources(projects.novotralux.id, { ...trusted, projects: { ...(trusted.projects ?? {}), [projects.gerard.id]: updated } })
    log(`✔ ${projects.novotralux.name}: Trusted Sources rule added for ${projects.gerard.name} staging → staging (other rules unchanged)`)
  }

  // 9. Migrations and QA accounts, through the same step every Staging build runs (never resets an existing account).
  let superadminCreated = false
  for (const app of APPS) {
    const result = await run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'scripts/staging-prepare.ts'], {
      VERCEL: '', VERCEL_ENV: '', VERCEL_TARGET_ENV: '', GERARD_INSTANCE_ENVIRONMENT: 'staging', DATABASE_URL: databases[app].direct,
      GERARD_APPLICATION_ID: app === 'novotralux' ? 'novotralux' : '', GERARD_INSTANCE_ORGANIZATION_ID: app === 'novotralux' ? 'org-novotralux' : '',
      GERARD_PLATFORM_HOSTNAMES: app === 'gerard' ? config.domains.gerard : '', GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD: app === 'gerard' ? initialPassword : '',
    })
    if (result.code !== 0) fail(`${LABEL[app]}: migrations/QA accounts failed (output above).`)
    superadminCreated ||= /gerard\.staging\.superadmin created/.test(result.output)
  }

  // 10. First-run credential, returned once (only in the run that created the account): on screen in an interactive terminal, else in a private file.
  if (superadminCreated) {
    const text = `Gerard Staging — https://${config.domains.gerard}/login\nusername: gerard.staging.superadmin\ninitial password: ${initialPassword}\n(changed at first login; Novotralux Staging access: /admin → Novotralux → Accès administrateurs)\n`
    if (process.stdout.isTTY) console.log(`\n──────── shown once ────────\n${text}────────────────────────────\n`)
    else {
      const file = path.join(homedir(), '.gerard-staging-credentials.txt')
      writeFileSync(file, text, { mode: 0o600 }); chmodSync(file, 0o600)
      log(`\nFirst-run credential written once to ${file} (owner-only). Delete it after the first login.`)
    }
  }

  // 11. Deploy both apps to Staging, then validate.
  if (has('--no-deploy')) { log('\nSetup complete (deploy skipped). Next: npm run staging:deploy && npm run staging:check'); return }
  await deployToStaging(APPS, { allowDirty: has('--allow-dirty') })
  log(`\nSetup complete. Channel endpoint: ${new URL(stagingEndpoint()).host}${CONFIGURATION_PATH}. Next: npm run staging:check`)
})
