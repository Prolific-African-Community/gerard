import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as nextEnv from '@next/env'
import { analyzeMigration, sourceTables, targetInspectionTables } from '../lib/legacy-migration/analyzer'
import { executeLegacyMigration } from '../lib/legacy-migration/executor'
import { ReadonlyDatabase } from '../lib/legacy-migration/readonly-db'

function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null }
async function main() {
  const envModule = nextEnv as unknown as { loadEnvConfig?: (directory: string) => unknown; default?: { loadEnvConfig?: (directory: string) => unknown } }
  const envLoader = envModule.loadEnvConfig ?? envModule.default?.loadEnvConfig
  if (!envLoader) throw new Error('NEXT_ENV_LOADER_UNAVAILABLE')
  envLoader(process.cwd())
  const execute = process.argv.includes('--execute')
  const confirmed = process.argv.includes('--confirm-legacy-migration')
  if (execute !== confirmed) throw new Error('EXECUTE_REQUIRES_CONFIRM_LEGACY_MIGRATION')
  if (!execute && !process.argv.includes('--dry-run')) throw new Error('DRY_RUN_FLAG_REQUIRED')
  const tenantSlug = option('--tenant-slug'); if (!tenantSlug || !/^[a-z0-9-]+$/.test(tenantSlug)) throw new Error('VALID_TENANT_SLUG_REQUIRED')
  if (execute && tenantSlug !== 'novotralux') throw new Error('EXECUTE_TENANT_NOT_ALLOWED')
  const sourceUrl = process.env.LEGACY_SOURCE_DATABASE_URL || ''
  const targetUrl = process.env.LEGACY_TARGET_DATABASE_URL || ''
  const prototypeUrl = process.env.DATABASE_URL || ''
  const identity = (value: string) => { const url = new URL(value); return `${url.hostname.toLowerCase()}:${url.port || '5432'}/${url.pathname.replace(/^\//, '')}` }
  if (!sourceUrl || !targetUrl || !prototypeUrl) throw new Error('MIGRATION_DATABASE_URLS_REQUIRED')
  if (new Set([identity(sourceUrl), identity(targetUrl), identity(prototypeUrl)]).size !== 3) throw new Error('MIGRATION_DATABASES_NOT_ISOLATED')
  const source = new ReadonlyDatabase(sourceUrl, 'LEGACY_SOURCE')
  const target = new ReadonlyDatabase(targetUrl, 'LEGACY_TARGET')
  await Promise.all([source.connect(), target.connect()])
  try {
    const [sourceBefore, targetBefore] = await Promise.all([source.fingerprint(sourceTables), target.fingerprint(targetInspectionTables)])
    const [sourceData, targetData] = await Promise.all([source.readDataset(sourceTables), target.readDataset(targetInspectionTables)])
    const analysis = analyzeMigration(sourceData, targetData, tenantSlug)
    const [sourceAfter, targetAfter] = await Promise.all([source.fingerprint(sourceTables), target.fingerprint(targetInspectionTables)])
    if (sourceBefore !== sourceAfter || targetBefore !== targetAfter) throw new Error('ZERO_WRITE_FINGERPRINT_CHANGED')
    const migratedOrganization = (targetData.Organization || []).find((row) => row.id === `org-${tenantSlug}` && row.slug === tenantSlug)
    const alreadyMigrated = Boolean(migratedOrganization) && sourceTables.every((table) => {
      if (table === 'User') return (targetData.OrganizationUser || []).length === (sourceData.User || []).length
      return (targetData[table] || []).filter((row) => row.organizationId === `org-${tenantSlug}`).length === (sourceData[table] || []).length
    })
    if (analysis.verdict !== 'GO' && !(execute && alreadyMigrated)) throw new Error('DRY_RUN_NO_GO')
    if (!execute) {
      const manifest = { manifestVersion: 1, generatedAt: new Date().toISOString(), mode: 'DRY_RUN_READ_ONLY', sourceSchema: 'legacy-novotralux', targetSchema: 'gerard-multi-tenant', ...analysis, zeroWriteProof: { sourceBefore, sourceAfter, sourceUnchanged: true, targetBefore, targetAfter, targetUnchanged: true } }
      const output = path.resolve(option('--output') || `artifacts/legacy-migration/${tenantSlug}-dry-run.json`)
      await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
      console.log(JSON.stringify({ verdict: manifest.verdict, counts: manifest.counts, findings: manifest.findings.length, businessFingerprint: manifest.businessFingerprint, zeroWriteProof: manifest.zeroWriteProof, manifest: output }, null, 2))
      return
    }
    if (!alreadyMigrated) {
      const previous = JSON.parse(await readFile(path.resolve(`artifacts/legacy-migration/${tenantSlug}-dry-run.json`), 'utf8')) as {
        businessFingerprint?: string
        counts?: Record<string, number>
        relations?: { total?: number; valid?: number; orphaned?: number }
        tenantCoverage?: { expected?: number; covered?: number }
        verdict?: string
      }
      const countsMatch = sourceTables.every((table) => previous.counts?.[table] === (sourceData[table] || []).length)
      if (!countsMatch || previous.businessFingerprint !== analysis.businessFingerprint || previous.verdict !== 'GO') throw new Error('SOURCE_CHANGED_SINCE_7E2_MANIFEST')
      if (analysis.relations.total !== 3960 || analysis.relations.valid !== 3960 || analysis.relations.orphaned !== 0) throw new Error('RELATION_PREFLIGHT_MISMATCH')
      if (analysis.tenantCoverage.expected !== 28 || analysis.tenantCoverage.covered !== 28) throw new Error('TENANT_COVERAGE_PREFLIGHT_MISMATCH')
    }
    await target.close()
    const execution = await executeLegacyMigration(targetUrl, sourceData)
    const sourceFinal = await source.fingerprint(sourceTables)
    if (sourceFinal !== sourceBefore) throw new Error('SOURCE_FINGERPRINT_CHANGED')
    const blockers = [
      ...Object.entries(execution.counts).filter(([, value]) => value.source !== value.target).map(([table]) => `COUNT_MISMATCH:${table}`),
      ...(execution.relations.orphaned ? [`ORPHANS:${execution.relations.orphaned}`] : []),
      ...(execution.idPreservation.missing ? [`MISSING_IDS:${execution.idPreservation.missing}`] : []),
      ...(execution.tenantScope.missingOrganizationId || execution.tenantScope.wrongOrganizationId ? ['TENANT_SCOPE_INVALID'] : []),
      ...(!execution.checksums.match ? ['CHECKSUM_MISMATCH'] : []),
      ...(execution.auth.users !== 17 || execution.auth.exactHashesPreserved !== 17 || execution.auth.compatibleHashFormat !== 17 ? ['AUTH_HASH_VALIDATION_FAILED'] : []),
    ]
    const warnings = execution.auth.credentialLoginsPerformed === 0 ? ['PRE_CUTOVER_HUMAN_LOGIN_TEST_REQUIRED'] : []
    const result = { manifestVersion: 1, generatedAt: new Date().toISOString(), mode: 'EXECUTE_ISOLATED_TARGET', tenant: tenantSlug, sourceFingerprint: { before: sourceBefore, after: sourceFinal, unchanged: true }, execution, blockers, warnings, verdict: blockers.length ? 'NO_GO' : 'GO' }
    const executeOutput = path.resolve(option('--output') || `artifacts/legacy-migration/${tenantSlug}-7e3-result.json`)
    await mkdir(path.dirname(executeOutput), { recursive: true }); await writeFile(executeOutput, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
    console.log(JSON.stringify({ status: execution.status, verdict: result.verdict, blockers, counts: execution.counts, relations: execution.relations, routeCache: execution.routeCache, manifest: executeOutput }, null, 2))
    if (result.verdict !== 'GO') process.exitCode = 2
  } finally { await source.close(); await target.close().catch(() => {}) }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'DRY_RUN_FAILED'); process.exitCode = 1 })
