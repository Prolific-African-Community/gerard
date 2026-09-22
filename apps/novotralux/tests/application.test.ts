import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { GERARD_CORE_VERSION, checkCoreCompatibility, defaultGerardApplication } from '@prolific/gerard-core'
import { novotraluxApplication } from '../application'
import { novotraluxBranding } from '../branding'
import { novotraluxIntegrationRegistry } from '../extensions/integrations'
import { novotraluxInstance } from '../instance'
import { novotraluxManifest } from '../manifest'

assert.equal(checkCoreCompatibility(novotraluxManifest.compatibleCore, GERARD_CORE_VERSION).status, 'COMPATIBLE')
assert.equal(novotraluxManifest.type, 'CUSTOM')
assert.equal(novotraluxManifest.coreVersion, '1.0.0')
assert.equal(novotraluxInstance.organizationId, 'org-novotralux')
assert.equal(novotraluxInstance.domain, null)
assert.equal(novotraluxApplication.identity.productName, 'Novotralux')
assert.deepEqual(novotraluxApplication.ui.missionCard, defaultGerardApplication.ui.missionCard)
assert.equal(novotraluxApplication.policies.missionReference({ reference: 'INT-1', clientReference: 'CLIENT-1' }).primary, 'CLIENT-1')
assert.deepEqual(novotraluxIntegrationRegistry.list(), ['MAIL_INTAKE', 'SL_AUTOMOTIVE'])
assert.equal(novotraluxIntegrationRegistry.get('SL_AUTOMOTIVE')?.implementationId, 'novotralux-sl-automotive')
assert.equal(novotraluxBranding.accentColor, '#C8FF00')
const appRoot = path.resolve(process.cwd())
const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(directory, entry.name)
  return entry.isDirectory() ? sourceFiles(full) : /\.(ts|tsx|mjs)$/.test(entry.name) ? [full] : []
})
for (const file of sourceFiles(appRoot)) {
  const source = readFileSync(file, 'utf8')
  assert.doesNotMatch(source, /from ['"](?:\.\.\/)+(?:lib|pages|components)\//, `${file} imports a private Gerard surface`)
}
console.log('novotralux custom application tests passed')
