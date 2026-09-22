import type { GerardApplicationDefinition } from '@prolific/gerard-core'
import { novotraluxApplication } from '../../apps/novotralux/application'
import { gerardStandardApplication } from '../standard/application'

const applications: Readonly<Record<string, GerardApplicationDefinition>> = Object.freeze({
  'gerard-standard': gerardStandardApplication,
  novotralux: novotraluxApplication,
})

export function resolveRuntimeApplication(id = process.env.NEXT_PUBLIC_GERARD_APPLICATION || 'gerard-standard') {
  const application = applications[id]
  if (!application) throw new Error(`UNKNOWN_GERARD_APPLICATION:${id}`)
  return application
}

export const activeGerardApplication = resolveRuntimeApplication()
