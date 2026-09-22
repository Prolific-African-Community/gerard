import assert from 'node:assert/strict'
import { analyzeMigration, sourceTables, tenantModels, type Dataset, type Row } from '../lib/legacy-migration/analyzer'

function validSource(): Dataset {
  const source = Object.fromEntries(sourceTables.map((table) => [table, []])) as Dataset
  source.User = [{ id: 'user-1', username: 'legacy', email: 'legacy@example.test', role: 'ADMIN', driverId: 'driver-1', isActive: true, passwordHash: 'scrypt:valid' }]
  source.Driver = [{ id: 'driver-1', name: 'Driver' }]
  source.Truck = [{ id: 'truck-1', plateNumber: 'AA-001' }]
  source.Trailer = [{ id: 'trailer-1', plateNumber: 'BB-001' }]
  source.Mission = [{ id: 'mission-1', reference: 'MISSION-1', routeDistanceMeters: 1000, routeDurationSeconds: 60, routeProvider: 'GOOGLE_ROUTES' }]
  source.MissionAssignment = [{ id: 'assignment-1', missionId: 'mission-1', driverId: 'driver-1', truckId: 'truck-1', trailerId: 'trailer-1' }]
  source.Invoice = [{ id: 'invoice-1', invoiceNumber: 'INV-1', status: 'ISSUED', totalAmount: 100, currency: 'EUR', sellerName: 'Legacy Legal', sourcePdfUrl: 'https://blob.example.test/invoice.pdf' }]
  source.InvoiceLine = [{ id: 'line-1', invoiceId: 'invoice-1' }]
  source.InvoiceMission = [{ id: 'link-1', invoiceId: 'invoice-1', missionId: 'mission-1' }]
  source.MaintenanceRequest = [{ id: 'maintenance-1', truckId: 'truck-1' }]
  source.MaintenanceStatusHistory = [{ id: 'history-1', maintenanceRequestId: 'maintenance-1' }]
  source.MaintenanceInterventionLine = [{ id: 'maintenance-line-1', maintenanceRequestId: 'maintenance-1' }]
  source.MissionSourceEmail = [{ id: 'mail-1', missionId: 'mission-1', messageId: 'message-1', previewKey: 'preview-1' }]
  return source
}
function targetUser(patch: Row): Dataset { return { User: [{ id: 'target-user', username: 'target', email: 'target@example.test', ...patch }] } }
function codes(result: ReturnType<typeof analyzeMigration>) { return result.findings.map((finding) => finding.code) }

const valid = analyzeMigration(validSource(), {}, 'novotralux')
assert.equal(valid.verdict, 'GO', 'A valid source should be GO')
assert.equal(valid.relations.orphaned, 0)
assert.equal(valid.tenantCoverage.covered, tenantModels.length)

assert.equal(analyzeMigration(validSource(), targetUser({ username: 'legacy' }), 'novotralux').verdict, 'NO_GO', 'B username collision')
assert.equal(analyzeMigration(validSource(), targetUser({ email: 'legacy@example.test' }), 'novotralux').verdict, 'NO_GO', 'C email collision')

const orphan = validSource(); orphan.MissionAssignment[0].missionId = 'missing'
assert.ok(codes(analyzeMigration(orphan, {}, 'novotralux')).includes('ORPHAN_RELATION'), 'D orphan relation')
const duplicateMission = validSource(); duplicateMission.Mission.push({ id: 'mission-2', reference: 'MISSION-1' })
assert.ok(codes(analyzeMigration(duplicateMission, {}, 'novotralux')).includes('DUPLICATE_UNIQUE'), 'E duplicate mission')
const duplicatePlate = validSource(); duplicatePlate.Truck.push({ id: 'truck-2', plateNumber: 'AA-001' })
assert.ok(codes(analyzeMigration(duplicatePlate, {}, 'novotralux')).includes('DUPLICATE_UNIQUE'), 'F duplicate plate')
const unknownRole = validSource(); unknownRole.User[0].role = 'ALIEN'
assert.ok(codes(analyzeMigration(unknownRole, {}, 'novotralux')).includes('UNKNOWN_ROLE'), 'G unknown role')
const brokenInvoice = validSource(); brokenInvoice.InvoiceLine[0].invoiceId = 'missing'
assert.ok(codes(analyzeMigration(brokenInvoice, {}, 'novotralux')).includes('BROKEN_INVOICE_RELATION'), 'H broken invoice')
const missingModel = validSource(); delete missingModel.ParkMovement
assert.ok(codes(analyzeMigration(missingModel, {}, 'novotralux')).includes('MISSING_TENANT_MODEL_MAPPING'), 'I missing tenant model')

const repeatA = analyzeMigration(validSource(), {}, 'novotralux')
const repeatB = analyzeMigration(validSource(), {}, 'novotralux')
assert.equal(repeatA.businessFingerprint, repeatB.businessFingerprint, 'J repeated dry-runs must match')
console.log('A-J legacy migrator fixtures and deterministic manifest fingerprint: OK')
