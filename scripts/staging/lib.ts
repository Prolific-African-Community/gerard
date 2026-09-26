import { spawn } from 'node:child_process'
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
  // Staging branches start schema-only from the Standard Production root branch (no row copied); setup then rebuilds the
  // schema from this repository's migrations.
  parentBranch: process.env.GERARD_STAGING_NEON_PARENT_BRANCH || 'br-patient-wildflower-zarmyqcq',
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
// A CLI can be overridden (GERARD_STAGING_VERCEL_CLI / GERARD_STAGING_NEONCTL, e.g. "node fake-cli.mjs") for tests.
type Cli = { command: string; prefix: string[] }
const cli = (override: string | undefined, fallback: string[]): Cli => {
  const parts = override ? override.split(' ').filter(Boolean) : fallback
  return { command: parts[0], prefix: parts.slice(1) }
}
export const VERCEL_CLI = cli(process.env.GERARD_STAGING_VERCEL_CLI, ['npx', '--yes', 'vercel@latest'])
export const NEONCTL = cli(process.env.GERARD_STAGING_NEONCTL, ['npx', '--yes', 'neonctl@latest'])

type RunOptions = { quiet?: boolean; interactive?: boolean; input?: string; env?: Record<string, string | undefined>; replaceEnv?: boolean; cwd?: string }
export function run(command: string, args: string[], options: RunOptions = {}) {
  return new Promise<{ code: number; stdout: string; output: string }>((resolve) => {
    const windows = process.platform === 'win32'
    const env = options.replaceEnv ? options.env : { ...process.env, ...options.env }
    const child = spawn(command, args, { env: env as NodeJS.ProcessEnv, cwd: options.cwd, shell: windows, stdio: options.interactive ? 'inherit' : [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => { const text = chunk.toString(); stdout += text; output += text; if (!options.quiet) process.stdout.write(redact(text)) })
    child.stderr?.on('data', (chunk: Buffer) => { const text = chunk.toString(); output += text; if (!options.quiet) process.stderr.write(redact(text)) })
    if (options.input !== undefined) { child.stdin?.write(options.input); child.stdin?.end() }
    child.on('error', () => resolve({ code: 127, stdout, output }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, output }))
  })
}
export const runCli = (tool: Cli, args: string[], options: RunOptions = {}) => run(tool.command, [...tool.prefix, ...args], options)

// ─── Vercel CLI ─────────────────────────────────────────────────────────────────────────────────────────────────
const lastLines = (text: string) => redact(text.trim().split('\n').slice(-3).join(' ')).slice(0, 300)
export async function vercel(args: string[], options: RunOptions = {}) {
  const result = await runCli(VERCEL_CLI, [...args, '--scope', SCOPE], { quiet: true, ...options })
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
  setEnv: (project: string, key: string, value: string) => vercel(['env', 'add', key, 'production', '--project', assertStagingProject(project), '--force', '--yes', '--type', 'config'], { input: value }),
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
export async function probe(project: string, mode: 'facts' | 'full', app: App) {
  const env = Object.fromEntries(BASE_ENV.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]))
  const tsx = path.join('node_modules', 'tsx', 'dist', 'cli.mjs')
  const result = await runCli(VERCEL_CLI, ['env', 'run', '-e', 'production', '--project', assertStagingProject(project), '--scope', SCOPE, '--', 'node', tsx, 'scripts/staging/probe.ts', mode, app], {
    quiet: true, replaceEnv: true, env: { ...env, GERARD_PROBE_BASELINE: Object.keys(env).join(',') },
  })
  const line = result.stdout.split('\n').find((item) => item.startsWith('GERARD_PROBE '))
  if (result.code !== 0 || !line) fail(`${project}: could not read its Staging variables (${lastLines(result.output)})`)
  return JSON.parse(line!.slice('GERARD_PROBE '.length)) as ProbeFacts
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

async function neonctl(args: string[]) {
  const result = await runCli(NEONCTL, [...args, '--project-id', neonConfig.project], { quiet: true })
  if (result.code !== 0) fail(`neonctl ${args.slice(0, 2).join(' ')} failed: ${lastLines(result.output)}`)
  return result.stdout.trim()
}
const neonJson = (text: string) => { try { return JSON.parse(text) } catch { return fail('neonctl returned unexpected output') } }

export const neon = {
  branches: async () => { const value = neonJson(await neonctl(['branches', 'list', '--output', 'json'])); return (Array.isArray(value) ? value : value.branches ?? []) as NeonBranch[] },
  createBranch: async (name: string) => { const value = neonJson(await neonctl(['branches', 'create', '--name', name, '--parent', neonConfig.parentBranch, '--schema-only', '--no-secrets', '--output', 'json'])); return (value.branch ?? value) as NeonBranch },
  databaseOwner: async (branch: NeonBranch) => { const value = neonJson(await neonctl(['databases', 'list', '--branch', branch.id, '--output', 'json'])); return ((Array.isArray(value) ? value : value.databases ?? []) as { name: string; owner_name: string }[]).find((item) => item.name === neonConfig.database)?.owner_name },
  // The URL stays in memory: handed to Vercel through stdin or to a child environment, never displayed.
  connectionString: (branch: NeonBranch, role: string) => neonctl(['connection-string', branch.id, '--database-name', neonConfig.database, '--role-name', role]).then((value) => value.split('\n').filter((line) => /^postgres(ql)?:\/\//.test(line.trim())).pop()?.trim() || fail('neonctl returned no connection string')),
}

export const isProductionOrPreviewEndpoint = (endpoint: string) => PRODUCTION_DATABASE_ENDPOINTS.includes(endpoint) || PREVIEW_DATABASE_ENDPOINTS.includes(endpoint)
export const databaseEndpoint = (url: string) => databaseEndpointId(url) as string

// Resolves a Staging branch and its direct connection string, refusing anything that is, or is served by, Production
// or Preview. Direct (unpooled): every Staging build runs `prisma migrate deploy`, which needs it.
export async function stagingDatabase(app: App, branches: NeonBranch[]) {
  const branch = branches.find((item) => item.name === neonConfig.branches[app])
  if (!branch) return undefined
  if (branch.default || branch.primary || neonConfig.productionBranches.includes(branch.id)) fail(`Neon branch ${branch.name} is a Production branch: refused.`)
  if (neonConfig.previewBranches.includes(branch.id)) fail(`Neon branch ${branch.name} is the Preview branch: refused.`)
  const role = await neon.databaseOwner(branch) || fail(`Neon branch ${branch.name} has no ${neonConfig.database} database`)
  const direct = await neon.connectionString(branch, role)
  assertDatabaseForEnvironment('staging', direct)
  return { branch, direct, endpoint: databaseEndpoint(direct) }
}
