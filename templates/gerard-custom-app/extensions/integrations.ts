import { createIntegrationRegistry } from '@prolific/gerard-core'

export const customIntegrations = createIntegrationRegistry()
customIntegrations.register({
  type: 'CUSTOM_ERP',
  validateConfig(value) {
    if (!value || typeof value !== 'object') throw new Error('CUSTOM_ERP_CONFIG_INVALID')
    return value as Record<string, unknown>
  },
})
