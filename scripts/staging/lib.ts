import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

import { PRODUCTION_DATABASE_ENDPOINTS, PREVIEW_DATABASE_ENDPOINTS, assertDatabaseForEnvironment, databaseEndpointId } from '../../apps/novotralux/scripts/database-target.mjs'
import { redact } from './redact'

export { redact }

// Shared plumbing of the Staging operator commands (docs/CUSTOM_STAGING_WORKFLOW.md), run from the operator's machine
// through the Vercel CLI and the Neon CLI only: their own login sessions authenticate every call; no token is read and no
// Vercel REST host is called directly. Nothing here prints a secret value or a database URL.

export type App = 'gerard' | 'novotralux'
export const APPS: App[] = ['gerard', 'novotralux']
export const LABEL: Record<App, string> = { gerard: 'Gerard Staging', novotralux: 'Novotralux Staging' }

// ─── Canonical Vercel projects (scope jonathans-projects-e6d49b10) — fixed names, never derived from a hostname ─────
export const SCOPE = 'jonathans-projects-e6d49b10'
export const PRODUCTION_PROJECTS: Readonly<Record<App, string>> = Object.freeze({ gerard: 'gerard', novotralux: 'novotralux-custom' })
export const STAGING_PROJECTS: Readonly<Record<App, string>> = Object.freeze({ gerard: 'gerard-staging', novotralux: 'novotralux-custom-staging' })
export const LEGACY_PROJECTS = Object.freeze(['novotralux'])
// Hosts serving Production; no Staging value may point at them.
export const PRODUCTION_HOSTS = Object.freeze(['gerard-dispatch.vercel.app', 'gerard.vercel.app', 'novotralux-custom.vercel.app', 'www.novotralux.eu', 'novotralux.eu'])

// Every project this tooling writes to or deploys must pass here.
export function assertStagingProject(name: string) {
  if (!(Object.values(STAGING_PROJECTS) as string[]).includes(name)) fail(`Vercel project ${name} is not a Staging project: refused.`)
  if ((Object.values(PRODUCTION_PROJECTS) as string[]).includes(name) || LEGACY_PROJECTS.includes(name)) fail(`Vercel project ${name} is Production or legacy: refused.`)
  return name
}

export const neonConfig = {
  project: process.env.GERARD_STAGING_NEON_PROJECT || 'lucky-wildflower-15424624',
  // Staging branches are CHILD branches of their own Production branch (no root branch is created). A child starts with
  // the parent's data and the parent's owner password: setup resets that password on the child through Neon's official
  // branch-scoped reset, then sanitizes the data
  // (scripts/staging/database.ts) before any Staging project receives its URL.
  parents: { gerard: 'br-patient-wildflower-zarmyqcq', novotralux: 'br-cool-sea-zaufb5ng' } as Record<App, string>,
  productionBranches: ['br-patient-wildflower-zarmyqcq', 'br-cool-sea-zaufb5ng'],
  previewBranches: ['br-still-field-za5dh59a'],
  branches: { gerard: 'gerard-staging', novotralux: 'novotralux-custom-staging' } as Record<App, string>,
  database: 'neondb',
}

export const CONFIGURATION_PATH = '/api/internal/platform/configuration'
export const QA_ACCOUNTS: Record<App, string> = { gerard: 'gerard.staging.superadmin', novotralux: 'novotralux.staging.admin' }
// The runtime reads DATABASE_URL; the Novotralux build wrapper reads NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL.
export const DATABASE_VARIABLES: Record<App, string[]> = { gerard: ['DATABASE_URL'], novotralux: ['DATABASE_URL', 'NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL'] }
// Names that must never reach Staging: other environments' databases, real integrations, paid APIs.
export const FORBIDDEN_STAGING_VARIABLES = /^(NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL|NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL|LEGACY_.*|BLOB_READ_WRITE_TOKEN|OPENAI_API_KEY|GOOGLE_MAPS_API_KEY|CRON_SECRET|.*(SMTP|IMAP|MAIL|WEBHOOK|SL_AUTOMOTIVE|SLAUTOMOTIVE).*)$/
export const fingerprint = (value: string) => createHash('sha256').update(`gerard-staging:${value}`).digest('hex').slice(0, 16)

