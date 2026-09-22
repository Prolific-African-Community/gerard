import assert from 'node:assert/strict'
import { fullDispatchCapabilities } from '../lib/auth/dispatch-capabilities'
import { defaultGerardApplication, resolveApplicationNavigation, resolveGerardApplication } from '@prolific/gerard-core'
import { TestMissionReference, testCustomApplication } from './fixtures/test-custom-application'

assert.equal(resolveGerardApplication(), defaultGerardApplication)
assert.deepEqual(defaultGerardApplication.policies.missionReference({ reference: 'GRD-1', clientReference: 'CLIENT-1' }), { primary: 'CLIENT-1', secondary: 'GRD-1' })
assert.deepEqual(defaultGerardApplication.ui.missionCard.detailFieldOrder, ['client', 'distance'])
assert.deepEqual(testCustomApplication.policies.missionReference({ reference: 'GRD-1', clientReference: 'CLIENT-1' }), { primary: 'GRD-1', secondary: 'CLIENT-1' })
assert.equal(testCustomApplication.terminology.mission, 'Ordre de transport')

const allowed = resolveApplicationNavigation(testCustomApplication, fullDispatchCapabilities)
assert.deepEqual(allowed.map((item) => item.id), ['custom-report'])
assert.deepEqual(resolveApplicationNavigation(testCustomApplication, { ...fullDispatchCapabilities, canViewProfitability: false }), [])

assert.equal(testCustomApplication.ui.components.MissionCardReference, TestMissionReference)
const slotResult = TestMissionReference({ mission: { reference: 'GRD-2', clientReference: 'CLIENT-2' }, compact: false, primaryReference: 'GRD-2', secondaryReference: 'CLIENT-2' })
assert.equal(slotResult.props['data-testid'], 'custom-reference')
assert.deepEqual(slotResult.props.children, ['GRD-2', '|', 'CLIENT-2'])

console.log('Default application, terminology, mission reference, navigation and UI slot: OK')
