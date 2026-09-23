import { GERARD_CORE_VERSION, checkCoreCompatibility, type GerardInstanceRegistryEntry } from '@prolific/gerard-core'
import { novotraluxManifest } from './manifest'

const compatibility = checkCoreCompatibility(novotraluxManifest.compatibleCore, GERARD_CORE_VERSION)
if (!compatibility.compatible) throw new Error(`NOVOTRALUX_CORE_INCOMPATIBLE:${compatibility.status}`)

export const novotraluxInstance: GerardInstanceRegistryEntry = {
  client: 'Novotralux', application: 'novotralux', applicationType: 'CUSTOM',
  coreVersion: GERARD_CORE_VERSION, compatibleCore: novotraluxManifest.compatibleCore,
  environment: 'production', organizationId: 'org-novotralux', domain: 'www.novotralux.eu',
  status: 'ACTIVE', lastCompatibilityStatus: compatibility.status,
  deploymentReference: 'dpl_7YmfV7zeo5CuzG2q4cyVogLTLn1d',
  cutoverAt: '2026-09-23T15:46:18Z',
}