// ─── Output ──────────────────────────────────────────────────────────────────────────────────────────────────
export const log = (message: string) => console.log(redact(message))
export class OperatorError extends Error {}
export const fail = (message: string): never => { throw new OperatorError(message) }

export function flags() {
  const args = process.argv.slice(2)
  return { has: (name: string) => args.includes(name), positional: args.filter((item) => !item.startsWith('--')) }
}

export async function main(run: () => Promise<number | void>) {
  try {
    process.exitCode = (await run()) ?? 0
  } catch (error) {
    console.error(redact(`\n✖ ${error instanceof Error ? error.message : String(error)}`))
    process.exitCode = 1
  }
}

// ─── Child processes (output redacted) ─────────────────────────────────────────────────────────────────────────────
// Every child runs WITHOUT a shell: each argument reaches the program as exactly one argv item on every platform (a value
// such as `npm run build` or a path with spaces is never re-split). Windows cannot start `npx.cmd` without a shell, so
// `npx` is run as npm's own `npx-cli.js` with this Node binary.
type Cli = { command: string; prefix: string[] }
function npxCli() {
  const candidates = [
    process.env.npm_execpath && path.join(path.dirname(process.env.npm_execpath), 'npx-cli.js'),
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ].filter(Boolean) as string[]
  return candidates.find((file) => existsSync(file)) ?? fail('npx was not found next to this Node installation (run the command through npm run …).')
}
// A CLI can be overridden for tests (GERARD_STAGING_VERCEL_CLI / GERARD_STAGING_NEONCTL): a JSON argv array such as
// ["node","/path with spaces/fake.mjs"], or a space-separated string without spaces inside items.
const cli = (override: string | undefined, fallback: string[]): Cli => {
  const parts = override ? (override.trim().startsWith('[') ? JSON.parse(override) as string[] : override.split(' ').filter(Boolean)) : fallback
  return { command: parts[0], prefix: parts.slice(1) }
}
export const VERCEL_CLI = cli(process.env.GERARD_STAGING_VERCEL_CLI, ['npx', '--yes', 'vercel@latest'])
export const NEONCTL = cli(process.env.GERARD_STAGING_NEONCTL, ['npx', '--yes', 'neonctl@latest'])
// `node` and `npx` resolve to this Node binary / npm's npx-cli.js; any other command (git) is spawned as is.
export function resolveCommand(command: string, args: string[]): [string, string[]] {
  if (command === 'npx') return [process.execPath, [npxCli(), ...args]]
  if (command === 'node') return [process.execPath, args]
  return [command, args]
}

