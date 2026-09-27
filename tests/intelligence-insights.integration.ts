// Matrice de la surface proactive.
//
// Chaque famille d'insight est produite depuis un moteur déterministe existant.
// Le test monte deux organisations jetables pour prouver aussi l'isolation, et
// n'effectue aucun appel réseau payant.
process.env.GOOGLE_MAPS_API_KEY = 'qa-intelligence-insights'
process.env.GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION = '200'
process.env.JWT_SECRET ??= 'qa-intelligence-insights'

import assert from 'node:assert/strict'

import { prisma } from '../lib/prisma'
import { runWithOrganization } from '../lib/auth/organization-context'
import { routeFingerprint } from '../lib/dispatch/maps/route-control'
import { buildPlanningInsights, insightDisplayLimit } from '../lib/dispatch/intelligence/insights'
import { applyPlanningSuggestion } from '../lib/dispatch/suggestions/application'
import { analyzePlanningForSuggestions } from '../lib/dispatch/suggestions/planning-service'

const prefix = 'QA_INT_INSIGHT_'
const weekStart = new Date(2034, 0, 2)
const weekStartParam = '2034-01-02'
const missionStart = new Date(2034, 0, 3, 8)
const missionEnd = new Date(2034, 0, 3, 22)
const regulatoryReference = new Date('2034-01-03T04:00:00.000Z')
const before = new Date(2034, 0, 1)
const after = new Date(2034, 0, 5)
const pickup = { latitude: 44.1, longitude: -2.1 }
const delivery = { latitude: 44.6, longitude: -2.6 }
const nearPosition = { latitude: 44.11, longitude: -2.11 }
const farPosition = { latitude: 44.9, longitude: -2.9 }
const createdRouteFingerprints = new Set<string>()
const realFetch = globalThis.fetch

