import { createHash } from 'node:crypto'

export type Row = Record<string, unknown>
export type Dataset = Record<string, Row[]>
export type Severity = 'BLOCKER' | 'WARNING'
export type Finding = { code: string; severity: Severity; model?: string; detail: string }

export const tenantModels = [
  'ClientProfile', 'Driver', 'Truck', 'Trailer', 'Mission', 'Invoice', 'InvoiceLine', 'InvoiceMission',
  'PlanningRow', 'MissionAssignment', 'TrailerCustodyEvent', 'MissionEvent', 'DispatchOptimizationApplication',
  'DriverRegulatoryDeclaration', 'DriverActivityEvent', 'TruckEvent', 'TruckPosition', 'DriverPosition',
  'IgnoredMailImport', 'MaintenanceRequest', 'MaintenanceStatusHistory', 'MaintenanceInterventionLine',
  'WeeklyProfitabilityAdjustment', 'MissionSourceEmail', 'ParkSpot', 'ParkMovement', 'ParkInspection', 'ParkInspectionResult',
] as const

export const sourceTables = ['User', ...tenantModels] as const
export const targetInspectionTables = ['User', 'Organization', 'OrganizationUser', ...tenantModels] as const

export const roleMap: Record<string, string> = {
  ADMIN: 'ORG_ADMIN', DISPATCHER: 'DISPATCHER', SECRETARY: 'SECRETARY', PARK_MANAGER: 'MANAGER', DRIVER: 'DRIVER',
}

export const importOrder = [
  'Organization', 'User', 'OrganizationUser', 'ClientProfile', 'Driver', 'Truck', 'Trailer', 'ParkSpot', 'Mission',
  'PlanningRow', 'MissionAssignment', 'TrailerCustodyEvent', 'MissionEvent', 'TruckEvent', 'TruckPosition', 'DriverPosition',
  'DriverRegulatoryDeclaration', 'DriverActivityEvent', 'MaintenanceRequest', 'MaintenanceStatusHistory',
  'MaintenanceInterventionLine', 'Invoice', 'InvoiceLine', 'InvoiceMission', 'MissionSourceEmail', 'IgnoredMailImport',
  'ParkMovement', 'ParkInspection', 'ParkInspectionResult', 'DispatchOptimizationApplication', 'WeeklyProfitabilityAdjustment', 'RouteCache backfill',
]

const mustPreserve = new Set(['User', 'Driver', 'Truck', 'Trailer', 'Mission', 'MissionAssignment', 'Invoice', 'InvoiceLine', 'InvoiceMission', 'MaintenanceRequest', 'MissionSourceEmail'])
const shouldPreserve = new Set(tenantModels.filter((model) => !mustPreserve.has(model)))

const relations = [
  ['User', 'driverId', 'Driver'], ['Invoice', 'missionId', 'Mission'], ['Invoice', 'maintenanceRequestId', 'MaintenanceRequest'],
  ['MissionAssignment', 'missionId', 'Mission'], ['MissionAssignment', 'driverId', 'Driver'], ['MissionAssignment', 'truckId', 'Truck'], ['MissionAssignment', 'trailerId', 'Trailer'],
  ['PlanningRow', 'driverId', 'Driver'], ['PlanningRow', 'truckId', 'Truck'], ['InvoiceLine', 'invoiceId', 'Invoice'], ['InvoiceMission', 'invoiceId', 'Invoice'], ['InvoiceMission', 'missionId', 'Mission'],
  ['MissionEvent', 'missionId', 'Mission'], ['MissionEvent', 'driverId', 'Driver'], ['MissionEvent', 'truckId', 'Truck'], ['MissionEvent', 'trailerId', 'Trailer'],
  ['MaintenanceRequest', 'truckId', 'Truck'], ['MaintenanceRequest', 'trailerId', 'Trailer'], ['MaintenanceStatusHistory', 'maintenanceRequestId', 'MaintenanceRequest'],
  ['MaintenanceInterventionLine', 'maintenanceRequestId', 'MaintenanceRequest'], ['MissionSourceEmail', 'missionId', 'Mission'],
  ['TruckPosition', 'truckId', 'Truck'], ['DriverPosition', 'driverId', 'Driver'], ['DriverPosition', 'truckId', 'Truck'],
  ['ParkMovement', 'spotId', 'ParkSpot'], ['ParkMovement', 'truckId', 'Truck'], ['ParkMovement', 'trailerId', 'Trailer'],
  ['ParkInspection', 'truckId', 'Truck'], ['ParkInspection', 'trailerId', 'Trailer'], ['ParkInspectionResult', 'inspectionId', 'ParkInspection'],
  ['DispatchOptimizationApplication', 'actorId', 'User'], ['MissionEvent', 'actorId', 'User'], ['TruckEvent', 'actorId', 'User'],
] as const

