import type { GerardApplicationDefinition } from './application/types'

export type GerardApplicationType = 'STANDARD' | 'CUSTOM'
export type GerardApplicationManifest = {
  application: string
  type: GerardApplicationType
  coreVersion: string
  compatibleCore: string
  extensions: readonly string[]
}
export type GerardInstanceRegistryEntry = {
  client: string
  application: string
  applicationType: GerardApplicationType
  coreVersion: string
  compatibleCore: string
  environment: string
  organizationId: string
  domain: string | null
  status: 'ACTIVE' | 'READY_FOR_CUTOVER' | 'PAUSED' | 'ARCHIVED'
  lastCompatibilityStatus: 'COMPATIBLE' | 'CORE_TOO_OLD' | 'INCOMPATIBLE_MAJOR' | 'INCOMPATIBLE_VERSION' | 'INVALID_RANGE' | 'UNKNOWN'
  deploymentReference?: string
  cutoverAt?: string
  configurationEndpoint?: string
}
export type GerardInstanceMigrationState = { coreVersion: string; lastCoreMigration: string | null; customMigrations: readonly string[] }
export type GerardApplicationConsumer = { manifest: GerardApplicationManifest; application: GerardApplicationDefinition }
