import { defaultGerardApplication } from '@prolific/gerard-core/application'

export const reassignmentEfficiencyConfig = Object.freeze({
  version: '2026-09-20.v1',
  ...defaultGerardApplication.policies.assignmentScoring,
})