function normalized(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalized)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Row).filter(([key]) => key !== 'updatedAt' && key !== 'createdAt' && key !== 'lastLoginAt').sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalized(child)]))
  return value
}
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(normalized(value))).digest('hex') }
function sortedRows(rows: Row[]) { return [...rows].sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? ''))).map(normalized) }
function duplicates(rows: Row[], key: string) {
  const values = new Map<string, number>()
  for (const row of rows) { const value = row[key]; if (value !== null && value !== undefined && String(value) !== '') values.set(String(value).toLowerCase(), (values.get(String(value).toLowerCase()) || 0) + 1) }
  return Array.from(values.entries()).filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }))
}

export function analyzeMigration(source: Dataset, target: Dataset, tenantSlug: string) {
  const findings: Finding[] = []
  const users = source.User || []; const targetUsers = target.User || []
  const targetById = new Map(targetUsers.map((row) => [String(row.id), row]))
  const targetByUsername = new Map(targetUsers.map((row) => [String(row.username).toLowerCase(), row]))
  const targetByEmail = new Map(targetUsers.filter((row) => row.email).map((row) => [String(row.email).toLowerCase(), row]))
  const userMappings = users.map((user) => {
    const sameId = targetById.get(String(user.id)); const sameUsername = targetByUsername.get(String(user.username).toLowerCase()); const sameEmail = user.email ? targetByEmail.get(String(user.email).toLowerCase()) : undefined
    let classification = 'SAFE_INSERT'
    if (sameId && normalized(sameId) && hash(sameId) === hash(user)) classification = 'SAFE_REUSE'
    else if (sameId || (sameUsername && sameUsername.id !== user.id) || (sameEmail && sameEmail.id !== user.id)) classification = 'BLOCKER'
    else if (sameUsername || sameEmail) classification = 'NEEDS_MAPPING'
    const targetRole = roleMap[String(user.role)]
    if (!targetRole) { classification = 'BLOCKER'; findings.push({ code: 'UNKNOWN_ROLE', severity: 'BLOCKER', model: 'User', detail: `${user.id}: ${String(user.role)}` }) }
    if (classification === 'BLOCKER') findings.push({ code: 'USER_COLLISION', severity: 'BLOCKER', model: 'User', detail: `${user.id}: collision ID/username/email` })
    const collisionReasons = [sameId ? 'ID' : null, sameUsername && sameUsername.id !== user.id ? 'USERNAME' : null, sameEmail && sameEmail.id !== user.id ? 'EMAIL' : null].filter(Boolean)
    return { userId: user.id, legacyRole: user.role, targetOrganizationRole: targetRole || null, driverId: user.driverId || null, isActive: user.isActive, authCompatible: Boolean(user.passwordHash), classification, collisionReasons, conflictingTargetUserIds: Array.from(new Set([sameId?.id, sameUsername?.id, sameEmail?.id].filter(Boolean))) }
  })

  for (const model of tenantModels) {
    const targetIds = new Set((target[model] || []).map((row) => String(row.id)))
    const collisions = (source[model] || []).filter((row) => targetIds.has(String(row.id)))
    if (collisions.length) findings.push({ code: 'MODEL_ID_COLLISION', severity: 'BLOCKER', model, detail: `${collisions.length} ID(s) déjà présents dans la cible` })
  }

  const uniqueSpecs: Array<[string, string]> = [['Mission', 'reference'], ['Truck', 'plateNumber'], ['Trailer', 'plateNumber'], ['Invoice', 'invoiceNumber'], ['ClientProfile', 'name'], ['IgnoredMailImport', 'previewKey'], ['ParkSpot', 'code'], ['DispatchOptimizationApplication', 'idempotencyKey']]
  for (const [model, key] of uniqueSpecs) for (const duplicate of duplicates(source[model] || [], key)) findings.push({ code: 'DUPLICATE_UNIQUE', severity: 'BLOCKER', model, detail: `${key}=${duplicate.value} (${duplicate.count})` })

  let relationTotal = 0; let relationValid = 0; const orphanDetails: Finding[] = []
  for (const [childModel, foreignKey, parentModel] of relations) {
    const parentIds = new Set((source[parentModel] || []).map((row) => String(row.id)))
    for (const row of source[childModel] || []) { const id = row[foreignKey]; if (id === null || id === undefined || id === '') continue; relationTotal += 1; if (parentIds.has(String(id))) relationValid += 1; else orphanDetails.push({ code: 'ORPHAN_RELATION', severity: 'BLOCKER', model: childModel, detail: `${row.id}.${foreignKey} -> ${parentModel}:${String(id)}` }) }
  }
  findings.push(...orphanDetails)

  for (const model of tenantModels) if (!(model in source)) findings.push({ code: 'MISSING_TENANT_MODEL_MAPPING', severity: 'BLOCKER', model, detail: 'Table absente du dataset source inspecté' })

  const invoices = source.Invoice || []; const invoiceLines = source.InvoiceLine || []; const invoiceMissions = source.InvoiceMission || []
  const invoiceIds = new Set(invoices.map((row) => String(row.id)))
  if (invoiceLines.some((row) => !invoiceIds.has(String(row.invoiceId))) || invoiceMissions.some((row) => !invoiceIds.has(String(row.invoiceId)))) findings.push({ code: 'BROKEN_INVOICE_RELATION', severity: 'BLOCKER', model: 'Invoice', detail: 'Ligne ou relation mission sans facture' })
  const invoiceTotal = invoices.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0)
  const statusCounts = Object.fromEntries(Array.from(new Set(invoices.map((row) => String(row.status)))).sort().map((status) => [status, invoices.filter((row) => row.status === status).length]))
  const storedRoutes = (source.Mission || []).map((row) => ({ distance: row.routeDistanceMeters, duration: row.routeDurationSeconds, polyline: row.routePolyline, provider: row.routeProvider }))
  const routesReusable = storedRoutes.filter((route) => route.distance && route.duration && route.provider).length
  const routesInsufficient = storedRoutes.filter((route) => (route.distance || route.duration || route.polyline) && !(route.distance && route.duration && route.provider)).length

  const fingerprintModels: Record<string, string[]> = {
    users: ['User'], missions: ['Mission'], assignments: ['MissionAssignment'], invoices: ['Invoice', 'InvoiceLine', 'InvoiceMission'],
    maintenance: ['MaintenanceRequest', 'MaintenanceStatusHistory', 'MaintenanceInterventionLine'], fleet: ['Driver', 'Truck', 'Trailer'], park: ['ParkSpot', 'ParkMovement', 'ParkInspection', 'ParkInspectionResult'],
  }
  const checksums = Object.fromEntries(Object.entries(fingerprintModels).map(([category, models]) => [category, hash(models.flatMap((model) => sortedRows(source[model] || []).map((row) => [model, row])))]))
  const idStrategy = Object.fromEntries(['Organization', 'OrganizationUser', ...tenantModels, 'User'].map((model) => [model, model === 'Organization' || model === 'OrganizationUser' ? 'REGENERATE_ID' : mustPreserve.has(model) ? 'MUST_PRESERVE_ID' : shouldPreserve.has(model as typeof tenantModels[number]) ? 'SHOULD_PRESERVE_ID' : 'REGENERATE_ID']))
  const counts = Object.fromEntries(sourceTables.map((table) => [table, (source[table] || []).length]))
  const mail = { sourceEmails: (source.MissionSourceEmail || []).length, ignoredImports: (source.IgnoredMailImport || []).length, withMessageId: (source.MissionSourceEmail || []).filter((row) => row.messageId).length, withPreviewKey: (source.MissionSourceEmail || []).filter((row) => row.previewKey).length }
  const maintenance = { requests: (source.MaintenanceRequest || []).length, history: (source.MaintenanceStatusHistory || []).length, lines: (source.MaintenanceInterventionLine || []).length, providerRequestIds: (source.MaintenanceRequest || []).filter((row) => row.providerRequestId).length, externalRequestIds: (source.MaintenanceRequest || []).filter((row) => row.externalRequestId).length, pdfUrls: (source.MaintenanceRequest || []).filter((row) => row.quotePdfUrl || row.invoicePdfUrl).length }
  const persistedUrls = [...invoices.map((row) => row.sourcePdfUrl), ...(source.MaintenanceRequest || []).flatMap((row) => [row.quotePdfUrl, row.invoicePdfUrl])]
  const nonNullUrls = persistedUrls.filter((value): value is string => typeof value === 'string' && value.length > 0)
  const urlProviders: Record<string, number> = {}
  for (const value of nonNullUrls) { let provider = 'INVALID'; try { const parsed = new URL(value); provider = parsed.hostname.includes('blob.vercel-storage.com') ? 'VERCEL_BLOB' : parsed.hostname } catch {} urlProviders[provider] = (urlProviders[provider] || 0) + 1 }
  const issuedSnapshots = invoices.filter((row) => row.direction === 'ISSUED')
  const snapshotFields = ['sellerName', 'sellerAddress', 'sellerVatNumber', 'sellerIban', 'sellerBic', 'sellerBankName', 'sellerBeneficiary']
  const billingConfig = { source: 'ISSUED_INVOICE_SNAPSHOTS', issuedSnapshots: issuedSnapshots.length, determinableFields: snapshotFields.filter((field) => issuedSnapshots.some((row) => row[field])), missingFields: snapshotFields.filter((field) => !issuedSnapshots.some((row) => row[field])), requiresManualConfirmation: true, sensitiveValuesIncluded: false }
  const go = findings.every((finding) => finding.severity !== 'BLOCKER')
  const businessFingerprint = hash({ counts, userMappings, findings, relationTotal, relationValid, invoiceTotal, statusCounts, checksums })
  return {
    tenantPlan: { id: `org-${tenantSlug}`, name: 'Novotralux', slug: tenantSlug, modules: ['PLANNING', 'MAP', 'PROFITABILITY', 'INVOICING', 'FLEET', 'INTELLIGENCE', 'ASSISTANT', 'MAINTENANCE'], branding: { displayName: 'Novotralux', accentColor: 'CONFIGURE_FROM_LEGACY_ASSET', logoUrl: 'CONFIGURE_FROM_LEGACY_ASSET' }, billingConfig: { source: 'INVOICE_SNAPSHOTS_AND_MANUAL_CONFIRMATION', requiresManualConfirmation: true }, integrations: [{ type: 'MAIL_INTAKE', enabledAtImport: false, secretRequired: true }, { type: 'SL_AUTOMOTIVE', enabledAtImport: false, secretRequired: true }], domain: { hostname: 'novotralux.eu', pathPrefix: '/dispatch', createNow: false } },
    counts, targetCounts: Object.fromEntries(targetInspectionTables.map((table) => [table, (target[table] || []).length])), userMappings, importOrder, idStrategy,
    tenantCoverage: { expected: tenantModels.length, covered: tenantModels.filter((model) => model in source).length, missing: tenantModels.filter((model) => !(model in source)) },
    relations: { total: relationTotal, valid: relationValid, orphaned: orphanDetails.length, orphans: orphanDetails },
    invoices: { count: invoices.length, lines: invoiceLines.length, missionLinks: invoiceMissions.length, totalAmount: Number(invoiceTotal.toFixed(2)), statusCounts, currencies: Array.from(new Set(invoices.map((row) => row.currency).filter(Boolean))).sort(), pdfUrls: invoices.filter((row) => row.sourcePdfUrl).length, snapshotsPreserved: true },
    billingConfig, mail, maintenance, documents: { totalReferences: persistedUrls.length, nonNull: nonNullUrls.length, null: persistedUrls.length - nonNullUrls.length, providers: urlProviders, remoteChecksPerformed: 0, verificationDeferredTo7E3: true }, routeCache: { reusable: routesReusable, insufficient: routesInsufficient, absent: storedRoutes.length - routesReusable - routesInsufficient }, checksums, findings, businessFingerprint, verdict: go ? 'GO' : 'NO_GO',
  }
}
