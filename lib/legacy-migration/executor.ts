import { createHash } from 'node:crypto'
import { Client } from 'pg'
import { analyzeMigration, roleMap, sourceTables, tenantModels, type Dataset, type Row } from './analyzer'

const organizationId = 'org-novotralux'
const enabledModules = ['PLANNING', 'MAP', 'PROFITABILITY', 'INVOICING', 'FLEET', 'INTELLIGENCE', 'ASSISTANT', 'MAINTENANCE']
const copyOrder = [
  'ClientProfile', 'Driver', 'Truck', 'Trailer', 'ParkSpot', 'Mission', 'PlanningRow', 'MissionAssignment',
  'TrailerCustodyEvent', 'MissionEvent', 'TruckPosition', 'DriverPosition', 'DriverRegulatoryDeclaration',
  'DriverActivityEvent', 'TruckEvent', 'MaintenanceRequest', 'MaintenanceStatusHistory',
  'MaintenanceInterventionLine', 'Invoice', 'InvoiceLine', 'InvoiceMission', 'MissionSourceEmail',
  'IgnoredMailImport', 'ParkMovement', 'ParkInspection', 'ParkInspectionResult',
  'DispatchOptimizationApplication', 'WeeklyProfitabilityAdjustment',
] as const

const delayedColumns: Record<string, string[]> = {
  User: ['driverId'],
  Truck: ['driverId'],
  DriverActivityEvent: ['correctedEventId'],
}

function quote(identifier: string) { return `"${identifier.replace(/"/g, '""')}"` }
function deterministicId(kind: string, value: string) {
  return `${kind}-${createHash('sha256').update(value).digest('hex').slice(0, 24)}`
}
function stable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]))
  return value
}
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex') }

export type MigrationExecutionResult = {
  status: 'MIGRATED' | 'ALREADY_MIGRATED'
  phases: Array<{ name: string; inserted: number }>
  counts: Record<string, { source: number; target: number }>
  checksums: { source: Record<string, string>; target: Record<string, string>; match: boolean }
  relations: { total: number; valid: number; orphaned: number }
  routeCache: { candidates: number; created: number; duplicates: number; skipped: number; reasons: Record<string, number>; googleCalls: 0 }
  idPreservation: { checked: number; missing: number }
  tenantScope: { checked: number; missingOrganizationId: number; wrongOrganizationId: number }
  auth: { users: number; exactHashesPreserved: number; compatibleHashFormat: number; rolesComplete: boolean; credentialLoginsPerformed: number }
  billing: { invoices: number; lines: number; missionLinks: number; totalAmount: number; statusCounts: Record<string, number>; pdfUrls: number }
  integrations: { mailIntakeEnabled: false; slAutomotiveEnabled: false }
}

type TargetColumn = { column_name: string; data_type: string }

export function serializeLegacyJsonValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value)) }
    catch { return JSON.stringify(value) }
  }
  return JSON.stringify(value)
}

