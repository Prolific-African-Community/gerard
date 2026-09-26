import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { PRODUCTION_DATABASE_ENDPOINTS, PREVIEW_DATABASE_ENDPOINTS, assertDatabaseForEnvironment, databaseEndpointId } from '../../apps/novotralux/scripts/database-target.mjs'
import { redact } from './redact'

export { redact }

// Shared plumbing of the Staging operator commands (docs/CUSTOM_STAGING_WORKFLOW.md), run from the operator's machine:
// Vercel through `vercel login` + its REST API, Neon through `neonctl`. Nothing here prints a token, a secret value or a
// database URL, and the only Vercel scope ever written is the `staging` custom environment.

export type App = 'gerard' | 'novotralux'
export const APPS: App[] = ['gerard', 'novotralux']
export const LABEL: Record<App, string> = { gerard: 'Gerard Staging', novotralux: 'Novotralux Staging' }

const env = process.env
export const config = {
  vercel: {
    team: env.GERARD_STAGING_VERCEL_TEAM || '',
    environment: 'staging',
    projects: { gerard: env.GERARD_STAGING_VERCEL_PROJECT_GERARD || 'gerard-dispatch', novotralux: env.GERARD_STAGING_VERCEL_PROJECT_NOVOTRALUX || 'novotralux-custom' } as Record<App, string>,
  },
  neon: {
    project: env.GERARD_STAGING_NEON_PROJECT || 'lucky-wildflower-15424624',
    // Staging branches start schema-only from the Standard Production root branch (no row copied); setup then rebuilds
    // the schema from this repository's migrations.
    parentBranch: env.GERARD_STAGING_NEON_PARENT_BRANCH || 'br-patient-wildflower-zarmyqcq',
    productionBranches: ['br-patient-wildflower-zarmyqcq', 'br-cool-sea-zaufb5ng'],
    previewBranches: ['br-still-field-za5dh59a'],
    branches: { gerard: 'gerard-staging', novotralux: 'novotralux-custom-staging' } as Record<App, string>,
    database: 'neondb',
  },
  domains: { gerard: env.GERARD_STAGING_DOMAIN_GERARD || 'gerard-dispatch-staging.vercel.app', novotralux: env.GERARD_STAGING_DOMAIN_NOVOTRALUX || 'novotralux-custom-staging.vercel.app' } as Record<App, string>,
  // Hosts serving Production; no Staging value may point at them.
  productionHosts: ['gerard-dispatch.vercel.app', 'novotralux-custom.vercel.app', 'www.novotralux.eu', 'novotralux.eu'],
  vercelApi: env.GERARD_STAGING_VERCEL_API || 'https://api.vercel.com',
}

export const CONFIGURATION_PATH = '/api/internal/platform/configuration'
export const stagingEndpoint = () => `https://${config.domains.novotralux}${CONFIGURATION_PATH}`
export const QA_ACCOUNTS: Record<App, string> = { gerard: 'gerard.staging.superadmin', novotralux: 'novotralux.staging.admin' }
export const DATABASE_VARIABLE: Record<App, string> = { gerard: 'DATABASE_URL', novotralux: 'NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL' }
// Names that must never reach Staging: other environments' databases, real integrations, paid APIs.
export const FORBIDDEN_STAGING_VARIABLES = /^(NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL|NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL|LEGACY_.*|BLOB_READ_WRITE_TOKEN|OPENAI_API_KEY|GOOGLE_MAPS_API_KEY|CRON_SECRET|.*(SMTP|IMAP|MAIL|WEBHOOK|SL_AUTOMOTIVE|SLAUTOMOTIVE).*)$/

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
export const VERCEL_CLI = cli(env.GERARD_STAGING_VERCEL_CLI, ['npx', '--yes', 'vercel@latest'])
export const NEONCTL = cli(env.GERARD_STAGING_NEONCTL, ['npx', '--yes', 'neonctl@latest'])

