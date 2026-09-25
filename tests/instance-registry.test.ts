import assert from 'node:assert/strict'
import { listRegisteredGerardInstances } from '../lib/runtime/instance-registry'

const instances = listRegisteredGerardInstances()
assert.deepEqual(instances.map((item) => item.application), ['gerard-standard', 'novotralux'])
assert.equal(instances.find((item) => item.applicationType === 'STANDARD')?.organizationId, 'org-gerard-default')
assert.equal(instances.find((item) => item.applicationType === 'CUSTOM')?.organizationId, 'org-novotralux')
assert.equal(instances.find((item) => item.application === 'novotralux')?.coreVersion, '1.0.0')
assert.equal('metrics' in (instances.find((item) => item.application === 'novotralux') ?? {}), false)

const originalVercelEnvironment = process.env.VERCEL_ENV
const originalPreviewEndpoint = process.env.GERARD_PLATFORM_INSTANCE_NOVOTRALUX_PREVIEW_CONFIGURATION_ENDPOINT
process.env.VERCEL_ENV = 'preview'
process.env.GERARD_PLATFORM_INSTANCE_NOVOTRALUX_PREVIEW_CONFIGURATION_ENDPOINT = 'https://preview.example.vercel.app/api/internal/platform/configuration'
assert.equal(listRegisteredGerardInstances().find((item) => item.application === 'novotralux')?.configurationEndpoint, 'https://preview.example.vercel.app/api/internal/platform/configuration')
delete process.env.GERARD_PLATFORM_INSTANCE_NOVOTRALUX_PREVIEW_CONFIGURATION_ENDPOINT
assert.equal(listRegisteredGerardInstances().find((item) => item.application === 'novotralux')?.configurationEndpoint, undefined)
if (originalVercelEnvironment === undefined) delete process.env.VERCEL_ENV
else process.env.VERCEL_ENV = originalVercelEnvironment
if (originalPreviewEndpoint === undefined) delete process.env.GERARD_PLATFORM_INSTANCE_NOVOTRALUX_PREVIEW_CONFIGURATION_ENDPOINT
else process.env.GERARD_PLATFORM_INSTANCE_NOVOTRALUX_PREVIEW_CONFIGURATION_ENDPOINT = originalPreviewEndpoint
console.log('Platform instance registry: Standard + Custom metadata OK')