async function targetColumns(client: Client, table: string) {
  const result = await client.query<TargetColumn>(`SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table])
  return result.rows
}

async function insertRows(client: Client, table: string, rows: Row[], extra: Row = {}, omit: string[] = []) {
  if (!rows.length) return 0
  const metadata = await targetColumns(client, table)
  const available = new Set(metadata.map((column) => column.column_name))
  const jsonColumns = new Set(metadata.filter((column) => column.data_type === 'json' || column.data_type === 'jsonb').map((column) => column.column_name))
  const sourceColumns = Object.keys(rows[0]).filter((column) => available.has(column) && !omit.includes(column))
  const extraColumns = Object.keys(extra).filter((column) => available.has(column) && !sourceColumns.includes(column))
  const columns = [...sourceColumns, ...extraColumns]
  let inserted = 0
  for (const row of rows) {
    const values = columns.map((column) => {
      const value = column in extra ? extra[column] : row[column]
      return jsonColumns.has(column) ? serializeLegacyJsonValue(value) : value
    })
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ')
    const result = await client.query(`INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES (${placeholders}) ON CONFLICT (${quote('id')}) DO NOTHING`, values)
    inserted += result.rowCount || 0
  }
  return inserted
}

async function phase<T>(client: Client, name: string, task: () => Promise<T>) {
  await client.query('BEGIN')
  try { const result = await task(); await client.query('COMMIT'); return result }
  catch (error) { await client.query('ROLLBACK'); throw new Error(`MIGRATION_PHASE_FAILED:${name}:${error instanceof Error ? error.message : 'UNKNOWN'}`) }
}

function unanimous(rows: Row[], field: string) {
  const values = Array.from(new Set(rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined && value !== '')))
  return values.length === 1 ? values[0] : null
}

function paymentTermsDays(rows: Row[]) {
  const value = unanimous(rows, 'paymentTerms')
  if (typeof value !== 'string') return null
  const match = value.match(/(\d+)\s*(?:jours|days)/i)
  return match ? Number(match[1]) : null
}

function normalizeCoordinate(value: number) { return Number(value.toFixed(5)) }
function routeFingerprint(originLat: number, originLng: number, destinationLat: number, destinationLng: number) {
  return hash({ origin: { latitude: normalizeCoordinate(originLat), longitude: normalizeCoordinate(originLng) }, destination: { latitude: normalizeCoordinate(destinationLat), longitude: normalizeCoordinate(destinationLng) }, waypoints: [], travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE' })
}

async function backfillRoutes(client: Client, missions: Row[]) {
  const reasons = { NOT_GOOGLE_ROUTES: 0, MISSING_ENDPOINTS: 0, MISSING_METRICS: 0, DUPLICATE_FINGERPRINT: 0 }
  const candidates = new Map<string, Row>()
  for (const mission of missions) {
    if (mission.routeProvider !== 'GOOGLE_ROUTES') { reasons.NOT_GOOGLE_ROUTES += 1; continue }
    const points = [mission.pickupLat, mission.pickupLng, mission.deliveryLat, mission.deliveryLng]
    if (points.some((value) => typeof value !== 'number')) { reasons.MISSING_ENDPOINTS += 1; continue }
    if (typeof mission.routeDistanceMeters !== 'number' || typeof mission.routeDurationSeconds !== 'number' || mission.routeDurationSeconds <= 0) { reasons.MISSING_METRICS += 1; continue }
    const fingerprint = routeFingerprint(points[0] as number, points[1] as number, points[2] as number, points[3] as number)
    if (candidates.has(fingerprint)) { reasons.DUPLICATE_FINGERPRINT += 1; continue }
    candidates.set(fingerprint, mission)
  }
  let created = 0
  for (const [fingerprint, mission] of Array.from(candidates.entries())) {
    const result = await client.query(`INSERT INTO "RouteCache" (id,fingerprint,"originLat","originLng","destinationLat","destinationLng",waypoints,"travelMode","routingPreference","distanceMeters","durationSeconds",polyline,provider,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'DRIVE','TRAFFIC_AWARE',$8,$9,$10,$11,now(),now()) ON CONFLICT (fingerprint) DO NOTHING`, [deterministicId('route', fingerprint), fingerprint, normalizeCoordinate(mission.pickupLat as number), normalizeCoordinate(mission.pickupLng as number), normalizeCoordinate(mission.deliveryLat as number), normalizeCoordinate(mission.deliveryLng as number), JSON.stringify([]), mission.routeDistanceMeters, mission.routeDurationSeconds, mission.routePolyline ?? null, mission.routeProvider])
    created += result.rowCount || 0
  }
  return { candidates: candidates.size, created, duplicates: reasons.DUPLICATE_FINGERPRINT, skipped: missions.length - candidates.size, reasons, googleCalls: 0 as const }
}

function projectTargetToLegacy(source: Dataset, target: Dataset): Dataset {
  return Object.fromEntries(sourceTables.map((table) => {
    const keys = new Set(Object.keys(source[table]?.[0] || {}))
    return [table, (target[table] || []).map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => keys.has(key))))]
  }))
}

async function readTargetDataset(client: Client): Promise<Dataset> {
  const data: Dataset = {}
  for (const table of sourceTables) data[table] = (await client.query<Row>(`SELECT * FROM ${quote(table)} WHERE ${table === 'User' ? `id IN (SELECT "userId" FROM "OrganizationUser" WHERE "organizationId"=$1)` : `"organizationId"=$1`} ORDER BY id`, [organizationId])).rows
  return data
}

export async function executeLegacyMigration(connectionString: string, source: Dataset): Promise<MigrationExecutionResult> {
  const client = new Client({ connectionString, application_name: 'gerard-legacy-migration-7e3-target' })
  await client.connect()
  const phases: Array<{ name: string; inserted: number }> = []
  try {
    const existing = await client.query<{ id: string }>('SELECT id FROM "Organization" WHERE slug=$1', ['novotralux'])
    const alreadyMigrated = existing.rowCount === 1
    if (alreadyMigrated) {
      const existingCounts = await readTargetDataset(client)
      if (sourceTables.some((table) => existingCounts[table].length !== (source[table] || []).length)) throw new Error('PARTIAL_MIGRATION_DETECTED')
    } else {
      phases.push({ name: 'organization', inserted: await phase(client, 'organization', async () => {
        const result = await client.query(`INSERT INTO "Organization" (id,name,slug,status,"enabledModules","displayName","createdAt","updatedAt") VALUES ($1,'Novotralux','novotralux','ACTIVE',$2,'Novotralux',now(),now())`, [organizationId, enabledModules])
        return result.rowCount || 0
      }) })
      phases.push({ name: 'users', inserted: await phase(client, 'users', () => insertRows(client, 'User', source.User || [], { platformRole: null }, delayedColumns.User)) })
      phases.push({ name: 'memberships', inserted: await phase(client, 'memberships', async () => {
        let inserted = 0
        for (const user of source.User || []) {
          const role = roleMap[String(user.role)]; if (!role) throw new Error(`UNKNOWN_ROLE:${String(user.role)}`)
          const result = await client.query(`INSERT INTO "OrganizationUser" (id,"organizationId","userId",role,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,now(),now()) ON CONFLICT ("organizationId","userId") DO NOTHING`, [deterministicId('membership', `${organizationId}:${String(user.id)}`), organizationId, user.id, role])
          inserted += result.rowCount || 0
        }
        return inserted
      }) })
      for (const table of copyOrder) {
        phases.push({ name: table, inserted: await phase(client, table, () => insertRows(client, table, source[table] || [], { organizationId }, delayedColumns[table] || [])) })
        if (table === 'Truck') {
          await phase(client, 'restore-cycle-links', async () => {
            for (const user of source.User || []) if (user.driverId) await client.query('UPDATE "User" SET "driverId"=$1 WHERE id=$2', [user.driverId, user.id])
            for (const truck of source.Truck || []) if (truck.driverId) await client.query('UPDATE "Truck" SET "driverId"=$1 WHERE id=$2 AND "organizationId"=$3', [truck.driverId, truck.id, organizationId])
          })
        }
        if (table === 'DriverActivityEvent') await phase(client, 'restore-activity-corrections', async () => { for (const event of source.DriverActivityEvent || []) if (event.correctedEventId) await client.query('UPDATE "DriverActivityEvent" SET "correctedEventId"=$1 WHERE id=$2 AND "organizationId"=$3', [event.correctedEventId, event.id, organizationId]) })
      }
      const issued = (source.Invoice || []).filter((invoice) => invoice.direction === 'ISSUED')
      phases.push({ name: 'billing-and-integrations', inserted: await phase(client, 'billing-and-integrations', async () => {
        await client.query(`INSERT INTO "OrganizationBillingConfig" (id,"organizationId","legalName","legalAddress","vatNumber",iban,bic,"bankName",beneficiary,"invoicePrefix","paymentTermsDays","billingEmail","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'NTX',$10,NULL,now(),now())`, [deterministicId('billing', organizationId), organizationId, unanimous(issued, 'sellerName'), unanimous(issued, 'sellerAddress'), unanimous(issued, 'sellerVatNumber'), unanimous(issued, 'sellerIban'), unanimous(issued, 'sellerBic'), unanimous(issued, 'sellerBankName'), unanimous(issued, 'sellerBeneficiary'), paymentTermsDays(issued)])
        for (const type of ['MAIL_INTAKE', 'SL_AUTOMOTIVE']) await client.query(`INSERT INTO "OrganizationIntegration" (id,"organizationId",type,enabled,"configJson","secretRef","createdAt","updatedAt") VALUES ($1,$2,$3,false,$4::jsonb,NULL,now(),now())`, [deterministicId('integration', `${organizationId}:${type}`), organizationId, type, JSON.stringify(type === 'SL_AUTOMOTIVE' ? { providerName: 'SL Automotive' } : {})])
        return 3
      }) })
    }

    const routeCache = alreadyMigrated
      ? { candidates: 0, created: 0, duplicates: 0, skipped: 0, reasons: {}, googleCalls: 0 as const }
      : await phase(client, 'route-cache', () => backfillRoutes(client, source.Mission || []))
    const target = await readTargetDataset(client)
    const projected = projectTargetToLegacy(source, target)
    const sourceAnalysis = analyzeMigration(source, {}, 'novotralux')
    const targetAnalysis = analyzeMigration(projected, {}, 'novotralux')
    const counts = Object.fromEntries(sourceTables.map((table) => [table, { source: (source[table] || []).length, target: (projected[table] || []).length }]))
    const targetIds = new Set(sourceTables.flatMap((table) => (target[table] || []).map((row) => `${table}:${String(row.id)}`)))
    const sourceIds = sourceTables.flatMap((table) => (source[table] || []).map((row) => `${table}:${String(row.id)}`))
    let tenantChecked = 0; let missingOrganizationId = 0; let wrongOrganizationId = 0
    for (const table of tenantModels) for (const row of target[table] || []) { tenantChecked += 1; if (!row.organizationId) missingOrganizationId += 1; else if (row.organizationId !== organizationId) wrongOrganizationId += 1 }
    const authHashes = new Map((source.User || []).map((row) => [String(row.id), row.passwordHash]))
    const exactHashesPreserved = (target.User || []).filter((row) => row.passwordHash === authHashes.get(String(row.id))).length
    const compatibleHashFormat = (target.User || []).filter((row) => typeof row.passwordHash === 'string' && /^scrypt:[0-9a-f]+:[0-9a-f]+$/i.test(row.passwordHash)).length
    const invoices = target.Invoice || []
    const statusCounts = Object.fromEntries(Array.from(new Set(invoices.map((row) => String(row.status)))).sort().map((status) => [status, invoices.filter((row) => row.status === status).length]))
    return {
      status: alreadyMigrated ? 'ALREADY_MIGRATED' : 'MIGRATED', phases, counts,
      checksums: { source: sourceAnalysis.checksums, target: targetAnalysis.checksums, match: hash(sourceAnalysis.checksums) === hash(targetAnalysis.checksums) },
      relations: targetAnalysis.relations,
      routeCache,
      idPreservation: { checked: sourceIds.length, missing: sourceIds.filter((id) => !targetIds.has(id)).length },
      tenantScope: { checked: tenantChecked, missingOrganizationId, wrongOrganizationId },
      auth: { users: target.User.length, exactHashesPreserved, compatibleHashFormat, rolesComplete: sourceAnalysis.userMappings.every((mapping) => Boolean(mapping.targetOrganizationRole)), credentialLoginsPerformed: 0 },
      billing: { invoices: invoices.length, lines: target.InvoiceLine.length, missionLinks: target.InvoiceMission.length, totalAmount: Number(invoices.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0).toFixed(2)), statusCounts, pdfUrls: invoices.filter((row) => row.sourcePdfUrl).length },
      integrations: { mailIntakeEnabled: false, slAutomotiveEnabled: false },
    }
  } finally { await client.end() }
}
