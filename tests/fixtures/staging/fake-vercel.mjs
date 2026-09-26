// Test double of the `vercel` CLI for tests/staging-operator.integration.ts. It emulates only the commands the Staging
// tooling uses (whoami, project ls/add/inspect/update, api GET, env add/run, deploy), keeps projects in the JSON state
// file and logs every invocation so the test can prove which projects were read or written. It does not validate real
// Vercel behaviour; it pins the tooling's own contract (scope, project names, stdin values, worktree deploys).
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const file = process.env.FAKE_STAGING_STATE
const state = JSON.parse(readFileSync(file, 'utf8'))
const save = () => writeFileSync(file, JSON.stringify(state, null, 2))
let args = process.argv.slice(2)
const scopeIndex = args.indexOf('--scope')
const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : undefined
if (scopeIndex >= 0) args = [...args.slice(0, scopeIndex), ...args.slice(scopeIndex + 2)]
const separator = args.indexOf('--')
const command = separator >= 0 ? args.slice(0, separator) : args
const option = (name) => { const index = command.indexOf(name); return index >= 0 ? command[index + 1] : undefined }
state.vercelCalls.push({ args: command, scope: scope ?? null, projectEnv: process.env.VERCEL_PROJECT_ID ?? null }); save()
const out = (value) => { process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value, null, 2)); process.stdout.write('\n') }
const die = (message, code = 1) => { process.stderr.write(`Error: ${message}\n`); process.exit(code) }
const project = (nameOrId) => state.projects.find((item) => item.name === nameOrId || item.id === nameOrId)

if (command[0] === 'whoami') process.exit(state.vercelUnauthenticated ? 1 : 0)
if (command[0] === 'login') process.exit(1)
if (scope !== state.scope) die(`scope ${scope} not accessible`)

if (command[0] === 'project') {
  const [, sub, name] = command
  if (sub === 'ls') out({ projects: state.projects.map((item) => ({ name: item.name, id: item.id, latestProductionUrl: item.domains[0] ? `https://${item.domains[0]}` : '--' })), contextName: scope })
  else if (sub === 'add') {
    if (project(name)) die('project exists')
    state.projects.push({ id: `prj_${name.replace(/-/g, '_')}`, name, accountId: state.teamId, settings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null, rootDirectory: null, nodeVersion: '22.x' }, env: {}, domains: state.assignDomainOnCreate ? [state.stagingDomains?.[name] ?? `${name}.vercel.app`] : [] })
    save(); out(`Success! Project ${name} added`)
  } else if (sub === 'inspect') {
    const found = project(name) ?? die('project not found')
    out({ id: found.id, name: found.name, owner: { name: 'Jonathan', slug: scope }, ...found.settings })
  } else if (sub === 'update') {
    const found = project(name) ?? die('project not found')
    const map = { '--framework': 'framework', '--build-command': 'buildCommand', '--install-command': 'installCommand', '--output-directory': 'outputDirectory', '--root-directory': 'rootDirectory', '--node-version': 'nodeVersion' }
    for (const [flag, key] of Object.entries(map)) if (option(flag) !== undefined) found.settings[key] = option(flag)
    if (command.includes('--yes')) die('unknown option --yes')
    save(); out('Updated')
  } else die(`unsupported project ${sub}`, 2)
  process.exit(0)
}

if (command[0] === 'api') {
  const url = new URL(command[1], 'https://api.invalid')
  if (url.searchParams.get('slug') !== state.scope) die('slug missing')
  const [, , , name, rest] = url.pathname.split('/')
  const found = project(decodeURIComponent(name)) ?? die('not found')
  if (rest === 'domains') out({ domains: found.domains.map((domain) => ({ name: domain, gitBranch: null, redirect: null })) })
  else out({ id: found.id, name: found.name, accountId: found.accountId })
  process.exit(0)
}

if (command[0] === 'env') {
  const found = project(option('--project')) ?? die('project not found')
  if (command[1] === 'add') {
    if (command[3] !== 'production' || !command.includes('--force') || command.includes('--value')) die('unexpected env add usage', 2)
    let value = ''
    for await (const chunk of process.stdin) value += chunk
    found.env[command[2]] = value; save(); out(`Added ${command[2]}`)
    process.exit(0)
  }
  if (command[1] === 'run') {
    if (option('-e') !== 'production') die('env run expects -e production', 2)
    const [executable, ...rest] = args.slice(separator + 1)
    const child = spawn(executable, rest, { env: { ...process.env, ...found.env, VERCEL_ENV: 'production' }, stdio: 'inherit' })
    child.on('close', (code) => process.exit(code ?? 1))
  } else die(`unsupported env ${command[1]}`, 2)
} else if (command[0] === 'deploy') {
  const found = project(process.env.VERCEL_PROJECT_ID) ?? die('project not found')
  if (process.env.VERCEL_ORG_ID !== state.teamId) die('VERCEL_ORG_ID must be the team id')
  if (!command.includes('--prod')) die('expected --prod', 2)
  if (!existsSync(path.join(process.cwd(), '.git')) || existsSync(path.join(process.cwd(), '.env'))) die('deploy must run from a clean worktree')
  state.deploys.push({ project: found.name, cwd: process.cwd() })
  if (!found.domains.length) found.domains.push(state.stagingDomains?.[found.name] ?? `${found.name}.vercel.app`)
  save(); out(`https://${found.name}-abc123.vercel.app`)
  process.exit(0)
} else if (command[0] !== 'env') die(`unsupported ${command.join(' ')}`, 2)
