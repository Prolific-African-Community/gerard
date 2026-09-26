import { randomBytes } from 'node:crypto'
import { chmodSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { resolveDeploymentEnvironment } from '@prolific/gerard-core'

import { STAGING_ORGANIZATION, bootstrapDatabase, credentialState, rotateOwnerPassword } from './database'
import { deployToStaging } from './deploy'
import {
  APPS, CONFIGURATION_PATH, FORBIDDEN_STAGING_VARIABLES, LABEL, PRODUCTION_HOSTS, PRODUCTION_PROJECTS, QA_ACCOUNTS, SCOPE, STAGING_PROJECTS, authenticate, fail, fingerprint, flags,
  assertStagingBranch, envRun, isProductionOrPreviewEndpoint, log, main, neon, neonConfig, probe, resolveProjects, stableHost, stagingDatabase, vercelCli, type App, type NeonBranch, type ProjectSettings,
} from './lib'

// npm run staging:setup — one-time (and repeatable) creation of the permanent Staging projects gerard-staging and
// novotralux-custom-staging from the operator's machine, with the Vercel CLI and the Neon CLI only. Idempotent: every
// resource is looked up first and reused. It writes only to the two Staging projects and the two Neon Staging branches;
// the Production projects (gerard, novotralux-custom) are only read, and the legacy project is never addressed.
// Flags: --no-deploy (stop before deploying), --allow-dirty (deploy HEAD despite uncommitted local changes).

const secret = () => randomBytes(48).toString('base64url')
const SETTINGS: [keyof ProjectSettings, string][] = [['framework', '--framework'], ['buildCommand', '--build-command'], ['installCommand', '--install-command'], ['outputDirectory', '--output-directory'], ['rootDirectory', '--root-directory'], ['nodeVersion', '--node-version']]

main(async () => {
  const { has } = flags()
  log(`Gerard Staging setup (scope ${SCOPE}) — Production projects are never modified.\n`)

  // 1–3. Logins and scope.
  await authenticate({ interactive: Boolean(process.stdin.isTTY) })
  log('✔ Vercel CLI and Neon CLI authenticated')
  let { production, staging } = await resolveProjects()
  for (const app of APPS) if (!production[app]) fail(`Production project ${PRODUCTION_PROJECTS[app]} not found in scope ${SCOPE}.`)
  log(`✔ Scope ${SCOPE}: ${APPS.map((app) => PRODUCTION_PROJECTS[app]).join(', ')} found (read only)`)

  // 4. Staging projects: created when missing, build settings mirrored from their Production counterpart.
  for (const app of APPS) {
    if (staging[app]) { log(`✔ ${STAGING_PROJECTS[app]} present`); continue }
    await vercelCli.addProject(STAGING_PROJECTS[app])
    log(`✔ ${STAGING_PROJECTS[app]} created`)
  }
  ;({ staging } = await resolveProjects())
  for (const app of APPS) {
    const source = await vercelCli.inspect(PRODUCTION_PROJECTS[app])
    const target = await vercelCli.inspect(STAGING_PROJECTS[app])
    const changes = SETTINGS.filter(([key]) => source[key] && source[key] !== target[key]).flatMap(([key, flag]) => [flag, String(source[key])])
    if (changes.length) await vercelCli.updateSettings(STAGING_PROJECTS[app], changes)
    log(`✔ ${STAGING_PROJECTS[app]} build settings ${changes.length ? 'aligned on' : 'match'} ${PRODUCTION_PROJECTS[app]}`)
  }

  // 5. Stable URLs: the projects' own production *.vercel.app hosts (known once Vercel assigned them).
  const hosts = {} as Record<App, string>
  for (const app of APPS) hosts[app] = (await stableHost(STAGING_PROJECTS[app])) ?? `${STAGING_PROJECTS[app]}.vercel.app`
  for (const app of APPS) if (PRODUCTION_HOSTS.includes(hosts[app])) fail(`${STAGING_PROJECTS[app]} resolves to Production host ${hosts[app]}: refused.`)

  // 6. Neon: each Staging branch is a CHILD of its own Production branch (parent only read; no root branch). Existing
  //    branches are reused only with the right parent; anything else fails closed before any change.
  let branches = await neon.branches()
  for (const app of APPS) { const found = branches.find((item) => item.name === neonConfig.branches[app]); if (found) assertStagingBranch(app, found) }
  for (const app of APPS) {
    if (branches.some((item) => item.name === neonConfig.branches[app])) { log(`✔ Neon branch ${neonConfig.branches[app]} present (child of ${neonConfig.parents[app]})`); continue }
    const created = await neon.createChildBranch(neonConfig.branches[app], neonConfig.parents[app])
    assertStagingBranch(app, { ...created, name: neonConfig.branches[app] })
    log(`✔ Neon branch ${neonConfig.branches[app]} created as a child of ${neonConfig.parents[app]}`)
    branches = await neon.branches()
  }

  // 7. Per branch, before any Staging project receives a URL: rotate the inherited owner password on the CHILD branch
  //    (first initialization only), sanitize the inherited rows, migrations + QA accounts, fail-closed verification.
  //    Once rotated, the valid credential lives only in the Staging project: later runs use it through `vercel env run`.
  const databases = {} as Record<App, { branch: NeonBranch; endpoint: string; stagingUrl?: string }>
  const candidatePassword = randomBytes(18).toString('base64url')
  let superadminCreated = false
  for (const app of APPS) {
    const { branch, owner, inheritedUrl, endpoint } = await stagingDatabase(app, branches) ?? fail(`Neon branch ${neonConfig.branches[app]} missing after creation`)
    if (isProductionOrPreviewEndpoint(endpoint)) fail(`${branch.name}: Production endpoint: refused.`)
    const hostList = app === 'gerard' ? [hosts.gerard] : []
    const initialPassword = app === 'gerard' ? candidatePassword : undefined
    let result: { fresh?: boolean; sanitized?: { emptied: number; organizations: number }; superadminCreated?: boolean; problems: string[] }
    if (await credentialState(inheritedUrl) === 'inherited') {
      const stagingUrl = await rotateOwnerPassword(inheritedUrl, owner, endpoint)
      log(`✔ ${branch.name}: ${owner} password rotated on the Staging branch only (the inherited Production password no longer opens it)`)
      result = await bootstrapDatabase({ url: stagingUrl, app, branch, hosts: hostList, initialPassword })
      databases[app] = { branch, endpoint, stagingUrl }
    } else {
      log(`✔ ${branch.name}: Staging credential already initialized — using the one stored in ${STAGING_PROJECTS[app]}`)
      const line = (await envRun(STAGING_PROJECTS[app], 'scripts/staging/bootstrap.ts', [app, branch.id, branch.parent_id ?? '', endpoint, hostList.join(',')], { GERARD_STAGING_BOOTSTRAP_INITIAL_PASSWORD: initialPassword ?? '' }, 'GERARD_BOOTSTRAP '))
      result = JSON.parse(line)
      if (result.problems.some((problem) => /no longer opens|no DATABASE_URL|not this Staging branch/.test(problem))) fail(`${branch.name}: ${result.problems.join('; ')}. Reset the ${owner} password of ${branch.name} in the Neon console (never the Production branch), then rerun: setup rotates it again.`)
      databases[app] = { branch, endpoint }
    }
    if (result.sanitized) log(`✔ ${branch.name}: inherited data removed (${result.sanitized.emptied} tables emptied, ${result.sanitized.organizations} organizations removed; kept: schema, migration history, ${STAGING_ORGANIZATION[app]})`)
    else log(`✔ ${branch.name}: already sanitized`)
    if (result.problems.length) fail(`${branch.name} failed verification (${result.problems.join('; ')}): its URL is NOT exported to Vercel.`)
    superadminCreated ||= app === 'gerard' && Boolean(result.superadminCreated)
    log(`✔ ${branch.name} verified: Staging endpoint, no inherited Production data, QA account present, integrations off`)
  }
  if (databases.gerard.endpoint === databases.novotralux.endpoint) fail('Gerard and Novotralux Staging resolve to the same database endpoint: refused.')
  if (resolveDeploymentEnvironment({ VERCEL_ENV: 'production', GERARD_INSTANCE_ENVIRONMENT: 'staging' }) !== 'staging') fail('Staging environment resolution failed: refused.')
  const initialPassword = superadminCreated ? candidatePassword : undefined

  // 8. Staging variables (only now, after verification), in the Vercel "production" scope of the Staging projects (they are Staging).
  const facts = { gerard: await probe(STAGING_PROJECTS.gerard, 'facts', 'gerard'), novotralux: await probe(STAGING_PROJECTS.novotralux, 'facts', 'novotralux') }
  const sharedPrints = APPS.map((app) => facts[app].secrets.GERARD_PLATFORM_INSTANCE_SHARED_SECRET?.fingerprint)
  // One Staging secret pair: kept when both sides already agree, otherwise regenerated for both (both are redeployed).
  const shared = sharedPrints[0] && sharedPrints[0] === sharedPrints[1] ? undefined : secret()
  const channelEndpoint = `https://${hosts.novotralux}${CONFIGURATION_PATH}`
  const desired: Record<App, [string, string | undefined, 'align' | 'keep'][]> = {
    gerard: [
      ['GERARD_INSTANCE_ENVIRONMENT', 'staging', 'align'],
      ['DATABASE_URL', databases.gerard.stagingUrl, 'align'],
      ['GERARD_PLATFORM_HOSTNAMES', hosts.gerard, 'align'],
      ['GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT', channelEndpoint, 'align'],
      ['GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_DOMAIN', hosts.novotralux, 'align'],
      ['GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION', '0', 'align'],
      ['JWT_SECRET', secret(), 'keep'],
      ['GERARD_PLATFORM_INSTANCE_SHARED_SECRET', shared, 'align'],
      // Created only while the account does not exist; the account is never reset afterwards.
      ['GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD', initialPassword, 'align'],
    ],
    novotralux: [
      ['GERARD_INSTANCE_ENVIRONMENT', 'staging', 'align'],
      ['DATABASE_URL', databases.novotralux.stagingUrl, 'align'],
      ['NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL', databases.novotralux.stagingUrl, 'align'],
      ['GERARD_APPLICATION_ID', 'novotralux', 'align'],
      ['GERARD_INSTANCE_ORGANIZATION_ID', 'org-novotralux', 'align'],
      ['NEXT_PUBLIC_GERARD_APPLICATION', 'novotralux', 'align'],
      ['GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION', '0', 'align'],
      ['JWT_SECRET', secret(), 'keep'],
      ['GERARD_PLATFORM_INSTANCE_SHARED_SECRET', shared, 'align'],
    ],
  }
  const changed = { gerard: false, novotralux: false }
  for (const app of APPS) {
    const summary: string[] = []
    for (const [key, value, mode] of desired[app]) {
      if (value === undefined) { summary.push(`${key} kept`); continue }
      const present = facts[app].keys.includes(key)
      const current = key in facts[app].values ? facts[app].values[key] : undefined
      const same = mode === 'keep' ? present
        : key in facts[app].secrets ? facts[app].secrets[key].fingerprint === fingerprint(value)
          : current === value
      if (same) { summary.push(`${key} ok`); continue }
      await vercelCli.setEnv(STAGING_PROJECTS[app], key, value)
      changed[app] = true
      summary.push(`${key} ${present ? 'updated' : 'set'}`)
    }
    log(`✔ ${STAGING_PROJECTS[app]} variables: ${summary.join(', ')}`)
    const forbidden = facts[app].keys.filter((key) => FORBIDDEN_STAGING_VARIABLES.test(key))
    if (forbidden.length) log(`⚠ ${STAGING_PROJECTS[app]}: remove these Production/integration variables: ${forbidden.join(', ')}`)
  }

  // 9. First-run credential, shown once by the run that created the account (else written to a private file).
  if (superadminCreated && initialPassword) {
    const text = `Gerard Staging — https://${hosts.gerard}/login\nusername: ${QA_ACCOUNTS.gerard}\ninitial password: ${initialPassword}\n(changed at first login; Novotralux Staging access: /admin → Novotralux → Accès administrateurs)\n`
    if (process.stdout.isTTY) console.log(`\n──────── shown once ────────\n${text}────────────────────────────\n`)
    else {
      const file = path.join(homedir(), '.gerard-staging-credentials.txt')
      writeFileSync(file, text, { mode: 0o600 }); chmodSync(file, 0o600)
      log(`\nFirst-run credential written once to ${file} (owner-only). Delete it after the first login.`)
    }
  }

  // 10. Deploy both Staging projects (Novotralux first: Gerard's channel targets it), then re-check the stable hosts.
  if (has('--no-deploy')) { log('\nSetup complete (deploy skipped). Next: npm run staging:deploy && npm run staging:check'); return }
  await deployToStaging(['novotralux', 'gerard'], { allowDirty: has('--allow-dirty') })
  const final = { gerard: await stableHost(STAGING_PROJECTS.gerard), novotralux: await stableHost(STAGING_PROJECTS.novotralux) }
  if ((final.gerard && final.gerard !== hosts.gerard) || (final.novotralux && final.novotralux !== hosts.novotralux)) {
    // Vercel assigned different hosts on the first deployment: align Gerard's variables and redeploy it once.
    if (final.gerard) await vercelCli.setEnv(STAGING_PROJECTS.gerard, 'GERARD_PLATFORM_HOSTNAMES', final.gerard)
    if (final.novotralux) {
      await vercelCli.setEnv(STAGING_PROJECTS.gerard, 'GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT', `https://${final.novotralux}${CONFIGURATION_PATH}`)
      await vercelCli.setEnv(STAGING_PROJECTS.gerard, 'GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_DOMAIN', final.novotralux)
    }
    log('✔ Stable hosts assigned by Vercel differ from the defaults: Gerard Staging variables aligned, redeploying it')
    await deployToStaging(['gerard'], { allowDirty: has('--allow-dirty') })
  }
  if (!changed.gerard && !changed.novotralux) log('(no variable changed)')
  log(`\nSetup complete: https://${final.gerard ?? hosts.gerard} · https://${final.novotralux ?? hosts.novotralux}\nNext: npm run staging:check`)
})
