import type { GerardApplicationDefinition, MissionReferenceInput } from './types'

export function defineGerardApplication(definition: GerardApplicationDefinition): GerardApplicationDefinition { return definition }

export function referenceValue(mission: MissionReferenceInput, field: 'reference' | 'clientReference') {
  return field === 'clientReference' ? mission.clientReference?.trim() || null : mission.reference.trim() || null
}

export function createMissionReferencePolicy(primaryField: 'reference' | 'clientReference', secondaryField: 'reference' | 'clientReference' | null) {
  return (mission: MissionReferenceInput) => {
    const configuredPrimary = referenceValue(mission, primaryField)
    const primary = configuredPrimary || referenceValue(mission, 'reference') || ''
    const secondary = configuredPrimary && secondaryField ? referenceValue(mission, secondaryField) : null
    return { primary, secondary }
  }
}
