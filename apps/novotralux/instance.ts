import { GERARD_CORE_VERSION, checkCoreCompatibility, type GerardInstanceRegistryEntry } from '@prolific/gerard-core'
import { novotraluxManifest } from './manifest'

const compatibility = checkCoreCompatibility(novotraluxManifest.compatibleCore, GERARD_CORE_VERSION)
if (!compatibility.compatible) throw new Error(`NOVOTRALUX_CORE_INCOMPATIBLE:${compatibility.status}`)

export const novotraluxInstance: GerardInstanceRegistryEntry = {
  client: 'Novotralux', application: 'novotralux', applicationType: 'CUSTOM',
  coreVersion: GERARD_CORE_VERSION, compatibleCore: novotraluxManifest.compatibleCore,
  environment: 'staging', organizationId: 'org-novotralux', domain: null,
  status: 'READY_FOR_CUTOVER', lastCompatibilityStatus: compatibility.status,
}
