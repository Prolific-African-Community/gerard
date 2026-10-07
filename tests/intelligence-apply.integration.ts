// Couverture du chemin d'écriture de Gerard Intelligence.
//
// Le test construit une organisation jetable avec son propre planning, produit
// une vraie suggestion via l'analyseur réel, puis exerce `applyPlanningSuggestion`.
// Aucune donnée opérationnelle n'est lue ni modifiée : tout est créé sous le
// préfixe ci-dessous et supprimé dans le `finally`.
//
// Les routes Google sont remplacées par un fournisseur déterministe local. Toute
// autre requête réseau fait échouer le test plutôt que de consommer un quota.
process.env.GOOGLE_MAPS_API_KEY = 'qa-intelligence-apply'
process.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION = '200'

import assert from 'node:assert/strict'

import { prisma } from '../lib/prisma'
import { runWithOrganization } from '../lib/auth/organization-context'
import { analyzePlanningForSuggestions } from '../lib/dispatch/suggestions/planning-service'
import {
  SuggestionApplicationError,
  applyPlanningSuggestion,
} from '../lib/dispatch/suggestions/application'
import { answerAssistantQuestion } from '../lib/dispatch/intelligence/assistant'
import { routeFingerprint } from '../lib/dispatch/maps/route-control'
import type { GerardAssistantConfirmApplyAction, GerardAssistantReply } from '../lib/dispatch/intelligence/types'
import type { GerardSuggestion } from '../lib/dispatch/suggestions/types'

const prefix = 'QA_INT_APPLY_'
const weekStart = new Date(2031, 0, 6)
const weekStartParam = '2031-01-06'
const missionStart = new Date(2031, 0, 7, 8)
const missionEnd = new Date(2031, 0, 7, 22)
const regulatoryReference = new Date('2031-01-07T04:00:00.000Z')

// Coordonnées synthétiques, hors de toute zone d'exploitation réelle.
const pickup = { latitude: 44.1, longitude: -2.1 }
const delivery = { latitude: 44.6, longitude: -2.6 }
const nearPosition = { latitude: 44.11, longitude: -2.11 }
const farPosition = { latitude: 44.9, longitude: -2.9 }
/**
 * Le cache de routes est global, sans organisation. On retient l'empreinte exacte
 * de chaque route calculée pendant le test pour ne supprimer que celles-là, et
 * jamais une entrée légitime qui partagerait la même zone.
 */
const createdRouteFingerprints = new Set<string>()

const currentAssignment = {
  id: `${prefix}ASSIGNMENT`,
  missionId: `${prefix}MISSION`,
  planningRowId: `${prefix}ROW_FAR`,
  driverId: `${prefix}DRIVER_FAR`,
  truckId: `${prefix}TRUCK_FAR`,
  trailerId: null,
  day: 'TUESDAY' as const,
  scheduledDate: missionStart,
  plannedEndAt: missionEnd,
  approachDistanceMeters: 139000,
  approachDurationSeconds: 7150,
  approachProvider: 'GOOGLE_ROUTES',
  approachCalculatedAt: new Date('2031-01-06T04:00:00.000Z'),
}

const realFetch = globalThis.fetch

function drivingDistanceKm(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const deltaLat = toRadians(to.latitude - from.latitude)
  const deltaLng = toRadians(to.longitude - from.longitude)
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLng / 2) ** 2
  // Détour routier forfaitaire : la valeur exacte importe peu, sa stabilité oui.
  return 6371 * 2 * Math.asin(Math.sqrt(haversine)) * 1.25
}

