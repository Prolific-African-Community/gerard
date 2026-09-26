import { resolveDeploymentEnvironment } from '@prolific/gerard-core'

// Single list of documented database endpoints, shared with the Custom build wrapper.
import { assertDatabaseForEnvironment } from '../../apps/novotralux/scripts/database-target.mjs'

// Fails closed when a runtime would open a database belonging to another environment, or cannot tell which
// environment it is. Local maintenance against Production must declare GERARD_INSTANCE_ENVIRONMENT=production.
export function assertRuntimeDatabase(connectionString: string, env: NodeJS.ProcessEnv = process.env) {
  assertDatabaseForEnvironment(resolveDeploymentEnvironment(env), connectionString)
}
