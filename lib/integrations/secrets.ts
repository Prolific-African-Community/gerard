export type IntegrationSecretKey = 'username' | 'password' | 'outboundApiKey' | 'inboundWebhookSecret'

export interface IntegrationSecretProvider {
  get(secretRef: string, key: IntegrationSecretKey): Promise<string | null>
}

export class IntegrationSecretError extends Error {
  statusCode = 503
  constructor(message = 'Secret d’intégration indisponible.') {
    super(message)
    this.name = 'IntegrationSecretError'
  }
}

function envToken(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')
}

export const envIntegrationSecretProvider: IntegrationSecretProvider = {
  async get(secretRef, key) {
    return process.env[`GERARD_INTEGRATION_SECRET_${envToken(secretRef)}_${envToken(key)}`]?.trim() || null
  },
}

export async function getIntegrationSecret(
  integration: { secretRef: string | null },
  key: IntegrationSecretKey,
  provider: IntegrationSecretProvider = envIntegrationSecretProvider,
) {
  if (!integration.secretRef?.trim()) throw new IntegrationSecretError()
  const value = await provider.get(integration.secretRef, key)
  if (!value) throw new IntegrationSecretError()
  return value
}
