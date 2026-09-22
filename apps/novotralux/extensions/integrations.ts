import { createIntegrationRegistry } from '@prolific/gerard-core'

function objectConfig(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INTEGRATION_CONFIG_INVALID')
  return value as Record<string, unknown>
}

export const novotraluxIntegrationRegistry = createIntegrationRegistry([
  { type: 'MAIL_INTAKE', implementationId: 'gerard-mail-intake', capabilities: ['READ'] as const, validateConfig: objectConfig },
  { type: 'SL_AUTOMOTIVE', implementationId: 'novotralux-sl-automotive', capabilities: ['OUTBOUND', 'WEBHOOK'] as const, validateConfig: objectConfig },
])