export function run(command: string, args: string[], extraEnv: Record<string, string | undefined> = {}, options: { quiet?: boolean; interactive?: boolean } = {}) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    const windows = process.platform === 'win32'
    const child = spawn(command, args, { env: { ...process.env, ...extraEnv }, shell: windows, stdio: options.interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const forward = (chunk: Buffer) => { const text = chunk.toString(); output += text; if (!options.quiet) process.stdout.write(redact(text)) }
    child.stdout?.on('data', forward)
    child.stderr?.on('data', forward)
    child.on('error', () => resolve({ code: 127, output }))
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}
export const runCli = (tool: Cli, args: string[], extraEnv: Record<string, string | undefined> = {}, options: { quiet?: boolean; interactive?: boolean } = {}) => run(tool.command, [...tool.prefix, ...args], extraEnv, options)

// ─── Authentication ───────────────────────────────────────────────────────────────────────────────────────────
// Asks the operator to log in interactively when a CLI is not authenticated; never asks for a token in a prompt.
async function ensureLogin(name: string, tool: Cli, probe: string[], login: string[], interactive: boolean) {
  if ((await runCli(tool, probe, {}, { quiet: true })).code === 0) return
  if (!interactive) fail(`${name} is not authenticated: run \`${[tool.command, ...tool.prefix, ...login].join(' ')}\` in your terminal, then retry.`)
  log(`${name} is not authenticated: opening its interactive login…`)
  if ((await runCli(tool, login, {}, { interactive: true })).code !== 0 || (await runCli(tool, probe, {}, { quiet: true })).code !== 0) fail(`${name} login did not complete.`)
}

export async function authenticate(options: { interactive: boolean }) {
  await ensureLogin('Vercel CLI', VERCEL_CLI, ['whoami'], ['login'], options.interactive)
  await ensureLogin('Neon CLI', NEONCTL, ['me', '--output', 'json'], ['auth'], options.interactive)
  return vercelToken()
}

// The REST calls reuse the token `vercel login` stored (or VERCEL_TOKEN when set in the shell); it is never printed.
function readJson(file: string) { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return undefined } }
export function vercelToken() {
  if (env.VERCEL_TOKEN) return env.VERCEL_TOKEN
  const home = homedir()
  const files = [
    [env.XDG_DATA_HOME, 'com.vercel.cli'], [home, '.local', 'share', 'com.vercel.cli'], [home, 'Library', 'Application Support', 'com.vercel.cli'],
    [env.APPDATA, 'xdg.data', 'com.vercel.cli'], [env.LOCALAPPDATA, 'xdg.data', 'com.vercel.cli'], [env.APPDATA, 'com.vercel.cli', 'Data'], [env.LOCALAPPDATA, 'com.vercel.cli', 'Data'], [home, '.vercel'],
  ].filter((parts) => parts.every(Boolean)).map((parts) => path.join(...(parts as string[]), 'auth.json'))
  for (const file of files) {
    const token = existsSync(file) ? readJson(file)?.token : undefined
    if (typeof token === 'string' && token) return token
  }
  return fail('Vercel CLI is logged in but its credentials file was not found; set VERCEL_TOKEN in this shell (vercel.com/account/tokens) and retry.')
}

// ─── Vercel REST ────────────────────────────────────────────────────────────────────────────────────────────────
export type VercelEnv = { id: string; key: string; type: string; target?: string[] | string; customEnvironmentIds?: string[]; gitBranch?: string | null }
export type VercelProject = { id: string; name: string; accountId: string; protectionBypass?: Record<string, { scope?: string }> }
export type VercelDomain = { name: string; customEnvironmentId?: string | null; gitBranch?: string | null }