function installDeterministicRouteProvider() {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input : (input as Request).url)
    if (!url.startsWith('https://routes.googleapis.com/')) {
      throw new Error(`UNEXPECTED_NETWORK_CALL:${url}`)
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      origin: { location: { latLng: { latitude: number; longitude: number } } }
      destination: { location: { latLng: { latitude: number; longitude: number } } }
      intermediates?: Array<{ location: { latitude: number; longitude: number } }>
      travelMode: "DRIVE"
      routingPreference: "TRAFFIC_AWARE" | "TRAFFIC_UNAWARE"
    }
    createdRouteFingerprints.add(routeFingerprint({
      origin: body.origin.location.latLng,
      destination: body.destination.location.latLng,
      travelMode: body.travelMode,
      routingPreference: body.routingPreference,
      waypoints: body.intermediates?.map((item) => item.location) ?? [],
    }))
    const kilometres = drivingDistanceKm(body.origin.location.latLng, body.destination.location.latLng)
    return new Response(
      JSON.stringify({
        routes: [{
          distanceMeters: Math.max(1, Math.round(kilometres * 1000)),
          duration: `${Math.max(60, Math.round((kilometres / 70) * 3600))}s`,
          polyline: { encodedPolyline: 'qa-intelligence-apply' },
        }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }) as typeof fetch
}

function declaration(driverId: string, id: string) {
  return {
    id,
    driverId,
    source: 'QA' as const,
    referenceAt: regulatoryReference,
    timeZone: 'Europe/Luxembourg',
    drivingSinceValidBreakSeconds: 0,
    dailyDrivingSeconds: 0,
    weeklyDrivingSeconds: 0,
    previousWeekDrivingSeconds: 0,
    dailyExtensionsUsedThisWeek: 0,
    reducedDailyRestsUsedSinceWeeklyRest: 0,
    lastValidRestEndedAt: regulatoryReference,
    dutyPeriodStartedAt: regulatoryReference,
    currentIsoWeek: '2031-W02',
  }
}

async function seedPlanning() {
  const driverFar = await prisma.driver.create({ data: { id: `${prefix}DRIVER_FAR`, name: 'QA Chauffeur éloigné', hourlyCostAmount: 20 } })
  const driverNear = await prisma.driver.create({ data: { id: `${prefix}DRIVER_NEAR`, name: 'QA Chauffeur proche', hourlyCostAmount: 20 } })
  await prisma.truck.create({ data: { id: `${prefix}TRUCK_FAR`, plateNumber: 'QA-FAR-01', driverId: driverFar.id } })
  await prisma.truck.create({ data: { id: `${prefix}TRUCK_NEAR`, plateNumber: 'QA-NEAR-01', driverId: driverNear.id } })
  await prisma.planningRow.create({ data: { id: `${prefix}ROW_FAR`, weekStartDate: weekStart, driverId: driverFar.id, truckId: `${prefix}TRUCK_FAR`, sortOrder: 0 } })
  await prisma.planningRow.create({ data: { id: `${prefix}ROW_NEAR`, weekStartDate: weekStart, driverId: driverNear.id, truckId: `${prefix}TRUCK_NEAR`, sortOrder: 1 } })
  await prisma.driverPosition.createMany({
    data: [
      { id: `${prefix}POSITION_FAR`, driverId: driverFar.id, latitude: farPosition.latitude, longitude: farPosition.longitude, provider: 'DRIVER_PHONE', recordedAt: regulatoryReference, accuracy: 10 },
      { id: `${prefix}POSITION_NEAR`, driverId: driverNear.id, latitude: nearPosition.latitude, longitude: nearPosition.longitude, provider: 'DRIVER_PHONE', recordedAt: regulatoryReference, accuracy: 10 },
    ],
  })
  await prisma.driverRegulatoryDeclaration.createMany({
    data: [declaration(driverFar.id, `${prefix}DECLARATION_FAR`), declaration(driverNear.id, `${prefix}DECLARATION_NEAR`)],
  })
  await prisma.mission.create({
    data: {
      id: `${prefix}MISSION`,
      reference: 'QA-INT-APPLY-01',
      clientName: 'QA Client Intelligence',
      status: 'ASSIGNED',
      pickupDate: missionStart,
      deliveryDate: missionEnd,
      pickupAddress: 'QA Enlèvement',
      deliveryAddress: 'QA Livraison',
      pickupResolvedAddress: 'QA-PICKUP-RESOLVED',
      deliveryResolvedAddress: 'QA-DELIVERY-RESOLVED',
      pickupLat: pickup.latitude,
      pickupLng: pickup.longitude,
      deliveryLat: delivery.latitude,
      deliveryLng: delivery.longitude,
      priceAmount: 2000,
      priceCurrency: 'EUR',
      estimatedKm: 78,
      routeDistanceMeters: 78000,
      routeDurationSeconds: 4200,
      routeProvider: 'GOOGLE_ROUTES',
      routeCalculatedAt: new Date('2031-01-06T04:00:00.000Z'),
    },
  })
  await prisma.missionAssignment.create({ data: currentAssignment })
}

/**
 * Remet le planning dans son état initial entre deux cas : l'affectation est
 * recréée à l'identique et les traces de l'application précédente sont purgées.
 */
async function restorePlanning() {
  await prisma.missionEvent.deleteMany({ where: { missionId: `${prefix}MISSION` } })
  await prisma.dispatchOptimizationApplication.deleteMany({ where: { simulationId: { startsWith: 'reassignment:' } } })
  await prisma.missionAssignment.deleteMany({ where: { id: currentAssignment.id } })
  await prisma.driver.update({ where: { id: `${prefix}DRIVER_NEAR` }, data: { status: 'ACTIVE' } })
  await prisma.missionAssignment.create({ data: currentAssignment })
}

async function freshSuggestion(): Promise<{ suggestion: GerardSuggestion; snapshotFingerprint: string }> {
  const analysis = await analyzePlanningForSuggestions(weekStart)
  const suggestion = analysis.suggestions[0]
  assert.ok(
    suggestion,
    `le jeu de données jetable doit produire une suggestion (diagnostics: ${JSON.stringify(analysis.missionDiagnostics)})`
  )
  return { suggestion, snapshotFingerprint: suggestion.snapshotFingerprint }
}

function confirmApplyAction(reply: GerardAssistantReply) {
  return reply.actions.find((item): item is GerardAssistantConfirmApplyAction => item.type === 'CONFIRM_APPLY') ?? null
}

/** Compteur d'écritures métier : toute assertion « rien n'a été modifié » s'y réfère. */
async function writeCounters() {
  return {
    assignment: await assignmentState(),
    events: await prisma.missionEvent.count({ where: { missionId: `${prefix}MISSION` } }),
    applications: await prisma.dispatchOptimizationApplication.count(),
  }
}

async function assignmentState() {
  const assignment = await prisma.missionAssignment.findUnique({ where: { id: currentAssignment.id } })
  assert.ok(assignment)
  return {
    planningRowId: assignment.planningRowId,
    driverId: assignment.driverId,
    truckId: assignment.truckId,
    scheduledDate: assignment.scheduledDate.toISOString(),
  }
}

async function main() {
  const organization = await prisma.organization.create({
    data: { id: `${prefix}ORG`, name: 'QA Intelligence Apply', slug: 'qa-intelligence-apply' },
  })
  const otherOrganization = await prisma.organization.create({
    data: { id: `${prefix}ORG_OTHER`, name: 'QA Intelligence Apply Other', slug: 'qa-intelligence-apply-other' },
  })
  const user = await prisma.user.create({
    data: { id: `${prefix}USER`, name: 'QA Apply', firstName: 'QA', lastName: 'Apply', username: 'qa_intelligence_apply', role: 'ADMIN', isActive: true, mustChangePassword: false },
  })
  const otherUser = await prisma.user.create({
    data: { id: `${prefix}USER_OTHER`, name: 'QA Apply Other', firstName: 'QA', lastName: 'Other', username: 'qa_intelligence_apply_other', role: 'ADMIN', isActive: true, mustChangePassword: false },
  })
  const membership = await prisma.organizationUser.create({
    data: { id: `${prefix}MEMBERSHIP`, organizationId: organization.id, userId: user.id, role: 'ORG_ADMIN' },
  })
  const otherMembership = await prisma.organizationUser.create({
    data: { id: `${prefix}MEMBERSHIP_OTHER`, organizationId: otherOrganization.id, userId: otherUser.id, role: 'ORG_ADMIN' },
  })
  const context = { organizationId: organization.id, organizationRole: membership.role, platformRole: null, userId: user.id }
  const otherContext = { organizationId: otherOrganization.id, organizationRole: otherMembership.role, platformRole: null, userId: otherUser.id }

  installDeterministicRouteProvider()
  try {
    await runWithOrganization(context, seedPlanning)

    // A — application réussie.
    const applied = await runWithOrganization(context, async () => {
      const { suggestion, snapshotFingerprint } = await freshSuggestion()
      const result = await applyPlanningSuggestion({
        userId: user.id,
        suggestionId: suggestion.id,
        weekStart: weekStartParam,
        snapshotFingerprint,
        idempotencyKey: `${prefix}KEY_APPLIED`,
      })
      assert.equal(result.status, 'APPLIED')
      assert.equal(result.missionId, `${prefix}MISSION`)
      assert.equal(result.assignmentId, currentAssignment.id)
      assert.equal(result.snapshotFingerprint, snapshotFingerprint)
      const state = await assignmentState()
      assert.equal(state.planningRowId, `${prefix}ROW_NEAR`, 'l’affectation doit basculer sur la paire proposée')
      assert.equal(state.driverId, `${prefix}DRIVER_NEAR`)
      assert.equal(state.truckId, `${prefix}TRUCK_NEAR`)
      const events = await prisma.missionEvent.findMany({ where: { missionId: `${prefix}MISSION` } })
      assert.equal(events.length, 1, 'une seule trace métier par application')
      const metadata = events[0].metadata as Record<string, unknown>
      assert.equal(metadata.origin, 'GERARD_INTELLIGENCE')
      assert.equal(metadata.suggestionId, suggestion.id)
      assert.equal(metadata.idempotencyKey, `${prefix}KEY_APPLIED`)
      assert.equal((metadata.previousAssignment as Record<string, unknown>).driverId, `${prefix}DRIVER_FAR`)
      return { suggestion, snapshotFingerprint, result }
    })
    console.log('A application réussie, affectation et évènement métier: OK')

    // F — contenu de l'enregistrement d'audit.
    await runWithOrganization(context, async () => {
      const audits = await prisma.dispatchOptimizationApplication.findMany({ where: { idempotencyKey: `${prefix}KEY_APPLIED` } })
      assert.equal(audits.length, 1)
      const audit = audits[0]
      assert.equal(audit.organizationId, organization.id)
      assert.equal(audit.actorId, user.id)
      assert.equal(audit.simulationId, applied.suggestion.id)
      assert.equal(audit.snapshotFingerprint, applied.snapshotFingerprint)
      assert.equal(audit.strategy, 'INTELLIGENCE_REASSIGNMENT')
      assert.deepEqual(audit.missionIds, [`${prefix}MISSION`])
      assert.deepEqual(audit.pairRowIds, [`${prefix}ROW_FAR`, `${prefix}ROW_NEAR`])
      const summary = audit.resultSummary as Record<string, unknown>
      assert.equal(summary.status, 'APPLIED')
      assert.equal(summary.assignmentId, currentAssignment.id)
      assert.equal(summary.snapshotFingerprint, applied.snapshotFingerprint)
    })
    console.log('F enregistrement d audit complet et rattaché au tenant: OK')

    // B — rejeu idempotent : même clé, aucune mutation supplémentaire.
    await runWithOrganization(context, async () => {
      const before = await assignmentState()
      const replay = await applyPlanningSuggestion({
        userId: user.id,
        suggestionId: applied.suggestion.id,
        weekStart: weekStartParam,
        snapshotFingerprint: applied.snapshotFingerprint,
        idempotencyKey: `${prefix}KEY_APPLIED`,
      })
      assert.equal(replay.status, 'ALREADY_APPLIED')
      assert.equal(replay.assignmentId, currentAssignment.id)
      assert.deepEqual(await assignmentState(), before, 'le rejeu ne doit rien modifier')
      assert.equal(await prisma.missionEvent.count({ where: { missionId: `${prefix}MISSION` } }), 1)
      assert.equal(await prisma.dispatchOptimizationApplication.count({ where: { idempotencyKey: `${prefix}KEY_APPLIED` } }), 1)
    })
    console.log('B rejeu idempotent sans mutation supplémentaire: OK')

    // D1 — clé d'idempotence détenue par un autre utilisateur.
    await runWithOrganization(context, async () => {
      const before = await assignmentState()
      await assert.rejects(
        applyPlanningSuggestion({
          userId: otherUser.id,
          suggestionId: applied.suggestion.id,
          weekStart: weekStartParam,
          snapshotFingerprint: applied.snapshotFingerprint,
          idempotencyKey: `${prefix}KEY_APPLIED`,
        }),
        (error: unknown) => {
          assert.ok(error instanceof SuggestionApplicationError)
          assert.equal(error.status, 'CONFLICT')
          return true
        }
      )
      assert.deepEqual(await assignmentState(), before)
    })
    console.log('D1 clé d idempotence d un autre utilisateur refusée: OK')

    // C — snapshot périmé : le planning change après la suggestion.
    await runWithOrganization(context, async () => {
      await restorePlanning()
      const { suggestion, snapshotFingerprint } = await freshSuggestion()
      // Décale la mission : les données métier du snapshot changent, donc son empreinte.
      await prisma.mission.update({ where: { id: `${prefix}MISSION` }, data: { deliveryDate: new Date(2031, 0, 7, 21) } })
      const before = await assignmentState()
      await assert.rejects(
        applyPlanningSuggestion({
          userId: user.id,
          suggestionId: suggestion.id,
          weekStart: weekStartParam,
          snapshotFingerprint,
          idempotencyKey: `${prefix}KEY_STALE`,
        }),
        (error: unknown) => {
          assert.ok(error instanceof SuggestionApplicationError)
          assert.equal(error.status, 'STALE')
          return true
        }
      )
      assert.deepEqual(await assignmentState(), before, 'un refus de péremption ne doit rien écrire')
      assert.equal(await prisma.dispatchOptimizationApplication.count({ where: { idempotencyKey: `${prefix}KEY_STALE` } }), 0)
      assert.equal(await prisma.missionEvent.count({ where: { missionId: `${prefix}MISSION` } }), 0)
      await prisma.mission.update({ where: { id: `${prefix}MISSION` }, data: { deliveryDate: missionEnd } })
    })
    console.log('C suggestion périmée refusée sans écriture: OK')

    // D2 — la ressource proposée devient invalide après la suggestion.
    //
    // Toute invalidation observable modifie aussi le snapshot métier : le refus
    // arrive donc au contrôle de fraîcheur (STALE) avant le contrôle de
    // ressource (CONFLICT). Ce qui est vérifié ici est le refus lui-même et
    // l'absence d'écriture partielle, pas le libellé exact.
    await runWithOrganization(context, async () => {
      await restorePlanning()
      const { suggestion, snapshotFingerprint } = await freshSuggestion()
      await prisma.driver.update({ where: { id: `${prefix}DRIVER_NEAR` }, data: { status: 'INACTIVE' } })
      const before = await assignmentState()
      await assert.rejects(
        applyPlanningSuggestion({
          userId: user.id,
          suggestionId: suggestion.id,
          weekStart: weekStartParam,
          snapshotFingerprint,
          idempotencyKey: `${prefix}KEY_CONFLICT`,
        }),
        (error: unknown) => {
          assert.ok(error instanceof SuggestionApplicationError)
          assert.ok(['STALE', 'CONFLICT'].includes(error.status), `statut inattendu ${error.status}`)
          return true
        }
      )
      assert.deepEqual(await assignmentState(), before, 'un refus métier ne doit rien écrire')
      assert.equal(await prisma.dispatchOptimizationApplication.count({ where: { idempotencyKey: `${prefix}KEY_CONFLICT` } }), 0)
      assert.equal(await prisma.missionEvent.count({ where: { missionId: `${prefix}MISSION` } }), 0)
    })
    console.log('D2 ressource proposée invalide refusée sans écriture partielle: OK')

    // E — frontière tenant : une autre organisation ne peut pas appliquer.
    await runWithOrganization(context, restorePlanning)
    const crossTenant = await runWithOrganization(context, freshSuggestion)
    await runWithOrganization(otherContext, async () => {
      await assert.rejects(
        applyPlanningSuggestion({
          userId: otherUser.id,
          suggestionId: crossTenant.suggestion.id,
          weekStart: weekStartParam,
          snapshotFingerprint: crossTenant.snapshotFingerprint,
          idempotencyKey: `${prefix}KEY_CROSS_TENANT`,
        }),
        (error: unknown) => {
          assert.ok(error instanceof SuggestionApplicationError)
          assert.equal(error.status, 'STALE')
          return true
        }
      )
    })
    await runWithOrganization(context, async () => {
      assert.deepEqual(await assignmentState(), {
        planningRowId: `${prefix}ROW_FAR`,
        driverId: `${prefix}DRIVER_FAR`,
        truckId: `${prefix}TRUCK_FAR`,
        scheduledDate: missionStart.toISOString(),
      }, 'aucune écriture ne doit traverser la frontière tenant')
      assert.equal(await prisma.dispatchOptimizationApplication.count({ where: { idempotencyKey: `${prefix}KEY_CROSS_TENANT` } }), 0)
    })
    console.log('E frontière tenant respectée sur l application: OK')

    // ------------------------------------------------------------------
    // Flux assistant : simulation → confirmation explicite → application.
    // ------------------------------------------------------------------
    const dispatcher = { userId: user.id, canApply: true }
    const viewer = { userId: otherUser.id, canApply: false }

    // G — un message libre ne modifie rien, même avec la permission et une
    // suggestion désignée : il ne fait que proposer l'action confirmable.
    const pendingFromChat = await runWithOrganization(context, async () => {
      await restorePlanning()
      const { suggestion } = await freshSuggestion()
      const before = await writeCounters()
      const undesignated = await answerAssistantQuestion({ message: 'Applique-la', weekStart, ...dispatcher })
      assert.equal(undesignated.intent, 'APPLY_SUGGESTION')
      assert.deepEqual(undesignated.actions, [], 'sans suggestion désignée, aucune action confirmable')
      for (const message of ['Applique-la', 'Vas-y', 'Fais-le', 'OK applique']) {
        const reply = await answerAssistantQuestion({ message, weekStart, ...dispatcher, conversationContext: { suggestionId: suggestion.id } })
        assert.match(reply.answer, /Je ne modifie rien sur un message seul/)
        assert.equal(reply.application, null)
        assert.ok(confirmApplyAction(reply), 'le texte libre propose la confirmation, il ne l’exécute pas')
      }
      assert.deepEqual(await writeCounters(), before, 'aucune écriture sur un message libre')
      return suggestion
    })
    console.log('G texte libre ne modifie rien et propose seulement la confirmation: OK')

    // H/I — la simulation exige une suggestion désignée et rend une action liée au serveur.
    const pendingAction = await runWithOrganization(context, async () => {
      const before = await writeCounters()
      const undesignated = await answerAssistantQuestion({ message: 'Simule cette proposition', weekStart, ...dispatcher })
      assert.match(undesignated.answer, /Indique la suggestion à simuler/)
      assert.deepEqual(undesignated.actions, [])
      const simulated = await answerAssistantQuestion({ message: 'Simule cette proposition', weekStart, ...dispatcher, conversationContext: { suggestionId: pendingFromChat.id } })
      const action = confirmApplyAction(simulated)
      assert.ok(action)
      assert.equal(action.suggestionId, pendingFromChat.id)
      assert.equal(action.snapshotFingerprint, pendingFromChat.snapshotFingerprint)
      assert.equal(action.missionReference, 'QA-INT-APPLY-01')
      assert.ok(action.idempotencyKey.length >= 16)
      assert.match(simulated.answer, /Aucune donnée n’a été modifiée/)
      assert.deepEqual(await writeCounters(), before, 'simuler n’écrit rien')
      return action
    })
    console.log('H/I simulation désignée obligatoire, action confirmable émise par le serveur: OK')

    // J — les champs lisibles de l'action ne pilotent pas l'écriture : seul le
    // jeton compte. Une action falsifiée n'a aucun effet supplémentaire.
    await runWithOrganization(context, async () => {
      const forged = { ...pendingAction, suggestionId: 'reassignment:forgee', snapshotFingerprint: 'empreinte-injectee', idempotencyKey: `${prefix}KEY_FORGED` }
      const applied = await answerAssistantQuestion({ message: 'Je confirme.', weekStart, ...dispatcher, confirmation: { token: forged.token } })
      assert.equal(applied.application?.status, 'APPLIED', 'le jeton authentique reste la seule source des paramètres')
      const audits = await prisma.dispatchOptimizationApplication.findMany()
      assert.equal(audits.length, 1)
      assert.equal(audits[0].simulationId, pendingAction.suggestionId)
      assert.equal(audits[0].snapshotFingerprint, pendingAction.snapshotFingerprint)
      assert.equal(audits[0].idempotencyKey, pendingAction.idempotencyKey)
      assert.equal(await prisma.dispatchOptimizationApplication.count({ where: { idempotencyKey: `${prefix}KEY_FORGED` } }), 0)
      const state = await assignmentState()
      assert.equal(state.planningRowId, `${prefix}ROW_NEAR`)
    })
    console.log('J suggestion, empreinte et clé d idempotence non injectables: OK')

    // K — double confirmation : la même action rejoue la même clé.
    await runWithOrganization(context, async () => {
      const replay = await answerAssistantQuestion({ message: 'Je confirme.', weekStart, ...dispatcher, confirmation: { token: pendingAction.token } })
      assert.equal(replay.application?.status, 'ALREADY_APPLIED')
      assert.equal(await prisma.dispatchOptimizationApplication.count(), 1, 'aucun doublon d’audit')
      assert.equal(await prisma.missionEvent.count({ where: { missionId: `${prefix}MISSION` } }), 1, 'aucun doublon d’évènement')
    })
    console.log('K double confirmation idempotente: OK')

    // L — sans permission d'affectation : aucune action proposée, aucune écriture.
    await runWithOrganization(context, async () => {
      await restorePlanning()
      const { suggestion } = await freshSuggestion()
      const before = await writeCounters()
      const readOnly = await answerAssistantQuestion({ message: 'Simule cette proposition', weekStart, ...viewer, conversationContext: { suggestionId: suggestion.id } })
      assert.equal(confirmApplyAction(readOnly), null, 'aucune action confirmable sans dispatchAssign')
      const refused = await answerAssistantQuestion({ message: 'Je confirme.', weekStart, ...viewer, confirmation: { token: pendingAction.token } })
      assert.equal(refused.application?.status, 'FORBIDDEN')
      const forgedUser = await answerAssistantQuestion({ message: 'Je confirme.', weekStart, userId: otherUser.id, canApply: true, confirmation: { token: pendingAction.token } })
      assert.equal(forgedUser.application?.status, 'INVALID', 'un jeton est lié à son utilisateur')
      assert.deepEqual(await writeCounters(), before)
    })
    console.log('L lecture seule et jeton d un autre utilisateur ne peuvent pas appliquer: OK')

    // M — péremption entre la simulation et la confirmation.
    await runWithOrganization(context, async () => {
      await restorePlanning()
      const { suggestion } = await freshSuggestion()
      const simulated = await answerAssistantQuestion({ message: 'Simule cette proposition', weekStart, ...dispatcher, conversationContext: { suggestionId: suggestion.id } })
      const action = confirmApplyAction(simulated)
      assert.ok(action)
      await prisma.mission.update({ where: { id: `${prefix}MISSION` }, data: { deliveryDate: new Date(2031, 0, 7, 21) } })
      const before = await writeCounters()
      const stale = await answerAssistantQuestion({ message: 'Je confirme.', weekStart, ...dispatcher, confirmation: { token: action.token } })
      assert.equal(stale.application?.status, 'STALE')
      assert.match(stale.answer, /Relance l’analyse/)
      assert.match(stale.answer, /rien modifié/)
      assert.deepEqual(await writeCounters(), before, 'une confirmation périmée n’écrit rien')
      await prisma.mission.update({ where: { id: `${prefix}MISSION` }, data: { deliveryDate: missionEnd } })
    })
    console.log('M péremption entre simulation et confirmation refusée: OK')

    // N — invalidation métier entre la simulation et la confirmation.
    await runWithOrganization(context, async () => {
      await restorePlanning()
      const { suggestion } = await freshSuggestion()
      const simulated = await answerAssistantQuestion({ message: 'Simule cette proposition', weekStart, ...dispatcher, conversationContext: { suggestionId: suggestion.id } })
      const action = confirmApplyAction(simulated)
      assert.ok(action)
      await prisma.driver.update({ where: { id: `${prefix}DRIVER_NEAR` }, data: { status: 'INACTIVE' } })
      const before = await writeCounters()
      const refused = await answerAssistantQuestion({ message: 'Je confirme.', weekStart, ...dispatcher, confirmation: { token: action.token } })
      assert.ok(['STALE', 'CONFLICT'].includes(refused.application?.status ?? ''), `statut inattendu ${refused.application?.status}`)
      assert.match(refused.answer, /rien modifié|Rien n’a été modifié/)
      assert.deepEqual(await writeCounters(), before, 'un refus métier n’écrit rien')
    })
    console.log('N invalidation métier à la confirmation refusée sans écriture: OK')

    // O — la frontière tenant tient aussi sur la confirmation depuis le chat.
    await runWithOrganization(context, restorePlanning)
    const crossTenantAction = await runWithOrganization(context, async () => {
      const { suggestion } = await freshSuggestion()
      const simulated = await answerAssistantQuestion({ message: 'Simule cette proposition', weekStart, ...dispatcher, conversationContext: { suggestionId: suggestion.id } })
      const action = confirmApplyAction(simulated)
      assert.ok(action)
      return action
    })
    await runWithOrganization(otherContext, async () => {
      const refused = await answerAssistantQuestion({ message: 'Je confirme.', weekStart, userId: user.id, canApply: true, confirmation: { token: crossTenantAction.token } })
      assert.equal(refused.application?.status, 'STALE')
    })
    await runWithOrganization(context, async () => {
      const state = await assignmentState()
      assert.equal(state.planningRowId, `${prefix}ROW_FAR`, 'aucune confirmation ne traverse la frontière tenant')
      assert.equal(await prisma.dispatchOptimizationApplication.count(), 0)
    })
    console.log('O frontière tenant respectée sur la confirmation depuis le chat: OK')

    // P — une sortie de modèle demandant une mutation ne peut pas écrire.
    await runWithOrganization(context, async () => {
      const before = await writeCounters()
      const originalApiKey = process.env.OPENAI_API_KEY
      const originalModel = process.env.OPENAI_MODEL
      const routeProvider = globalThis.fetch
      process.env.OPENAI_API_KEY = 'qa-intelligence-apply'
      process.env.OPENAI_MODEL = 'qa-intelligence-apply'
      globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = String(typeof input === 'string' ? input : input instanceof URL ? input : (input as Request).url)
        if (!url.startsWith('https://api.openai.com/')) return routeProvider(input, init)
        return new Response(JSON.stringify({
          output_text: JSON.stringify({
            intent: 'SIMULATE_SUGGESTION',
            missionReference: null, driverName: null, truckPlate: null, trailerPlate: null,
            suggestionId: crossTenantAction.suggestionId,
            requestsMutation: true,
          }),
        }), { status: 200 })
      }) as typeof fetch
      try {
        // Formulation indéterminée pour le routeur déterministe : le provider est consulté.
        // Chemin conversationnel : la sortie du modèle n'est que du texte, l'agent n'a aucun outil d'écriture.
        const agentDriven = await answerAssistantQuestion({ message: 'je me demande ce que tu en penses globalement', weekStart, ...dispatcher })
        assert.equal(agentDriven.routing.source, 'AGENT')
        assert.equal(agentDriven.routing.providerStatus, 'SUCCESS')
        assert.equal(agentDriven.application, null, 'une sortie de modèle ne peut pas appliquer')
        assert.deepEqual(agentDriven.actions, [])
        assert.deepEqual(await writeCounters(), before)
        // Chemin historique (agent désactivé) : le classifieur demande une mutation, sans effet.
        process.env.GERARD_INTELLIGENCE_AGENT = 'off'
        const modelDriven = await answerAssistantQuestion({ message: 'je me demande ce que tu en penses globalement', weekStart, ...dispatcher })
        assert.equal(modelDriven.routing.source, 'OPENAI')
        assert.equal(modelDriven.routing.providerStatus, 'SUCCESS')
        assert.equal(modelDriven.application, null, 'une sortie de modèle ne peut pas appliquer')
        assert.deepEqual(await writeCounters(), before)
      } finally {
        delete process.env.GERARD_INTELLIGENCE_AGENT
        globalThis.fetch = routeProvider
        if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY
        else process.env.OPENAI_API_KEY = originalApiKey
        if (originalModel === undefined) delete process.env.OPENAI_MODEL
        else process.env.OPENAI_MODEL = originalModel
      }
    })
    console.log('P sortie de modèle demandant une mutation sans effet: OK')

    // Q — régression C2 : l'empreinte de snapshot ne couvre pas les routes. Si
    // les distances changent après la simulation, l'identité de la suggestion et
    // l'empreinte de planning restent identiques, mais l'ampleur du gain change.
    // La confirmation doit alors être refusée, pas appliquée en silence.
    await runWithOrganization(context, async () => {
      await restorePlanning()
      const { suggestion, snapshotFingerprint } = await freshSuggestion()
      const before = await writeCounters()

      // Allonge l'approche de l'alternative dans le cache de routes partagé.
      const inflated = await prisma.routeCache.updateMany({
        where: { fingerprint: { in: Array.from(createdRouteFingerprints) }, distanceMeters: { lt: 20_000 } },
        data: { distanceMeters: 61_000, durationSeconds: 3_400 },
      })
      assert.ok(inflated.count > 0, 'le test doit réellement modifier une route d’approche')

      const drifted = await freshSuggestion()
      assert.equal(drifted.suggestion.id, suggestion.id, 'l’identité de la suggestion survit à la dérive de route')
      assert.equal(drifted.snapshotFingerprint, snapshotFingerprint, 'l’empreinte de planning aussi')
      assert.notEqual(
        drifted.suggestion.evidenceFingerprint,
        suggestion.evidenceFingerprint,
        'l’empreinte de preuve doit, elle, changer'
      )
      assert.notEqual(drifted.suggestion.impact.emptyKm.delta, suggestion.impact.emptyKm.delta)

      await assert.rejects(
        applyPlanningSuggestion({
          userId: user.id,
          suggestionId: suggestion.id,
          weekStart: weekStartParam,
          snapshotFingerprint,
          evidenceFingerprint: suggestion.evidenceFingerprint,
          idempotencyKey: `${prefix}KEY_ROUTE_DRIFT`,
        }),
        (error: unknown) => {
          assert.ok(error instanceof SuggestionApplicationError)
          assert.equal(error.status, 'STALE')
          assert.match(error.message, /route ou de gain/)
          return true
        }
      )
      assert.deepEqual(await writeCounters(), before, 'une dérive de route ne doit rien écrire')

      // Avec les faits à jour, la même suggestion reste applicable.
      const reconfirmed = await applyPlanningSuggestion({
        userId: user.id,
        suggestionId: drifted.suggestion.id,
        weekStart: weekStartParam,
        snapshotFingerprint: drifted.snapshotFingerprint,
        evidenceFingerprint: drifted.suggestion.evidenceFingerprint,
        idempotencyKey: `${prefix}KEY_ROUTE_DRIFT_OK`,
      })
      assert.equal(reconfirmed.status, 'APPLIED')
    })
    console.log('Q dérive de route entre simulation et confirmation refusée: OK')
  } finally {
    globalThis.fetch = realFetch
    await runWithOrganization(context, async () => {
      await prisma.missionEvent.deleteMany({ where: { missionId: { startsWith: prefix } } })
      await prisma.dispatchOptimizationApplication.deleteMany({ where: { idempotencyKey: { startsWith: prefix } } })
      await prisma.missionAssignment.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.mission.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.planningRow.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.driverPosition.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.driverRegulatoryDeclaration.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.truck.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.driver.deleteMany({ where: { id: { startsWith: prefix } } })
    })
    await prisma.organizationUser.deleteMany({ where: { id: { startsWith: prefix } } })
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } })
    await prisma.organization.deleteMany({ where: { id: { startsWith: prefix } } })
    if (createdRouteFingerprints.size) {
      await prisma.routeCache.deleteMany({ where: { fingerprint: { in: Array.from(createdRouteFingerprints) } } })
    }
  }
}

main().finally(() => prisma.$disconnect())
