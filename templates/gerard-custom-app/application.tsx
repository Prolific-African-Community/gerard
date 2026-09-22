import { createMissionReferencePolicy, defaultGerardApplication, defineGerardApplication } from '@prolific/gerard-core'
import { CustomMissionReference } from './extensions/CustomMissionReference'

export const customApplication = defineGerardApplication({
  ...defaultGerardApplication,
  identity: { id: 'client-example', productName: 'Client Example' },
  terminology: { ...defaultGerardApplication.terminology, mission: 'Ordre de transport' },
  ui: {
    ...defaultGerardApplication.ui,
    missionCard: { ...defaultGerardApplication.ui.missionCard, primaryReference: 'reference', secondaryReference: 'clientReference' },
    navigation: { additions: [{ id: 'custom-report', label: 'Rapport', href: '/custom/report', requiredCapability: 'canViewProfitability' }] },
    components: { ...defaultGerardApplication.ui.components, MissionCardReference: CustomMissionReference },
  },
  policies: {
    missionReference: createMissionReferencePolicy('reference', 'clientReference'),
    assignmentScoring: { minimumEmptyKmSaving: 30, minimumCostSaving: 25, minimumMarginGain: 25 },
  },
  integrations: { supportedTypes: [...defaultGerardApplication.integrations.supportedTypes, 'CUSTOM_ERP'] },
})
