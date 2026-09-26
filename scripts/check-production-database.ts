import { resolveDeploymentEnvironment } from '@prolific/gerard-core'

import { assertProductionDatabase, resolveApplicationId } from '../apps/novotralux/scripts/database-target.mjs'

// Runs on every build and is a no-op outside Production. Static identity check, no connection: a Production build whose
// DATABASE_URL is not the documented database of that application fails here, before anything is deployed.
const environment = resolveDeploymentEnvironment(process.env)
if (environment !== 'production') {
  console.log(`check-production-database: skipped (${environment})`)
  process.exit(0)
}
const application = resolveApplicationId(process.env)
if (!process.env.DATABASE_URL) throw new Error('PRODUCTION_DATABASE_URL_REQUIRED')
assertProductionDatabase(application, process.env.DATABASE_URL)
console.log(`check-production-database: ${application} production database identity verified`)
