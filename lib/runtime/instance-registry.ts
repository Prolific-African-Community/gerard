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

export function listRegisteredGerardInstances() {
  return registeredInstances.map((instance) => {
    const publicUrl = instance.domain ? `https://${instance.domain}` : null
    return { ...instance, publicUrl, adminUrl: publicUrl ? `${publicUrl}/admin/organization` : null }
  })
}

export function getRegisteredGerardInstance(application: string) {
  return listRegisteredGerardInstances().find((instance) => instance.application === application) ?? null
}
