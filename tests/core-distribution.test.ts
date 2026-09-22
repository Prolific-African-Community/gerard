import assert from 'node:assert/strict'

import {
  GERARD_CORE_VERSION,
  checkCoreCompatibility,
  createIntegrationRegistry,
  defaultGerardApplication,
  defineGerardApplication,
  type GerardInstanceRegistryEntry,
} from '@prolific/gerard-core'
import * as intelligence from '@prolific/gerard-core/intelligence'
import { GERARD_DISPATCH_OPTIMIZATION_ID, canonicalizeDispatchOptimizationId, dispatchOptimizationConfigurationV1 } from '../lib/dispatch/optimization/config'
import { gerardStandardApplication, gerardStandardManifest } from '../lib/standard/application'
import { customConsumer } from '../templates/gerard-custom-app/app/bootstrap'
import { customIntegrations } from '../templates/gerard-custom-app/extensions/integrations'

assert.equal(GERARD_CORE_VERSION, '1.0.0')
assert.deepEqual(checkCoreCompatibility('^1.0.0'), { compatible: true, status: 'COMPATIBLE', coreVersion: '1.0.0', compatibleCore: '^1.0.0' })
assert.equal(checkCoreCompatibility('^1.1.0').status, 'CORE_TOO_OLD')
assert.equal(checkCoreCompatibility('^2.0.0').status, 'INCOMPATIBLE_MAJOR')
assert.equal(checkCoreCompatibility('invalid').status, 'INVALID_RANGE')

assert.equal(gerardStandardApplication, defaultGerardApplication)
assert.equal(gerardStandardManifest.coreVersion, GERARD_CORE_VERSION)
assert.equal(checkCoreCompatibility(gerardStandardManifest.compatibleCore).compatible, true)
assert.equal(checkCoreCompatibility(customConsumer.manifest.compatibleCore).compatible, true)
assert.notEqual(customConsumer.application, defaultGerardApplication)
assert.equal(customConsumer.application.identity.id, 'client-example')
assert.equal(customIntegrations.get('CUSTOM_ERP')?.type, 'CUSTOM_ERP')

const registry = createIntegrationRegistry()
registry.register({ type: 'EXAMPLE', validateConfig: (value) => value })
assert.deepEqual(registry.list(), ['EXAMPLE'])
assert.throws(() => registry.register({ type: 'EXAMPLE', validateConfig: (value) => value }), /INTEGRATION_ALREADY_REGISTERED/)

assert.equal(typeof defineGerardApplication, 'function')
assert.equal(typeof intelligence.analyzePlanningForSuggestions, 'function')
assert.equal(typeof intelligence.applyPlanningSuggestion, 'function')
assert.equal(typeof intelligence.answerAssistantQuestion, 'function')
assert.equal(typeof intelligence.getOrComputeRoute, 'function')

assert.equal(dispatchOptimizationConfigurationV1.id, GERARD_DISPATCH_OPTIMIZATION_ID)
assert.equal(canonicalizeDispatchOptimizationId('GERARD_DISPATCH_OPTIMIZATION'), GERARD_DISPATCH_OPTIMIZATION_ID)
assert.equal(canonicalizeDispatchOptimizationId('NOVOTRALUX_DISPATCH_OPTIMIZATION'), GERARD_DISPATCH_OPTIMIZATION_ID)
assert.equal(canonicalizeDispatchOptimizationId('UNKNOWN'), null)

const registryContract: GerardInstanceRegistryEntry = {
  client: 'example', application: 'example', applicationType: 'CUSTOM', coreVersion: GERARD_CORE_VERSION,
  compatibleCore: '^1.0.0', environment: 'test', organizationId: 'org-example',
  domain: null, status: 'ACTIVE', lastCompatibilityStatus: 'COMPATIBLE',
}
assert.equal(registryContract.lastCompatibilityStatus, 'COMPATIBLE')
console.log('Core version, compatibility, consumers, registry, Intelligence exports and legacy identifier: OK')