export function vercelClient(token: string, options: { readOnly?: boolean } = {}) {
  let teamId: string | undefined
  async function call(method: string, route: string, body?: unknown) {
    if (options.readOnly && method !== 'GET') fail(`read-only command attempted ${method} ${route}`)
    const url = new URL(`${config.vercelApi}${route}`)
    if (teamId) url.searchParams.set('teamId', teamId)
    const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) fail(`Vercel ${method} ${route.replace(/\?.*/, '')} → ${response.status} ${json?.error?.code ?? ''} ${redact(String(json?.error?.message ?? '')).slice(0, 200)}`.trim())
    return json
  }
  const client = {
    get teamId() { return teamId },
    // Finds the scope (team or personal account) holding both projects, unless GERARD_STAGING_VERCEL_TEAM names it.
    async resolveScope() {
      const teams = ((await call('GET', '/v2/teams')).teams ?? []) as { id: string; slug: string }[]
      const scopes = config.vercel.team ? teams.filter((team) => team.id === config.vercel.team || team.slug === config.vercel.team) : [...teams, undefined]
      if (config.vercel.team && !scopes.length) fail(`Vercel team ${config.vercel.team} is not visible to this login.`)
      for (const scope of scopes) {
        teamId = scope?.id
        const found = await Promise.all(APPS.map((app) => client.project(config.vercel.projects[app]).catch(() => null)))
        if (found.every(Boolean)) return { scope: scope?.slug ?? 'personal account', projects: Object.fromEntries(APPS.map((app, index) => [app, found[index]])) as Record<App, VercelProject> }
      }
      teamId = undefined
      return fail(`Vercel projects ${Object.values(config.vercel.projects).join(' + ')} not found together (scopes: ${teams.map((team) => team.slug).join(', ') || 'personal'}). Set GERARD_STAGING_VERCEL_TEAM / GERARD_STAGING_VERCEL_PROJECT_GERARD / GERARD_STAGING_VERCEL_PROJECT_NOVOTRALUX.`)
    },
    project: (name: string) => call('GET', `/v9/projects/${encodeURIComponent(name)}`) as Promise<VercelProject>,
    customEnvironments: (projectId: string) => call('GET', `/v9/projects/${projectId}/custom-environments`).then((json) => (json.environments ?? []) as { id: string; slug: string; type?: string }[]),
    createCustomEnvironment: (projectId: string) => call('POST', `/v9/projects/${projectId}/custom-environments`, { slug: config.vercel.environment, description: 'Permanent Staging (npm run staging:setup)' }) as Promise<{ id: string; slug: string; type?: string }>,
    envs: (projectId: string) => call('GET', `/v10/projects/${projectId}/env`).then((json) => (json.envs ?? []) as VercelEnv[]),
    // Decrypted in memory only, to compare or sign; never printed or written to disk.
    decrypt: (projectId: string, envId: string) => call('GET', `/v1/projects/${projectId}/env/${envId}`).then((json) => String(json.value ?? '')),
    createEnv: (projectId: string, stagingId: string, key: string, value: string) => call('POST', `/v10/projects/${projectId}/env`, { key, value, type: 'encrypted', customEnvironmentIds: [stagingId] }),
    updateEnv: (projectId: string, envId: string, value: string) => call('PATCH', `/v9/projects/${projectId}/env/${envId}`, { value }),
    domains: (projectId: string) => call('GET', `/v9/projects/${projectId}/domains`).then((json) => (json.domains ?? []) as VercelDomain[]),
    addDomain: (projectId: string, name: string, stagingId: string) => call('POST', `/v10/projects/${projectId}/domains`, { name, customEnvironmentId: stagingId }),
    generateBypass: (projectId: string) => call('PATCH', `/v1/projects/${projectId}/protection-bypass`, { generate: { note: 'Gerard Staging readiness checks' } }),
  }
  return client
}
export type VercelClient = ReturnType<typeof vercelClient>

export async function stagingEnvironment(vercel: VercelClient, project: VercelProject) {
  const found = (await vercel.customEnvironments(project.id)).find((item) => item.slug === config.vercel.environment)
  if (found?.type === 'production') fail(`${project.name}: the "staging" environment is a Production environment: refused.`)
  return found
}

