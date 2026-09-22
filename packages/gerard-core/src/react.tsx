import { createContext, useContext } from 'react'
import { defaultGerardApplication } from './application/default'
import { resolveGerardApplication } from './application/resolver'
import type { GerardApplicationDefinition } from './application/types'

const Context = createContext<GerardApplicationDefinition>(defaultGerardApplication)
export function GerardApplicationProvider({ application, children }: { application?: GerardApplicationDefinition | null; children: React.ReactNode }) {
  return <Context.Provider value={resolveGerardApplication(application)}>{children}</Context.Provider>
}
export function useGerardApplication() { return useContext(Context) }
