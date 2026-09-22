import { defaultGerardApplication, defineGerardApplication } from '@prolific/gerard-core'

export const novotraluxApplication = defineGerardApplication({
  ...defaultGerardApplication,
  identity: { id: 'novotralux', productName: 'Novotralux' },
  integrations: { supportedTypes: ['MAIL_INTAKE', 'SL_AUTOMOTIVE'] },
})