export const automationBypass = (project: VercelProject) => Object.entries(project.protectionBypass ?? {}).find(([, value]) => value?.scope === 'automation-bypass')?.[0]
export const targetsOf = (item: VercelEnv) => (Array.isArray(item.target) ? item.target : item.target ? [item.target] : [])
export const appliesTo = (item: VercelEnv, stagingId: string) => (item.customEnvironmentIds ?? []).includes(stagingId)
// A variable is Staging-owned only when scoped to the staging custom environment and to nothing else.
export const stagingOnly = (item: VercelEnv, stagingId: string) => appliesTo(item, stagingId) && !targetsOf(item).length && (item.customEnvironmentIds ?? []).length === 1 && !item.gitBranch
export const productionDomain = (domain: VercelDomain) => !domain.customEnvironmentId && !domain.gitBranch

// ─── Neon (neonctl) ─────────────────────────────────────────────────────────────────────────────────────────────
export type NeonBranch = { id: string; name: string; parent_id?: string; default?: boolean; primary?: boolean }

async function neonctl(args: string[]) {
  const result = await runCli(NEONCTL, [...args, '--project-id', config.neon.project], {}, { quiet: true })
  if (result.code !== 0) fail(`neonctl ${args.slice(0, 2).join(' ')} failed: ${redact(result.output.trim().split('\n').slice(-3).join(' ')).slice(0, 300)}`)
  return result.output.trim()
}
const json = (text: string) => { try { return JSON.parse(text) } catch { return fail('neonctl returned unexpected output') } }

export const neon = {
  branches: async () => { const value = json(await neonctl(['branches', 'list', '--output', 'json'])); return (Array.isArray(value) ? value : value.branches ?? []) as NeonBranch[] },
  createBranch: async (name: string) => { const value = json(await neonctl(['branches', 'create', '--name', name, '--parent', config.neon.parentBranch, '--schema-only', '--output', 'json'])); return (value.branch ?? value) as NeonBranch },
  databaseOwner: async (branch: NeonBranch) => { const value = json(await neonctl(['databases', 'list', '--branch', branch.id, '--output', 'json'])); return ((Array.isArray(value) ? value : value.databases ?? []) as { name: string; owner_name: string }[]).find((item) => item.name === config.neon.database)?.owner_name },
  // The URL stays in memory: it is handed to Vercel or to a child process environment, never displayed.
  connectionString: (branch: NeonBranch, role: string) => neonctl(['connection-string', branch.id, '--database-name', config.neon.database, '--role-name', role]).then((value) => value.split('\n').filter((line) => /^postgres(ql)?:\/\//.test(line.trim())).pop()?.trim() || fail('neonctl returned no connection string')),
}

// Resolves a Staging branch and its connection strings, refusing anything that is, or is served by, Production or Preview.
export async function stagingDatabase(app: App, branches: NeonBranch[]) {
  const branch = branches.find((item) => item.name === config.neon.branches[app])
  if (!branch) return undefined
  if (branch.default || branch.primary || config.neon.productionBranches.includes(branch.id)) fail(`Neon branch ${branch.name} is a Production branch: refused.`)
  if (config.neon.previewBranches.includes(branch.id)) fail(`Neon branch ${branch.name} is the Preview branch: refused.`)
  const role = await neon.databaseOwner(branch) || fail(`Neon branch ${branch.name} has no ${config.neon.database} database`)
  // Direct (unpooled) connection: every Staging build runs `prisma migrate deploy`, which needs one; Staging traffic is small.
  const direct = await neon.connectionString(branch, role)
  assertDatabaseForEnvironment('staging', direct)
  return { branch, direct, endpoint: databaseEndpointId(direct) as string }
}

export const isProductionOrPreviewEndpoint = (endpoint: string) => PRODUCTION_DATABASE_ENDPOINTS.includes(endpoint) || PREVIEW_DATABASE_ENDPOINTS.includes(endpoint)
export const databaseEndpoint = (url: string) => databaseEndpointId(url) as string
