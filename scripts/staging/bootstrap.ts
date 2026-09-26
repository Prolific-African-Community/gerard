import { assertDatabaseForEnvironment } from '../../apps/novotralux/scripts/database-target.mjs'
import { bootstrapDatabase } from './database'
import { databaseEndpoint, redact, type App } from './lib'

// Runs inside `vercel env run -e production --project <staging project>` for a Staging branch whose owner password was
// already rotated: the valid Staging credential exists only in the Staging project's DATABASE_URL, so the bootstrap
// (sanitize if needed → migrations + QA → verification) runs here. Prints one line of facts, never a URL or secret.

const [app, branchId, parentId, expectedEndpoint, hostsList] = process.argv.slice(2) as [App, string, string, string, string]

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) return { problems: ['the Staging project has no DATABASE_URL'] }
  assertDatabaseForEnvironment('staging', url)
  if (databaseEndpoint(url) !== expectedEndpoint) return { problems: ['the Staging project DATABASE_URL is not this Staging branch'] }
  const result = await bootstrapDatabase({ url, app, branch: { id: branchId, name: app, parent_id: parentId }, hosts: hostsList.split(',').filter(Boolean), initialPassword: process.env.GERARD_STAGING_BOOTSTRAP_INITIAL_PASSWORD || undefined })
  return { fresh: result.fresh, sanitized: result.sanitized, superadminCreated: result.superadminCreated, problems: result.problems }
}

main().then((facts) => console.log(`GERARD_BOOTSTRAP ${JSON.stringify(facts)}`), (error) => console.log(`GERARD_BOOTSTRAP ${JSON.stringify({ problems: [error instanceof Error && /28P01|password authentication/.test(String((error as { code?: string }).code ?? error.message)) ? 'the stored Staging credential no longer opens the branch' : `bootstrap failed: ${redact(error instanceof Error ? error.message : String(error)).slice(0, 200)}`] })}`))
