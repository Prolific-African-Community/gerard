import { GERARD_CORE_VERSION, type GerardApplicationManifest } from '@prolific/gerard-core'

export const manifest: GerardApplicationManifest = {
  application: 'client-example',
  type: 'CUSTOM',
  coreVersion: GERARD_CORE_VERSION,
  compatibleCore: '^1.0.0',
  extensions: ['custom-navigation', 'custom-mission-reference', 'custom-scoring', 'custom-erp'],
}