type RunOptions = { quiet?: boolean; interactive?: boolean; input?: string; env?: Record<string, string | undefined>; replaceEnv?: boolean; cwd?: string }
export function run(command: string, args: string[], options: RunOptions = {}) {
  return new Promise<{ code: number; stdout: string; output: string }>((resolve) => {
    const env = options.replaceEnv ? options.env : { ...process.env, ...options.env }
    let resolved: [string, string[]]
    try { resolved = resolveCommand(command, args) } catch (error) { resolve({ code: 127, stdout: '', output: (error as Error).message }); return }
    const child = spawn(resolved[0], resolved[1], { env: env as NodeJS.ProcessEnv, cwd: options.cwd, shell: false, windowsHide: true, stdio: options.interactive ? 'inherit' : [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => { const text = chunk.toString(); stdout += text; output += text; if (!options.quiet) process.stdout.write(redact(text)) })
    child.stderr?.on('data', (chunk: Buffer) => { const text = chunk.toString(); output += text; if (!options.quiet) process.stderr.write(redact(text)) })
    if (options.input !== undefined) { child.stdin?.on('error', () => undefined); child.stdin?.write(options.input); child.stdin?.end() }
    child.on('error', (error) => resolve({ code: 127, stdout, output: `${output}${error.message}` }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, output }))
  })
}
export const runCli = (tool: Cli, args: string[], options: RunOptions = {}) => run(tool.command, [...tool.prefix, ...args], options)

// ─── Vercel CLI ─────────────────────────────────────────────────────────────────────────────────────────────────
const lastLines = (text: string) => redact(text.trim().split('\n').slice(-3).join(' ')).slice(0, 300)
// Vercel CLI 60 commands used here that can ask for confirmation: they always get `--yes` (after `vercel login` the
// tooling never prompts). `project ls`, `project add`, `api` (GET) and `env run` take no confirmation flag.
export const CONFIRMING_COMMANDS = ['project update', 'project inspect', 'env add', 'deploy']
export function nonInteractive(args: string[]) {
  const command = args[0] === 'deploy' ? 'deploy' : `${args[0]} ${args[1]}`
  return CONFIRMING_COMMANDS.includes(command) && !args.includes('--yes') ? [...args, '--yes'] : args
}
export async function vercel(args: string[], options: RunOptions = {}) {
  const result = await runCli(VERCEL_CLI, [...nonInteractive(args), '--scope', SCOPE], { quiet: true, ...options })
  if (result.code !== 0) fail(`vercel ${args.slice(0, 2).join(' ')} failed: ${lastLines(result.output)}`)
  return result.stdout
}
const parseJson = (text: string, what: string) => {
  const start = text.search(/[[{]/)
  try { return JSON.parse(text.slice(start)) } catch { return fail(`${what}: unexpected CLI output`) }
}

export type ProjectSettings = { id: string; name: string; framework: string | null; buildCommand: string | null; installCommand: string | null; outputDirectory: string | null; rootDirectory: string | null; nodeVersion: string | null }
export const vercelCli = {
  // Every project of the scope (names and ids); fails when the scope is not reachable with this login.
  projects: async () => ((parseJson(await vercel(['project', 'ls', '--json', '--limit', '100']), 'project ls').projects ?? []) as { name: string; id: string; latestProductionUrl?: string }[]),
  addProject: (name: string) => vercel(['project', 'add', assertStagingProject(name)]),
  inspect: async (name: string) => parseJson(await vercel(['project', 'inspect', name, '--format', 'json']), 'project inspect') as ProjectSettings,
  updateSettings: (name: string, flagsList: string[]) => vercel(['project', 'update', assertStagingProject(name), ...flagsList]),
  // Read-only API reads through the CLI session (team id for deployments, project domains for the stable URL).
  api: async (endpoint: string) => parseJson(await vercel(['api', `${endpoint}${endpoint.includes('?') ? '&' : '?'}slug=${SCOPE}`]), `api ${endpoint}`),
  // The value goes through stdin, never through the command line. Staging projects only, Vercel "production" scope.
  setEnv: (project: string, key: string, value: string) => vercel(['env', 'add', key, 'production', '--project', assertStagingProject(project), '--force', '--type', 'config'], { input: value }),
}

// Stable production host of a project: `<name>.vercel.app` when Vercel assigned it, else its first production
// *.vercel.app domain. Deployment-specific URLs are never used.
export async function stableHost(project: string) {
  const domains = ((await vercelCli.api(`/v9/projects/${project}/domains`)).domains ?? []) as { name: string; gitBranch?: string | null; redirect?: string | null }[]
  const production = domains.filter((item) => !item.gitBranch && !item.redirect).map((item) => item.name.toLowerCase())
  return production.find((name) => name === `${project}.vercel.app`) ?? production.find((name) => name.endsWith('.vercel.app')) ?? production[0]
}

// Runs the probe inside `vercel env run` for one Staging project: the project's variables reach only that child
// process, which reports facts (names, booleans, fingerprints, statuses) and never values.
const BASE_ENV = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'npm_config_cache', 'GERARD_STAGING_VERCEL_CLI', 'GERARD_STAGING_NEONCTL', 'FAKE_STAGING_STATE']
export type ProbeFacts = {
  keys: string[]
  environment: string | null
  routesCap: string | null
  secrets: Record<string, { present: boolean; fingerprint: string | null }>
  values: Record<string, string | null>
  productionHostKeys: string[]
  database?: { variables: Record<string, string | null>; productionEndpoint: boolean; reachable: boolean; migrations?: { applied: number; failed: number }; account?: { exists: boolean; active: boolean; platformRole: string | null; organizationRole: string | null }; integrationsEnabled?: number }
  channel?: Record<string, { status: number; organizationId?: string | null; usernames?: string[] }>
}
// Runs one of this repository's scripts inside `vercel env run -e production --project <Staging project>`: the project's
// variables exist only in that child process, which prints one marked line of facts (never values).
export async function envRun(project: string, script: string, args: string[], extraEnv: Record<string, string>, marker: string) {
  const env = Object.fromEntries(BASE_ENV.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]))
  const tsx = path.join('node_modules', 'tsx', 'dist', 'cli.mjs')
  const result = await runCli(VERCEL_CLI, ['env', 'run', '-e', 'production', '--project', assertStagingProject(project), '--scope', SCOPE, '--', 'node', tsx, script, ...args], {
    quiet: true, replaceEnv: true, env: { ...env, ...extraEnv, GERARD_PROBE_BASELINE: [...Object.keys(env), ...Object.keys(extraEnv)].join(',') },
  })
  const line = result.stdout.split('\n').find((item) => item.startsWith(marker))
  if (result.code !== 0 || !line) fail(`${project}: could not run with its Staging variables (${lastLines(result.output)})`)
  return line!.slice(marker.length)
}
export async function probe(project: string, mode: 'facts' | 'full', app: App) {
  return JSON.parse(await envRun(project, 'scripts/staging/probe.ts', [mode, app], {}, 'GERARD_PROBE ')) as ProbeFacts
}