function installDeterministicRouteProvider() {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input : (input as Request).url)
    if (!url.startsWith('https://routes.googleapis.com/')) throw new Error(`UNEXPECTED_NETWORK_CALL:${url}`)
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      origin: { location: { latLng: { latitude: number; longitude: number } } }
      destination: { location: { latLng: { latitude: number; longitude: number } } }
      intermediates?: Array<{ location: { latitude: number; longitude: number } }>
      travelMode: 'DRIVE'
      routingPreference: 'TRAFFIC_AWARE' | 'TRAFFIC_UNAWARE'
    }
    const from = body.origin.location.latLng
    const to = body.destination.location.latLng
    createdRouteFingerprints.add(routeFingerprint({
      origin: from, destination: to,
      travelMode: body.travelMode, routingPreference: body.routingPreference,
      waypoints: body.intermediates?.map((item) => item.location) ?? [],
    }))
    const toRadians = (value: number) => (value * Math.PI) / 180
    const deltaLat = toRadians(to.latitude - from.latitude)
    const deltaLng = toRadians(to.longitude - from.longitude)
    const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLng / 2) ** 2
    const kilometres = 6371 * 2 * Math.asin(Math.sqrt(haversine)) * 1.25
    return new Response(JSON.stringify({
      routes: [{
        distanceMeters: Math.max(1, Math.round(kilometres * 1000)),
        duration: `${Math.max(60, Math.round((kilometres / 70) * 3600))}s`,
        polyline: { encodedPolyline: 'qa-intelligence-insights' },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
}

function declaration(driverId: string, id: string) {
  return {
    id, driverId, source: 'QA' as const,
    referenceAt: regulatoryReference, timeZone: 'Europe/Luxembourg',
    drivingSinceValidBreakSeconds: 0, dailyDrivingSeconds: 0, weeklyDrivingSeconds: 0,
    previousWeekDrivingSeconds: 0, dailyExtensionsUsedThisWeek: 0,
    reducedDailyRestsUsedSinceWeeklyRest: 0,
    lastValidRestEndedAt: regulatoryReference, dutyPeriodStartedAt: regulatoryReference,
    currentIsoWeek: '2034-W01',
  }
}

/** Planning minimal et sain : une mission affectée, complète, sans alternative. */
async function seedBaseline() {
  await prisma.driver.create({ data: { id: `${prefix}DRIVER_FAR`, name: 'QA Insight Loin', hourlyCostAmount: 20 } })
  await prisma.truck.create({ data: { id: `${prefix}TRUCK_FAR`, plateNumber: 'QA-INSIGHT-FAR', driverId: `${prefix}DRIVER_FAR` } })
  await prisma.planningRow.create({ data: { id: `${prefix}ROW_FAR`, weekStartDate: weekStart, driverId: `${prefix}DRIVER_FAR`, truckId: `${prefix}TRUCK_FAR`, sortOrder: 0 } })
  await prisma.driverPosition.create({ data: { id: `${prefix}POSITION_FAR`, driverId: `${prefix}DRIVER_FAR`, latitude: farPosition.latitude, longitude: farPosition.longitude, provider: 'DRIVER_PHONE', recordedAt: regulatoryReference, accuracy: 10 } })
  await prisma.driverRegulatoryDeclaration.create({ data: declaration(`${prefix}DRIVER_FAR`, `${prefix}DECLARATION_FAR`) })
  await prisma.mission.create({
    data: {
      id: `${prefix}MISSION`, reference: 'QA-INSIGHT-01', clientName: 'QA Client Insight',
      status: 'ASSIGNED', pickupDate: missionStart, deliveryDate: missionEnd,
      pickupAddress: 'QA Enlèvement', deliveryAddress: 'QA Livraison',
      pickupResolvedAddress: 'QA-INSIGHT-PICKUP', deliveryResolvedAddress: 'QA-INSIGHT-DELIVERY',
      pickupLat: pickup.latitude, pickupLng: pickup.longitude,
      deliveryLat: delivery.latitude, deliveryLng: delivery.longitude,
      priceAmount: 2000, priceCurrency: 'EUR', estimatedKm: 78,
      routeDistanceMeters: 78000, routeDurationSeconds: 4200,
      routeProvider: 'GOOGLE_ROUTES', routeCalculatedAt: regulatoryReference,
    },
  })
  await prisma.missionAssignment.create({
    data: {
      id: `${prefix}ASSIGNMENT`, missionId: `${prefix}MISSION`, planningRowId: `${prefix}ROW_FAR`,
      driverId: `${prefix}DRIVER_FAR`, truckId: `${prefix}TRUCK_FAR`, trailerId: null,
      day: 'TUESDAY', scheduledDate: missionStart, plannedEndAt: missionEnd,
      approachDistanceMeters: 139000, approachDurationSeconds: 7150,
      approachProvider: 'GOOGLE_ROUTES', approachCalculatedAt: regulatoryReference,
    },
  })
}

/** Ajoute la paire proche : l'analyse produit alors une opportunité matérielle. */
async function seedOpportunity() {
  await prisma.driver.create({ data: { id: `${prefix}DRIVER_NEAR`, name: 'QA Insight Proche', hourlyCostAmount: 20 } })
  await prisma.truck.create({ data: { id: `${prefix}TRUCK_NEAR`, plateNumber: 'QA-INSIGHT-NEAR', driverId: `${prefix}DRIVER_NEAR` } })
  await prisma.planningRow.create({ data: { id: `${prefix}ROW_NEAR`, weekStartDate: weekStart, driverId: `${prefix}DRIVER_NEAR`, truckId: `${prefix}TRUCK_NEAR`, sortOrder: 1 } })
  await prisma.driverPosition.create({ data: { id: `${prefix}POSITION_NEAR`, driverId: `${prefix}DRIVER_NEAR`, latitude: nearPosition.latitude, longitude: nearPosition.longitude, provider: 'DRIVER_PHONE', recordedAt: regulatoryReference, accuracy: 10 } })
  await prisma.driverRegulatoryDeclaration.create({ data: declaration(`${prefix}DRIVER_NEAR`, `${prefix}DECLARATION_NEAR`) })
}

function ofType(report: Awaited<ReturnType<typeof buildPlanningInsights>>, type: string) {
  return report.insights.filter((insight) => insight.type === type)
}

async function main() {
  const organization = await prisma.organization.create({
    data: { id: `${prefix}ORG`, name: 'QA Intelligence Insights', slug: 'qa-intelligence-insights' },
  })
  const otherOrganization = await prisma.organization.create({
    data: { id: `${prefix}ORG_OTHER`, name: 'QA Intelligence Insights Other', slug: 'qa-intelligence-insights-other' },
  })
  const user = await prisma.user.create({
    data: { id: `${prefix}USER`, name: 'QA Insight', firstName: 'QA', lastName: 'Insight', username: 'qa_intelligence_insight', role: 'ADMIN', isActive: true, mustChangePassword: false },
  })
  const otherUser = await prisma.user.create({
    data: { id: `${prefix}USER_OTHER`, name: 'QA Insight Other', firstName: 'QA', lastName: 'Other', username: 'qa_intelligence_insight_other', role: 'ADMIN', isActive: true, mustChangePassword: false },
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
    await runWithOrganization(context, seedBaseline)

    // A — planning sain : aucune alerte, et un état vide explicite.
    const calm = await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: before }))
    assert.equal(calm.total, 0, `insights inattendus : ${JSON.stringify(calm.insights)}`)
    assert.deepEqual(calm.insights, [])
    assert.deepEqual(calm.bySeverity, { CRITICAL: 0, ATTENTION: 0, OPPORTUNITY: 0, INFO: 0 })
    assert.equal(calm.weekStart, weekStart.toISOString())
    console.log('A planning sain : aucune alerte: OK')

    // B — une mission à planifier.
    await runWithOrganization(context, async () => {
      await prisma.mission.create({
        data: {
          id: `${prefix}MISSION_PENDING`, reference: 'QA-INSIGHT-02', clientName: 'QA Client Insight',
          status: 'PENDING', pickupDate: missionStart, deliveryDate: missionEnd,
          pickupResolvedAddress: 'QA-P', deliveryResolvedAddress: 'QA-D',
          pickupLat: 44.2, pickupLng: -2.2, deliveryLat: 44.7, deliveryLng: -2.7,
          routeDurationSeconds: 4200,
        },
      })
    })
    const pending = await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: before }))
    const unassigned = ofType(pending, 'UNASSIGNED_MISSION')
    assert.equal(unassigned.length, 1)
    assert.equal(unassigned[0].severity, 'ATTENTION', 'avant l’enlèvement, une mission non affectée demande une action')
    assert.deepEqual(unassigned[0].missionIds, [`${prefix}MISSION_PENDING`])
    assert.match(unassigned[0].title, /QA-INSIGHT-02/)
    assert.equal(unassigned[0].availableActions[0].type, 'OPEN_MISSION')
    assert.equal(unassigned[0].confidence, 'HIGH')
    console.log('B mission à planifier : un insight ATTENTION: OK')

    // Après l'enlèvement, la même mission bloque l'exploitation.
    const overdue = await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: after }))
    assert.equal(ofType(overdue, 'UNASSIGNED_MISSION')[0].severity, 'CRITICAL')
    assert.notEqual(ofType(overdue, 'UNASSIGNED_MISSION')[0].id, unassigned[0].id, 'un changement d’état change l’identité')
    console.log('B2 enlèvement dépassé : la gravité monte à CRITICAL: OK')

    // C — conflit de ressource réel entre deux affectations.
    await runWithOrganization(context, async () => {
      await prisma.mission.update({ where: { id: `${prefix}MISSION_PENDING` }, data: { status: 'ASSIGNED' } })
      await prisma.missionAssignment.create({
        data: {
          id: `${prefix}ASSIGNMENT_CONFLICT`, missionId: `${prefix}MISSION_PENDING`, planningRowId: `${prefix}ROW_FAR`,
          driverId: `${prefix}DRIVER_FAR`, truckId: `${prefix}TRUCK_FAR`, trailerId: null,
          day: 'TUESDAY', scheduledDate: new Date(2034, 0, 3, 9), plannedEndAt: new Date(2034, 0, 3, 20),
        },
      })
    })
    const conflicted = await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: before }))
    const conflicts = ofType(conflicted, 'PLANNING_CONFLICT')
    assert.equal(conflicts.length, 1, 'un chevauchement ne doit produire qu’un insight')
    assert.equal(conflicts[0].severity, 'CRITICAL')
    assert.equal(conflicts[0].missionIds.length, 2)
    assert.match(conflicts[0].summary, /chauffeur/)
    assert.match(conflicts[0].summary, /camion/)
    console.log('C conflit de ressource : un seul insight CRITICAL: OK')

    // G — le même chevauchement est vu deux fois par le détecteur (un sens par
    // mission) : il ne doit en rester qu'un.
    assert.equal(
      new Set(conflicted.insights.map((insight) => insight.id)).size,
      conflicted.insights.length,
      'aucun identifiant dupliqué'
    )
    console.log('G découverte multiple : insight dédupliqué: OK')

    // Retour à un planning sans conflit, puis introduction d'une opportunité.
    await runWithOrganization(context, async () => {
      await prisma.missionAssignment.delete({ where: { id: `${prefix}ASSIGNMENT_CONFLICT` } })
      await prisma.mission.delete({ where: { id: `${prefix}MISSION_PENDING` } })
      await seedOpportunity()
    })

    // D — opportunité matérielle issue du moteur du Run 3.
    const withOpportunity = await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: before }))
    const opportunities = ofType(withOpportunity, 'OPTIMIZATION_OPPORTUNITY')
    assert.equal(opportunities.length, 1)
    assert.equal(opportunities[0].severity, 'OPPORTUNITY')
    assert.match(opportunities[0].title, /km à vide peuvent être évités/)
    const simulateAction = opportunities[0].availableActions[0]
    assert.equal(simulateAction.type, 'SIMULATE')
    assert.ok('suggestionId' in simulateAction && simulateAction.suggestionId.startsWith('reassignment:'))
    assert.ok('proposedPairRowId' in simulateAction && simulateAction.proposedPairRowId === `${prefix}ROW_NEAR`)
    const savedKm = opportunities[0].evidence.find((item) => item.code === 'EMPTY_KM_SAVED')
    assert.ok(Number(savedKm?.value) > 20, 'l’économie annoncée doit être matérielle')
    assert.equal(opportunities[0].score, withOpportunity.insights[0].score)
    console.log('D opportunité matérielle exposée avec son action de simulation: OK')

    // Les faits proactifs et ceux de l'analyse sont les mêmes.
    await runWithOrganization(context, async () => {
      const analysis = await analyzePlanningForSuggestions(weekStart)
      assert.equal(analysis.suggestions.length, 1)
      assert.ok('suggestionId' in simulateAction && simulateAction.suggestionId === analysis.suggestions[0].id)
      assert.equal(opportunities[0].score, analysis.suggestions[0].scoreBreakdown.total)
    })
    console.log('D2 l insight et l analyse partagent les mêmes faits: OK')

    // E — une amélioration non matérielle ne produit aucune opportunité : en
    // rapprochant le chauffeur actuel, le gain tombe sous les seuils du Run 3.
    await runWithOrganization(context, async () => {
      await prisma.driverPosition.update({
        where: { id: `${prefix}POSITION_FAR` },
        data: { latitude: 44.112, longitude: -2.112 },
      })
      await prisma.missionAssignment.update({
        where: { id: `${prefix}ASSIGNMENT` },
        data: { approachDistanceMeters: 1900, approachDurationSeconds: 120 },
      })
    })
    const tiny = await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: before }))
    assert.equal(ofType(tiny, 'OPTIMIZATION_OPPORTUNITY').length, 0, 'un gain minuscule ne doit rien produire')
    await runWithOrganization(context, async () => {
      await prisma.driverPosition.update({
        where: { id: `${prefix}POSITION_FAR` },
        data: { latitude: farPosition.latitude, longitude: farPosition.longitude },
      })
      await prisma.missionAssignment.update({
        where: { id: `${prefix}ASSIGNMENT` },
        data: { approachDistanceMeters: 139000, approachDurationSeconds: 7150 },
      })
    })
    console.log('E amélioration non matérielle : aucune opportunité: OK')

    // F — donnée critique manquante, nommée exactement.
    await runWithOrganization(context, async () => {
      await prisma.mission.update({ where: { id: `${prefix}MISSION` }, data: { routeDurationSeconds: null } })
    })
    const incomplete = await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: before }))
    const missing = ofType(incomplete, 'INCOMPLETE_CRITICAL_DATA')
    assert.equal(missing.length, 1)
    assert.equal(missing[0].severity, 'INFO')
    assert.deepEqual(missing[0].evidence.map((item) => item.code), ['ROUTE_DURATION'])
    assert.match(missing[0].summary, /durée de route non calculée/)
    assert.ok(!/risqué|dangereux/i.test(missing[0].summary), 'une donnée manquante n’est pas un risque affirmé')
    await runWithOrganization(context, async () => {
      await prisma.mission.update({ where: { id: `${prefix}MISSION` }, data: { routeDurationSeconds: 4200 } })
    })
    console.log('F donnée critique manquante nommée précisément: OK')

    // F2 — régression : une mission affectée dont les adresses ne sont pas
    // résolues ne figure pas dans le voisinage d'analyse. Elle ne doit pas faire
    // échouer toute la semaine, sinon Gerard Intelligence devient muet pour tout
    // le planning à cause d'une seule mission mal géocodée.
    await runWithOrganization(context, async () => {
      await prisma.mission.create({
        data: {
          id: `${prefix}MISSION_UNGEOCODED`, reference: 'QA-INSIGHT-05', clientName: 'QA Client Insight',
          status: 'ASSIGNED', pickupDate: missionStart, deliveryDate: missionEnd,
          pickupCity: 'Ville départ', deliveryCity: 'Ville arrivée',
        },
      })
      await prisma.missionAssignment.create({
        data: {
          id: `${prefix}ASSIGNMENT_UNGEOCODED`, missionId: `${prefix}MISSION_UNGEOCODED`, planningRowId: `${prefix}ROW_NEAR`,
          driverId: `${prefix}DRIVER_NEAR`, truckId: `${prefix}TRUCK_NEAR`, trailerId: null,
          day: 'TUESDAY', scheduledDate: new Date(2034, 0, 5, 8), plannedEndAt: new Date(2034, 0, 5, 18),
        },
      })
    })
    const resilient = await runWithOrganization(context, async () => {
      const analysis = await analyzePlanningForSuggestions(weekStart)
      const diagnostic = analysis.missionDiagnostics.find((item) => item.missionId === `${prefix}MISSION_UNGEOCODED`)
      assert.ok(diagnostic, 'la mission non analysable doit apparaître dans les diagnostics')
      assert.deepEqual(diagnostic.diagnostics, ['INCOMPLETE_MISSION_DATA'])
      assert.ok(analysis.diagnostics.incomplete >= 1)
      assert.ok(analysis.suggestions.length >= 0)
      return buildPlanningInsights({ weekStart, now: before })
    })
    const ungeocoded = ofType(resilient, 'INCOMPLETE_CRITICAL_DATA')
      .find((item) => item.missionIds.includes(`${prefix}MISSION_UNGEOCODED`))
    assert.ok(ungeocoded, 'la mission mal géocodée doit produire un insight, pas une panne')
    assert.deepEqual(
      ungeocoded.evidence.map((item) => item.code).sort(),
      ['DELIVERY_ADDRESS', 'DELIVERY_COORDINATES', 'PICKUP_ADDRESS', 'PICKUP_COORDINATES', 'ROUTE_DURATION']
    )
    await runWithOrganization(context, async () => {
      await prisma.missionAssignment.delete({ where: { id: `${prefix}ASSIGNMENT_UNGEOCODED` } })
      await prisma.mission.delete({ where: { id: `${prefix}MISSION_UNGEOCODED` } })
    })
    console.log('F2 une mission mal géocodée n interrompt pas l analyse de la semaine: OK')

    // H — ordre déterministe par gravité, puis urgence.
    await runWithOrganization(context, async () => {
      await prisma.mission.create({
        data: {
          id: `${prefix}MISSION_LATE`, reference: 'QA-INSIGHT-03', clientName: 'QA Client Insight',
          status: 'PENDING', pickupDate: new Date(2034, 0, 2, 7), deliveryDate: new Date(2034, 0, 2, 18),
        },
      })
      await prisma.mission.create({
        data: {
          id: `${prefix}MISSION_SOON`, reference: 'QA-INSIGHT-04', clientName: 'QA Client Insight',
          status: 'PENDING', pickupDate: new Date(2034, 0, 6, 7), deliveryDate: new Date(2034, 0, 6, 18),
        },
      })
    })
    const mixed = await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: new Date(2034, 0, 3) }))
    const severities = mixed.insights.map((insight) => insight.severity)
    assert.deepEqual(severities, [...severities].sort((left, right) =>
      ['CRITICAL', 'ATTENTION', 'OPPORTUNITY', 'INFO'].indexOf(left) - ['CRITICAL', 'ATTENTION', 'OPPORTUNITY', 'INFO'].indexOf(right)
    ), 'les gravités doivent être ordonnées')
    assert.equal(severities[0], 'CRITICAL')
    assert.ok(severities.includes('ATTENTION'))
    assert.ok(severities.includes('OPPORTUNITY'))
    const repeated = await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: new Date(2034, 0, 3) }))
    assert.deepEqual(repeated.insights.map((item) => item.id), mixed.insights.map((item) => item.id), 'l’ordre est stable')
    console.log('H gravités ordonnées et ordre stable: OK')

    // I — plafond d'affichage déterministe, total conservé.
    await runWithOrganization(context, async () => {
      for (let index = 0; index < 6; index += 1) {
        await prisma.mission.create({
          data: {
            id: `${prefix}MISSION_BULK_${index}`, reference: `QA-INSIGHT-BULK-${index}`, clientName: 'QA Client Insight',
            status: 'PENDING', pickupDate: new Date(2034, 0, 4, 7 + index), deliveryDate: new Date(2034, 0, 4, 18),
          },
        })
      }
    })
    const capped = await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: new Date(2034, 0, 3) }))
    assert.equal(capped.insights.length, insightDisplayLimit)
    assert.ok(capped.total > insightDisplayLimit, 'le total doit rester complet')
    const cappedAgain = await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: new Date(2034, 0, 3) }))
    assert.deepEqual(cappedAgain.insights.map((item) => item.id), capped.insights.map((item) => item.id))
    const expanded = await runWithOrganization(context, () => buildPlanningInsights({ weekStart, now: new Date(2034, 0, 3), limit: 50 }))
    assert.equal(expanded.insights.length, expanded.total)
    assert.deepEqual(expanded.insights.slice(0, insightDisplayLimit).map((item) => item.id), capped.insights.map((item) => item.id))
    await runWithOrganization(context, async () => {
      await prisma.mission.deleteMany({ where: { id: { startsWith: `${prefix}MISSION_BULK_` } } })
      await prisma.mission.deleteMany({ where: { id: { in: [`${prefix}MISSION_LATE`, `${prefix}MISSION_SOON`] } } })
    })
    console.log('I plafond déterministe et total conservé: OK')

    // J — isolation tenant : l'autre organisation ne voit rien.
    const foreign = await runWithOrganization(otherContext, () => buildPlanningInsights({ weekStart, now: before }))
    assert.equal(foreign.total, 0)
    assert.deepEqual(foreign.insights, [])
    console.log('J aucun insight ne traverse la frontière tenant: OK')

    // K — l'opportunité disparaît une fois la suggestion appliquée.
    const applied = await runWithOrganization(context, async () => {
      const analysis = await analyzePlanningForSuggestions(weekStart)
      const suggestion = analysis.suggestions[0]
      assert.ok(suggestion)
      const result = await applyPlanningSuggestion({
        userId: user.id,
        suggestionId: suggestion.id,
        weekStart: weekStartParam,
        snapshotFingerprint: suggestion.snapshotFingerprint,
        evidenceFingerprint: suggestion.evidenceFingerprint,
        idempotencyKey: `${prefix}KEY_APPLIED`,
      })
      assert.equal(result.status, 'APPLIED')
      return buildPlanningInsights({ weekStart, now: before })
    })
    assert.equal(ofType(applied, 'OPTIMIZATION_OPPORTUNITY').length, 0, 'l’opportunité résolue doit disparaître')
    console.log('K opportunité appliquée : l insight disparaît: OK')

    // L — l'action d'un insight périmé ne peut pas appliquer quoi que ce soit :
    // elle ne porte qu'une simulation, et l'application reste protégée par les
    // empreintes de snapshot et de preuve.
    assert.ok(
      withOpportunity.insights.every((insight) =>
        insight.availableActions.every((action) => action.type === 'SIMULATE' || action.type === 'OPEN_MISSION')
      ),
      'aucune action d’insight ne peut écrire'
    )
    await runWithOrganization(context, async () => {
      const stale = opportunities[0].availableActions[0]
      assert.ok('suggestionId' in stale)
      await assert.rejects(
        applyPlanningSuggestion({
          userId: user.id,
          suggestionId: stale.suggestionId,
          weekStart: weekStartParam,
          snapshotFingerprint: withOpportunity.insights[0].id,
          evidenceFingerprint: 'preuve-perimee',
          idempotencyKey: `${prefix}KEY_STALE_INSIGHT`,
        }),
        /planning a changé|route ou de gain/
      )
      assert.equal(await prisma.dispatchOptimizationApplication.count(), 1, 'aucune application supplémentaire')
    })
    console.log('L action d un insight périmé sans effet: OK')
  } finally {
    globalThis.fetch = realFetch
    await runWithOrganization(context, async () => {
      await prisma.missionEvent.deleteMany({ where: { missionId: { startsWith: prefix } } })
      await prisma.dispatchOptimizationApplication.deleteMany({})
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
