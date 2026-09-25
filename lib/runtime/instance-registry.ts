import { GERARD_CORE_VERSION, checkCoreCompatibility, type GerardInstanceRegistryEntry } from '@prolific/gerard-core'

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

function isPreviewRuntime(env: NodeJS.ProcessEnv) {
  return env.VERCEL_ENV === 'preview' || env.GERARD_INSTANCE_ENVIRONMENT === 'preview' || env.GERARD_INSTANCE_ENVIRONMENT === 'staging'
}

function previewConfigurationEndpoint(instance: GerardInstanceRegistryEntry, env: NodeJS.ProcessEnv) {
  const key = `GERARD_PLATFORM_INSTANCE_${instance.application.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PREVIEW_CONFIGURATION_ENDPOINT`
  const value = env[key]
  if (!value) return undefined
  try {
    const endpoint = new URL(value)
    if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/api/internal/platform/configuration') return undefined
    return endpoint.toString()
  } catch {
    return undefined
  }
}

function resolveRuntimeInstance(instance: GerardInstanceRegistryEntry, env: NodeJS.ProcessEnv = process.env): GerardInstanceRegistryEntry {
  if (instance.applicationType !== 'CUSTOM' || !isPreviewRuntime(env)) return instance
  // Preview must fail closed rather than send signed configuration commands to Production.
  return { ...instance, configurationEndpoint: previewConfigurationEndpoint(instance, env) }
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
