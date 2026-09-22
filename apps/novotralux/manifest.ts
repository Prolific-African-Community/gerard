import { GERARD_CORE_VERSION, type GerardApplicationManifest } from '@prolific/gerard-core'

export const novotraluxManifest: GerardApplicationManifest = {
  application: 'novotralux',
  type: 'CUSTOM',
  coreVersion: GERARD_CORE_VERSION,
  compatibleCore: '^1.0.0',
  extensions: ['novotralux-branding', 'mail-intake', 'sl-automotive'],
}
