import { GERARD_CORE_VERSION, defaultGerardApplication, type GerardApplicationManifest } from '@prolific/gerard-core'

export const gerardStandardApplication = defaultGerardApplication
export const gerardStandardManifest: GerardApplicationManifest = {
  application: 'gerard-standard',
  type: 'STANDARD',
  coreVersion: GERARD_CORE_VERSION,
  compatibleCore: '^1.0.0',
  extensions: [],
}
