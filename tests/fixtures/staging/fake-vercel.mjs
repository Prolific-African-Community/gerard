// Test double of the `vercel` CLI for tests/staging-operator.integration.ts: records deployments instead of uploading.
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.env.FAKE_STAGING_STATE
const state = JSON.parse(readFileSync(file, 'utf8'))
const args = process.argv.slice(2)
if (args[0] === 'whoami') process.exit(state.vercelUnauthenticated ? 1 : 0)
if (args[0] === 'login') process.exit(1)
if (args[0] === 'deploy') {
  state.deploys.push({ args, projectId: process.env.VERCEL_PROJECT_ID, orgId: process.env.VERCEL_ORG_ID, token: Boolean(process.env.VERCEL_TOKEN) })
  writeFileSync(file, JSON.stringify(state, null, 2))
  console.log('Deployment ready (fake)')
  process.exit(0)
}
process.exit(2)
