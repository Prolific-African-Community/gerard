export const deploymentEnvironments = ['production', 'development'] as const
export type DeploymentEnvironment = (typeof deploymentEnvironments)[number]

// Gerard has exactly two environments: LOCAL DEVELOPMENT and PRODUCTION (docs/ENVIRONMENT_ARCHITECTURE.md).
// Production is Vercel Production and nothing else; everything else — including a local `next build` — is development.
// `GERARD_INSTANCE_ENVIRONMENT` stays as the explicit declaration for local maintenance against Production, and must
// agree with Vercel. Any contradiction or unknown value throws: an ambiguous runtime must not guess which database it
// may reach. apps/novotralux/scripts/database-target.mjs mirrors this for the build wrapper (parity is tested).
export function resolveDeploymentEnvironment(env: Record<string, string | undefined>): DeploymentEnvironment {
  const declared = env.GERARD_INSTANCE_ENVIRONMENT?.trim().toLowerCase() || undefined
  if (declared && !(deploymentEnvironments as readonly string[]).includes(declared)) throw new Error('DEPLOYMENT_ENVIRONMENT_UNKNOWN')
  const vercel = env.VERCEL_ENV?.trim().toLowerCase() || undefined
  if (vercel === 'production') {
    if (declared && declared !== 'production') throw new Error('DEPLOYMENT_ENVIRONMENT_CONFLICT')
    return 'production'
  }
  if (vercel && vercel !== 'development') throw new Error('DEPLOYMENT_ENVIRONMENT_UNKNOWN')
  return (declared as DeploymentEnvironment | undefined) ?? 'development'
}
