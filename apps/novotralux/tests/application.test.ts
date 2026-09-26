import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { GERARD_CORE_VERSION, checkCoreCompatibility, defaultGerardApplication } from '@prolific/gerard-core'
import { novotraluxApplication } from '../application'
import { novotraluxBranding } from '../branding'
import { novotraluxIntegrationRegistry } from '../extensions/integrations'
import { novotraluxInstance } from '../instance'
import { novotraluxManifest } from '../manifest'
import { resolveNovotraluxDatabaseTarget } from '../scripts/database-target.mjs'

assert.equal(checkCoreCompatibility(novotraluxManifest.compatibleCore, GERARD_CORE_VERSION).status, 'COMPATIBLE')
assert.equal(novotraluxManifest.type, 'CUSTOM')
assert.equal(novotraluxManifest.coreVersion, '1.0.0')
assert.equal(novotraluxInstance.organizationId, 'org-novotralux')
assert.equal(novotraluxInstance.domain, 'www.novotralux.eu')
assert.equal(novotraluxApplication.identity.productName, 'Novotralux')
assert.deepEqual(novotraluxApplication.ui.missionCard, defaultGerardApplication.ui.missionCard)
assert.equal(novotraluxApplication.policies.missionReference({ reference: 'INT-1', clientReference: 'CLIENT-1' }).primary, 'CLIENT-1')
assert.deepEqual(novotraluxIntegrationRegistry.list(), ['MAIL_INTAKE', 'SL_AUTOMOTIVE'])
assert.equal(novotraluxIntegrationRegistry.get('SL_AUTOMOTIVE')?.implementationId, 'novotralux-sl-automotive')
assert.equal(novotraluxBranding.accentColor, '#C8FF00')
// Deux bases applicatives : la Production lit sa variable dédiée, le local la variable Custom explicite.
assert.deepEqual(resolveNovotraluxDatabaseTarget({ VERCEL_ENV: 'production', NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL: 'postgres://u@ep-ancient-surf-zav7xo37.eu.aws.neon.tech/neondb' }), { target: 'postgres://u@ep-ancient-surf-zav7xo37.eu.aws.neon.tech/neondb', instanceEnvironment: 'production' })
assert.throws(() => resolveNovotraluxDatabaseTarget({ VERCEL_ENV: 'production', NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL: 'postgres://u@ep-ancient-block-za26cw6e.eu.aws.neon.tech/neondb' }), /PRODUCTION_DATABASE_MISMATCH/, 'Production Custom accepte seulement la base Novotralux Custom')
assert.throws(() => resolveNovotraluxDatabaseTarget({ VERCEL_ENV: 'production' }), /NOVOTRALUX_PRODUCTION_DATABASE_URL_REQUIRED/)
assert.deepEqual(resolveNovotraluxDatabaseTarget({ NOVOTRALUX_CUSTOM_DATABASE_URL: 'postgres://u@ep-ancient-surf-zav7xo37.eu.aws.neon.tech/neondb' }), { target: 'postgres://u@ep-ancient-surf-zav7xo37.eu.aws.neon.tech/neondb', instanceEnvironment: 'development' })
// Le local n'hérite jamais de la DATABASE_URL de Gerard Standard.
assert.throws(() => resolveNovotraluxDatabaseTarget({ DATABASE_URL: 'postgres://u@ep-ancient-block-za26cw6e.eu.aws.neon.tech/neondb' }), /NOVOTRALUX_CUSTOM_DATABASE_URL_REQUIRED/)
assert.throws(() => resolveNovotraluxDatabaseTarget({}), /NOVOTRALUX_CUSTOM_DATABASE_URL_REQUIRED/)

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
