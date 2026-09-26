import { GERARD_CORE_VERSION, checkCoreCompatibility, resolveDeploymentEnvironment, type DeploymentEnvironment, type GerardInstanceRegistryEntry } from '@prolific/gerard-core'

import { novotraluxInstance } from '../../apps/novotralux/instance'
import { gerardStandardManifest } from '../standard/application'

const standardCompatibility = checkCoreCompatibility(gerardStandardManifest.compatibleCore, GERARD_CORE_VERSION)

export const gerardStandardInstance: GerardInstanceRegistryEntry = Object.freeze({
  client: 'Gerard',
  application: gerardStandardManifest.application,
  applicationType: 'STANDARD',
  coreVersion: GERARD_CORE_VERSION,
  compatibleCore: gerardStandardManifest.compatibleCore,
  environment: 'production',
  organizationId: 'org-gerard-default',
  domain: 'gerard-dispatch.vercel.app',
  status: 'ACTIVE',
  lastCompatibilityStatus: standardCompatibility.status,
})

const registeredInstances: readonly GerardInstanceRegistryEntry[] = Object.freeze([
  gerardStandardInstance,
  novotraluxInstance,
])

const instanceKey = (instance: GerardInstanceRegistryEntry, environment: DeploymentEnvironment, suffix: string) =>
  `GERARD_PLATFORM_INSTANCE_${instance.application.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${environment.toUpperCase()}_${suffix}`

// A non-production Platform reaches a Custom instance only through the endpoint declared for its own environment
// (e.g. GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT). Missing, malformed or pointing at the
// Production Custom host: no endpoint, so the channel fails closed.
// Hosts that serve the Production instance: its configuration endpoint and its public domain (with and without www).
export function productionHostsOf(instance: GerardInstanceRegistryEntry) {
  const hosts = new Set<string>()
  if (instance.configurationEndpoint) hosts.add(new URL(instance.configurationEndpoint).host.toLowerCase())
  if (instance.domain) { const domain = instance.domain.toLowerCase(); hosts.add(domain); hosts.add(domain.replace(/^www\./, '')); hosts.add(`www.${domain.replace(/^www\./, '')}`) }
  return hosts
}

function environmentConfigurationEndpoint(instance: GerardInstanceRegistryEntry, environment: DeploymentEnvironment, env: NodeJS.ProcessEnv) {
  const value = env[instanceKey(instance, environment, 'CONFIGURATION_ENDPOINT')]
  if (!value) return undefined
  try {
    const endpoint = new URL(value)
    const local = environment === 'development' && ['localhost', '127.0.0.1'].includes(endpoint.hostname)
    if ((endpoint.protocol !== 'https:' && !local) || endpoint.pathname !== '/api/internal/platform/configuration') return undefined
    if (productionHostsOf(instance).has(endpoint.host.toLowerCase())) return undefined
    return endpoint.toString()
  } catch {
    return undefined
  }
}

function resolveRuntimeInstance(instance: GerardInstanceRegistryEntry, env: NodeJS.ProcessEnv = process.env): GerardInstanceRegistryEntry {
  // Throws on an ambiguous runtime rather than guessing which instances it may command.
  const environment = resolveDeploymentEnvironment(env)
  if (environment === 'production') return instance
  const domain = env[instanceKey(instance, environment, 'DOMAIN')] || instance.domain
  // The deployment reference and cut-over date describe the Production instance only.
  const { deploymentReference: _deployment, cutoverAt: _cutover, ...shared } = instance
  if (instance.applicationType !== 'CUSTOM') return { ...shared, environment, domain }
  return { ...shared, environment, domain, configurationEndpoint: environmentConfigurationEndpoint(instance, environment, env) }
}

export function listRegisteredGerardInstances() {
  return registeredInstances.map((registeredInstance) => {
    const instance = resolveRuntimeInstance(registeredInstance)
    const publicUrl = instance.domain ? `https://${instance.domain}` : null
    return { ...instance, publicUrl, adminUrl: publicUrl ? `${publicUrl}/admin/organization` : null }
  })
}

export function getRegisteredGerardInstance(application: string) {
  return listRegisteredGerardInstances().find((instance) => instance.application === application) ?? null
}
