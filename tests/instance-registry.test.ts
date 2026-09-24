import assert from 'node:assert/strict'
import { listRegisteredGerardInstances } from '../lib/runtime/instance-registry'

const instances = listRegisteredGerardInstances()
assert.deepEqual(instances.map((item) => item.application), ['gerard-standard', 'novotralux'])
assert.equal(instances.find((item) => item.applicationType === 'STANDARD')?.organizationId, 'org-gerard-default')
assert.equal(instances.find((item) => item.applicationType === 'CUSTOM')?.organizationId, 'org-novotralux')
assert.equal(instances.find((item) => item.application === 'novotralux')?.coreVersion, '1.0.0')
assert.equal('metrics' in (instances.find((item) => item.application === 'novotralux') ?? {}), false)
console.log('Platform instance registry: Standard + Custom metadata OK')
