import type { GerardApplicationDefinition, GerardNavigationItem, NavigationCapability } from './types'
import { defaultGerardApplication } from './default'

export type CapabilitySet = Record<NavigationCapability, boolean>
export function resolveGerardApplication(custom?: GerardApplicationDefinition | null) { return custom ?? defaultGerardApplication }
export function resolveApplicationNavigation(application: GerardApplicationDefinition, capabilities: CapabilitySet): GerardNavigationItem[] {
  const hidden = new Set(application.features.hiddenNavigationItems)
  return application.ui.navigation.additions.filter((item) => !hidden.has(item.id) && (!item.requiredCapability || capabilities[item.requiredCapability]))
}
