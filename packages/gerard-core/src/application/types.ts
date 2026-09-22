import type { ComponentType, ReactNode } from 'react'

export type MissionReferenceField = 'reference' | 'clientReference'
export type MissionReferenceInput = { reference: string; clientReference?: string | null }
export type MissionReferenceResult = { primary: string; secondary: string | null }
export type MissionCardSlotProps = { mission: MissionReferenceInput; compact: boolean; primaryReference: string; secondaryReference: string | null }
export type NavigationCapability = 'canViewPlanning' | 'canViewMap' | 'canViewProfitability' | 'canViewInvoices' | 'canViewPark'
export type GerardNavigationItem = { id: string; label: string; href: string; requiredCapability?: NavigationCapability }

export type GerardApplicationDefinition = {
  identity: { id: string; productName: string }
  features: { hiddenNavigationItems: readonly string[] }
  terminology: { mission: string; driver: string; park: string; fleet: string; client: string; internalReference: string }
  ui: {
    missionCard: {
      primaryReference: MissionReferenceField
      secondaryReference: MissionReferenceField | null
      visibleFields: readonly ('route' | 'client' | 'distance' | 'status')[]
      detailFieldOrder: readonly ('client' | 'distance')[]
    }
    navigation: { additions: readonly GerardNavigationItem[] }
    components: {
      MissionCardHeader?: ComponentType<MissionCardSlotProps>
      MissionCardReference?: ComponentType<MissionCardSlotProps>
      MissionCardFooter?: ComponentType<MissionCardSlotProps>
      DashboardAddition?: ComponentType<{ children?: ReactNode }>
    }
  }
  policies: {
    missionReference: (mission: MissionReferenceInput) => MissionReferenceResult
    assignmentScoring: { minimumEmptyKmSaving: number; minimumCostSaving: number; minimumMarginGain: number }
  }
  integrations: { supportedTypes: readonly string[] }
}
