export type GerardIntegrationImplementation<TConfig = unknown> = {
  type: string
  implementationId?: string
  capabilities?: readonly ('READ' | 'OUTBOUND' | 'WEBHOOK')[]
  validateConfig: (value: unknown) => TConfig
}

export function createIntegrationRegistry(initial: readonly GerardIntegrationImplementation[] = []) {
  const implementations = new Map<string, GerardIntegrationImplementation>()
  const register = (implementation: GerardIntegrationImplementation) => {
    if (!implementation.type.trim()) throw new Error('INTEGRATION_TYPE_REQUIRED')
    if (implementations.has(implementation.type)) throw new Error(`INTEGRATION_ALREADY_REGISTERED:${implementation.type}`)
    implementations.set(implementation.type, implementation)
    return implementation
  }
  initial.forEach(register)
  return {
    register,
    get(type: string) { return implementations.get(type) ?? null },
    list() { return Array.from(implementations.keys()).sort() },
  }
}
