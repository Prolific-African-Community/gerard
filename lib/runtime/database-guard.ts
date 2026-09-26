import { resolveDeploymentEnvironment } from '@prolific/gerard-core'

// Single list of documented Production database endpoints, shared with the Custom build wrapper.
import { assertProductionDatabase, resolveApplicationId } from '../../apps/novotralux/scripts/database-target.mjs'

// Local development works against the real application databases, so it is not constrained here. A Production runtime
// is: it may open only the database documented for its own application, and fails closed when it cannot tell which
// environment it is (docs/ENVIRONMENT_ARCHITECTURE.md).
export function assertRuntimeDatabase(connectionString: string, env: NodeJS.ProcessEnv = process.env) {
  if (resolveDeploymentEnvironment(env) !== 'production') return
  assertProductionDatabase(resolveApplicationId(env), connectionString)
}
