import { createMissionReferencePolicy, defaultGerardApplication, defineGerardApplication, type MissionCardSlotProps } from '@prolific/gerard-core'

export function TestMissionReference({ primaryReference, secondaryReference }: MissionCardSlotProps) {
  return <strong data-testid="custom-reference">{primaryReference}|{secondaryReference}</strong>
}

export const testCustomApplication = defineGerardApplication({
  ...defaultGerardApplication,
  identity: { id: 'test-custom', productName: 'Test Custom' },
  terminology: { ...defaultGerardApplication.terminology, mission: 'Ordre de transport' },
  ui: {
    ...defaultGerardApplication.ui,
    missionCard: {
      ...defaultGerardApplication.ui.missionCard,
      primaryReference: 'reference',
      secondaryReference: 'clientReference',
    },
    navigation: {
      additions: [{ id: 'custom-report', label: 'Rapport custom', href: '/custom/report', requiredCapability: 'canViewProfitability' }],
    },
    components: {
      ...defaultGerardApplication.ui.components,
      MissionCardReference: TestMissionReference,
    },
  },
  policies: {
    missionReference: createMissionReferencePolicy('reference', 'clientReference'),
    assignmentScoring: {
      minimumEmptyKmSaving: 100,
      minimumCostSaving: 100,
      minimumMarginGain: 100,
    },
  },
})