// ─── Authentication ───────────────────────────────────────────────────────────────────────────────────────────
async function ensureLogin(name: string, tool: Cli, probeArgs: string[], login: string[], interactive: boolean) {
  if ((await runCli(tool, probeArgs, { quiet: true })).code === 0) return
  if (!interactive) fail(`${name} is not authenticated: run \`${[tool.command, ...tool.prefix, ...login].join(' ')}\` in your terminal, then retry.`)
  log(`${name} is not authenticated: opening its interactive login…`)
  if ((await runCli(tool, login, { interactive: true })).code !== 0 || (await runCli(tool, probeArgs, { quiet: true })).code !== 0) fail(`${name} login did not complete.`)
}
export async function authenticate(options: { interactive: boolean }) {
  await ensureLogin('Vercel CLI', VERCEL_CLI, ['whoami'], ['login'], options.interactive)
  await ensureLogin('Neon CLI', NEONCTL, ['me', '--output', 'json'], ['auth'], options.interactive)
}

// Resolves the canonical projects of the scope. Production projects are only looked at, to refuse any overlap.
export async function resolveProjects() {
  const projects = await vercelCli.projects()
  const byName = (name: string) => projects.find((item) => item.name === name)
  const production = Object.fromEntries(APPS.map((app) => [app, byName(PRODUCTION_PROJECTS[app])])) as Record<App, { id: string } | undefined>
  const staging = Object.fromEntries(APPS.map((app) => [app, byName(STAGING_PROJECTS[app])])) as Record<App, { id: string; name: string } | undefined>
  const reserved = new Set([...APPS.map((app) => production[app]?.id), ...LEGACY_PROJECTS.map((name) => byName(name)?.id)].filter(Boolean))
  for (const app of APPS) if (staging[app] && reserved.has(staging[app]!.id)) fail(`${STAGING_PROJECTS[app]} resolves to a Production or legacy project: refused.`)
  return { projects, production, staging }
}

// ─── Neon (neonctl) ─────────────────────────────────────────────────────────────────────────────────────────────
export type NeonBranch = { id: string; name: string; parent_id?: string; default?: boolean; primary?: boolean }

async function neonctl(args: string[], options: { projectId?: boolean } = {}) {
  const result = await runCli(NEONCTL, options.projectId === false ? args : [...args, '--project-id', neonConfig.project], { quiet: true })
  if (result.code !== 0) fail(`neonctl ${args.slice(0, 2).join(' ')} failed: ${lastLines(result.output)}`)
  return result.stdout.trim()
}
const neonJson = (text: string) => { try { return JSON.parse(text) } catch { return fail('neonctl returned unexpected output') } }
const list = (value: any, key: string) => (Array.isArray(value) ? value : value?.[key] ?? [])

