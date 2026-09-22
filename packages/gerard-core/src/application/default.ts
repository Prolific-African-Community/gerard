import { createMissionReferencePolicy, defineGerardApplication } from './definition'

export const defaultGerardApplication = defineGerardApplication({
  identity: { id: 'gerard-standard', productName: 'Gerard' },
  features: { hiddenNavigationItems: [] },
  terminology: { mission: 'Mission', driver: 'Chauffeur', park: 'Parc', fleet: 'Flotte', client: 'Client', internalReference: 'Interne' },
  ui: {
    missionCard: { primaryReference: 'clientReference', secondaryReference: 'reference', visibleFields: ['route', 'client', 'distance', 'status'], detailFieldOrder: ['client', 'distance'] },
    navigation: { additions: [] }, components: {},
  },
  policies: {
    missionReference: createMissionReferencePolicy('clientReference', 'reference'),
    assignmentScoring: { minimumEmptyKmSaving: 20, minimumCostSaving: 20, minimumMarginGain: 20 },
  },
  integrations: { supportedTypes: ['MAIL_INTAKE', 'SL_AUTOMOTIVE'] },
})
