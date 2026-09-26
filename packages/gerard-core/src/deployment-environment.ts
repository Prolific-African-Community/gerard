export const deploymentEnvironments = ['production', 'staging', 'preview', 'development'] as const
export type DeploymentEnvironment = (typeof deploymentEnvironments)[number]

// Resolves where this runtime lives. `GERARD_INSTANCE_ENVIRONMENT` is the explicit declaration; Vercel's own variables
// (`VERCEL_ENV`, and `VERCEL_TARGET_ENV` for custom environments such as Staging) must agree with it. Any contradiction
// or unknown value throws: an ambiguous runtime must not guess which databases or instances it may reach.
// apps/novotralux/scripts/database-target.mjs mirrors this for the build wrapper (parity is tested).
export function resolveDeploymentEnvironment(env: Record<string, string | undefined>): DeploymentEnvironment {
  const declared = env.GERARD_INSTANCE_ENVIRONMENT?.trim().toLowerCase() || undefined
  if (declared && !(deploymentEnvironments as readonly string[]).includes(declared)) throw new Error('DEPLOYMENT_ENVIRONMENT_UNKNOWN')
  const vercel = env.VERCEL_ENV?.trim().toLowerCase() || undefined
  const target = env.VERCEL_TARGET_ENV?.trim().toLowerCase() || undefined
  if (vercel === 'production') {
    if (declared && declared !== 'production') throw new Error('DEPLOYMENT_ENVIRONMENT_CONFLICT')
    return 'production'
  }
  if (vercel === 'preview' || vercel === 'staging') {
    if (declared === 'production' || declared === 'development') throw new Error('DEPLOYMENT_ENVIRONMENT_CONFLICT')
    const staging = declared === 'staging' || target === 'staging' || vercel === 'staging'
    if (staging && declared === 'preview') throw new Error('DEPLOYMENT_ENVIRONMENT_CONFLICT')
    return staging ? 'staging' : 'preview'
  }
  if (vercel && vercel !== 'development') throw new Error('DEPLOYMENT_ENVIRONMENT_UNKNOWN')
  return (declared as DeploymentEnvironment | undefined) ?? 'development'
}