export const neon = {
  branches: async () => list(neonJson(await neonctl(['branches', 'list', '--output', 'json'])), 'branches') as NeonBranch[],
  // A child of the given Production branch (copy-on-write; the parent is only read). Never a root branch.
  createChildBranch: async (name: string, parent: string) => { const value = neonJson(await neonctl(['branches', 'create', '--name', name, '--parent', parent, '--no-secrets', '--output', 'json'])); return (value.branch ?? value) as NeonBranch },
  databaseOwner: async (branch: NeonBranch) => (list(neonJson(await neonctl(['databases', 'list', '--branch', branch.id, '--output', 'json'])), 'databases') as { name: string; owner_name: string }[]).find((item) => item.name === neonConfig.database)?.owner_name,
  // Neon's official, branch-scoped password reset (POST …/branches/{branch}/roles/{role}/reset_password) through the Neon
  // CLI session, then waits for Neon's operations. Refused for anything that is not a Staging child branch.
  resetRolePassword: async (branch: NeonBranch, role: string) => {
    if (neonConfig.productionBranches.includes(branch.id) || neonConfig.previewBranches.includes(branch.id) || !Object.values(neonConfig.parents).includes(branch.parent_id ?? '')) fail(`password reset refused on ${branch.name}: not a Staging child branch`)
    const response = neonJson(await neonctl(['api', `/projects/${neonConfig.project}/branches/${branch.id}/roles/${encodeURIComponent(role)}/reset_password`, '-X', 'POST'], { projectId: false }))
    for (const operation of (response.operations ?? []) as { id: string }[]) {
      for (let attempt = 0; ; attempt++) {
        const status = neonJson(await neonctl(['api', `/projects/${neonConfig.project}/operations/${operation.id}`], { projectId: false })).operation?.status
        if (status === 'finished' || status === 'skipped') break
        if (status === 'failed' || status === 'error' || attempt > 90) fail(`Neon password reset on ${branch.name} did not complete (${status ?? 'unknown'})`)
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }
  },
  // The branch's current credential as Neon records it (official connection string). In memory only, never displayed.
  connectionString: (branch: NeonBranch, role: string) => neonctl(['connection-string', branch.id, '--database-name', neonConfig.database, '--role-name', role]).then((value) => value.split('\n').filter((line) => /^postgres(ql)?:\/\//.test(line.trim())).pop()?.trim() || fail('neonctl returned no connection string')),
}

export const isProductionOrPreviewEndpoint = (endpoint: string) => PRODUCTION_DATABASE_ENDPOINTS.includes(endpoint) || PREVIEW_DATABASE_ENDPOINTS.includes(endpoint)
export const databaseEndpoint = (url: string) => databaseEndpointId(url) as string

// A Staging branch must be a child of its own Production branch and must not be (or be served by) Production/Preview.
export function assertStagingBranch(app: App, branch: NeonBranch) {
  if (branch.default || branch.primary || neonConfig.productionBranches.includes(branch.id) || neonConfig.previewBranches.includes(branch.id)) fail(`Neon branch ${branch.name} is a Production/Preview branch: refused.`)
  if (branch.parent_id !== neonConfig.parents[app]) fail(`Neon branch ${branch.name} is not a child of ${neonConfig.parents[app]} (parent ${branch.parent_id ?? 'none'}): refused. Rename or remove it in Neon, then rerun.`)
  return branch
}

// Resolves an existing Staging branch: its inherited owner role, its current official connection string and endpoint.
export async function stagingDatabase(app: App, branches: NeonBranch[]) {
  const found = branches.find((item) => item.name === neonConfig.branches[app])
  if (!found) return undefined
  const branch = assertStagingBranch(app, found)
  const owner = await neon.databaseOwner(branch) ?? fail(`Neon branch ${branch.name} has no ${neonConfig.database} database`)
  const url = await neon.connectionString(branch, owner)
  assertDatabaseForEnvironment('staging', url)
  return { branch, owner, url, endpoint: databaseEndpoint(url) }
}

// The Production parent's own credential, read (never changed) to prove the parent is untouched and distinct.
export async function parentDatabase(app: App, branches: NeonBranch[]) {
  const parent = branches.find((item) => item.id === neonConfig.parents[app]) ?? fail(`Production branch ${neonConfig.parents[app]} not found`)
  const owner = await neon.databaseOwner(parent) ?? fail(`Production branch ${parent.id} has no ${neonConfig.database} database`)
  const url = await neon.connectionString(parent, owner)
  return { parent, owner, url, endpoint: databaseEndpoint(url) }
}
