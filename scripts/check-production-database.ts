import { resolveDeploymentEnvironment } from '@prolific/gerard-core'

import { assertDatabaseForEnvironment } from '../apps/novotralux/scripts/database-target.mjs'

// Runs on every build and is a no-op outside Production. Static identity check, no connection: a Production build whose
// DATABASE_URL is not a documented Production endpoint fails here, before anything is deployed.
const environment = resolveDeploymentEnvironment(process.env)
if (environment !== 'production') {
  console.log(`check-production-database: skipped (${environment})`)
  process.exit(0)
}
if (!process.env.DATABASE_URL) throw new Error('PRODUCTION_DATABASE_URL_REQUIRED')
assertDatabaseForEnvironment('production', process.env.DATABASE_URL)
console.log('check-production-database: production database identity verified')
