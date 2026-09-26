import { APPS, LABEL, VERCEL_CLI, config, fail, flags, log, main, run, runCli, stagingEnvironment, vercelClient, vercelToken, type App } from './lib'

// npm run staging:deploy               → Gerard Staging + Novotralux Staging (Core or shared changes)
// npm run gerard:staging:deploy        → Gerard Staging only
// npm run novotralux:staging:deploy    → Novotralux Staging only
// Deploys the current commit (any feature branch) to the permanent `staging` custom environment. The target is fixed:
// this command cannot produce a Production or a Preview deployment.

export async function deployToStaging(apps: App[], options: { allowDirty?: boolean } = {}) {
  if (!options.allowDirty && (await run('git', ['status', '--porcelain'], {}, { quiet: true })).output.trim()) fail('Uncommitted changes: commit them so Staging matches a commit (or pass --allow-dirty).')
  const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {}, { quiet: true })).output.trim()
  const commit = (await run('git', ['rev-parse', '--short', 'HEAD'], {}, { quiet: true })).output.trim()
  const token = vercelToken()
  const vercel = vercelClient(token)
  const { projects } = await vercel.resolveScope()
  for (const app of apps) {
    const project = projects[app]
    if (!(await stagingEnvironment(vercel, project))) fail(`${project.name}: no staging environment yet. Run npm run staging:setup first.`)
    log(`\n→ ${branch}@${commit} → ${LABEL[app]} (${project.name}, target staging)`)
    const args = ['deploy', '--target=staging', '--yes']
    if (args.includes('--prod') || args.some((arg) => arg.startsWith('--target=') && arg !== '--target=staging')) fail('Refusing a non-Staging deployment target.')
    // VERCEL_ORG_ID / VERCEL_PROJECT_ID select the project without writing a .vercel link into the checkout.
    const result = await runCli(VERCEL_CLI, args, { VERCEL_ORG_ID: vercel.teamId ?? project.accountId, VERCEL_PROJECT_ID: project.id, VERCEL_TOKEN: token })
    if (result.code !== 0) fail(`${project.name}: Staging deployment failed (see the Vercel output above).`)
    log(`✔ ${LABEL[app]}: https://${config.domains[app]}`)
  }
}

if (/deploy\.ts$/.test(process.argv[1] ?? '')) {
  main(async () => {
    const { positional, has } = flags()
    const requested = positional.length ? positional : APPS
    if (!requested.every((item) => (APPS as string[]).includes(item))) fail(`Unknown application: use ${APPS.join(' | ')}`)
    await deployToStaging(requested as App[], { allowDirty: has('--allow-dirty') })
    log('\nNext: npm run staging:check')
  })
}
