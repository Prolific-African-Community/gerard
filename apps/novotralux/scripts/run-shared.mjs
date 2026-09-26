import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { resolveNovotraluxDatabaseTarget } from './database-target.mjs'

const command = process.argv[2]
if (!['dev', 'build', 'start'].includes(command)) throw new Error('EXPECTED_DEV_BUILD_OR_START')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
for (const name of ['.env.local', '.env']) {
  try { process.loadEnvFile(path.join(root, name)) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}
const { target, instanceEnvironment } = resolveNovotraluxDatabaseTarget(process.env)

const env = { ...process.env, DATABASE_URL: target, NEXT_PUBLIC_GERARD_APPLICATION: 'novotralux',
  GERARD_APPLICATION_ID: 'novotralux', GERARD_INSTANCE_ORGANIZATION_ID: 'org-novotralux',
  GERARD_INSTANCE_ENVIRONMENT: instanceEnvironment,
  GERARD_BUILD_OUTPUT: process.env.GERARD_BUILD_OUTPUT || '.next-novotralux',
  GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION: process.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION || '0' }
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('NPM_EXEC_PATH_REQUIRED')
const result = spawnSync(process.execPath, [npmCli, 'run', command], { cwd: root, env, stdio: 'inherit' })
process.exit(result.status ?? 1)
