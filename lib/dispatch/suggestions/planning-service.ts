import { getWeekEndDate } from '../date-utils'
import { prisma } from '../../prisma'
import { buildAutoPlanningSnapshot, fingerprintSnapshot } from '../auto-planning/snapshot'
import { analyzeExistingPlanningMission } from './planning-analysis'
import type { GerardSuggestion } from './types'
import { withRouteOperation } from '../maps/route-control'

export type PlanningSuggestionAnalysis = {
  analyzedAt: string
  weekStart: string
  snapshotFingerprint: string
  summary: { analyzedMissions: number; validBaselines: number; validAlternatives: number; suggestions: number }
  suggestions: GerardSuggestion[]
  diagnostics: { noValidAlternative: number; belowThreshold: number; incomplete: number }
  missionDiagnostics: Array<{ missionId: string; reference: string; diagnostics: string[]; validAlternatives: number }>
}

function intelligenceFingerprint(
  input: Awaited<ReturnType<typeof buildAutoPlanningSnapshot>>['input']
) {
  // Les routes Google peuvent varier légèrement entre deux calculs sans que le
  // planning ait changé. Le verrou Intelligence porte sur les données métier,
  // les ressources et les occupations, puis les routes sont revalidées à part.
  return fingerprintSnapshot({
    period: input.period,
    timeZone: input.timeZone,
    pairs: input.pairs,
    missions: input.missions,
    trailers: input.trailers,
    resourceOccupations: input.resourceOccupations,
    unavailableResourceIds: input.unavailableResourceIds,
    costs: input.costs,
    profile: input.profile,
    configuration: input.configuration,
  })
}

async function analyzePlanningForSuggestionsInternal(weekStart: Date): Promise<PlanningSuggestionAnalysis> {
  const weekEnd = getWeekEndDate(weekStart)
  const assignments = await prisma.missionAssignment.findMany({
    where: { scheduledDate: { gte: weekStart, lte: weekEnd }, mission: { reference: { not: '' } } },
    orderBy: [{ scheduledDate: 'asc' }, { sortOrder: 'asc' }],
    include: { mission: true },
  })
  const neighbors = assignments.flatMap((assignment) => {
    const mission = assignment.mission
    if (!assignment.planningRowId || !mission.pickupResolvedAddress || !mission.deliveryResolvedAddress || typeof mission.pickupLat !== 'number' || typeof mission.pickupLng !== 'number' || typeof mission.deliveryLat !== 'number' || typeof mission.deliveryLng !== 'number') return []
    return [{ missionId: mission.id, pairRowId: assignment.planningRowId, trailerId: assignment.trailerId, startsAt: assignment.scheduledDate.toISOString(), endsAt: (assignment.plannedEndAt ?? mission.deliveryDate ?? assignment.scheduledDate).toISOString(), pickup: { id: mission.pickupResolvedAddress, label: mission.pickupResolvedAddress, latitude: mission.pickupLat, longitude: mission.pickupLng }, delivery: { id: mission.deliveryResolvedAddress, label: mission.deliveryResolvedAddress, latitude: mission.deliveryLat, longitude: mission.deliveryLng } }]
  })
  const current = assignments.filter((assignment) => assignment.mission.status === 'ASSIGNED' && assignment.planningRowId)
  const snapshots = new Map<string, Awaited<ReturnType<typeof buildAutoPlanningSnapshot>>>()
  const suggestions: GerardSuggestion[] = []
  const missionDiagnostics: PlanningSuggestionAnalysis['missionDiagnostics'] = []
  let validBaselines = 0
  let validAlternatives = 0
  let noValidAlternative = 0
  let belowThreshold = 0
  let incomplete = 0
  let fingerprint = ''
  for (const assignment of current) {
    const day = assignment.scheduledDate.toISOString().slice(0, 10)
    let snapshot = snapshots.get(day)
    if (!snapshot) {
      snapshot = await buildAutoPlanningSnapshot({
        weekStartDate: weekStart,
        includeExistingForced: true,
        now: new Date(`${day}T04:30:00.000Z`),
        // L'analyse ne prépare que la mission courante ci-dessous. Construire
        // toutes les routes de tous les candidats ici doublait les appels.
        prepareCandidateRoutes: false,
      })
      snapshots.set(day, snapshot)
    }
    const analyticalFingerprint = intelligenceFingerprint(snapshot.input)
    fingerprint ||= analyticalFingerprint
    const result = await analyzeExistingPlanningMission({ optimization: snapshot.input, missionId: assignment.missionId, currentPairRowId: assignment.planningRowId!, currentTrailerId: assignment.trailerId, neighbors, weekStart: weekStart.toISOString(), snapshotFingerprint: analyticalFingerprint })
    const baselineValid = result.currentCandidate?.compatibility.status === 'COMPATIBLE' && result.currentCandidate.temporalEvaluation?.status === 'FEASIBLE'
    if (baselineValid) validBaselines += 1
    else incomplete += 1
    validAlternatives += result.alternatives.length
    if (!result.alternatives.length) noValidAlternative += 1
    else if (!result.suggestion) belowThreshold += 1
    if (result.suggestion) suggestions.push(result.suggestion)
    missionDiagnostics.push({ missionId: assignment.missionId, reference: assignment.mission.reference, diagnostics: result.diagnostics, validAlternatives: result.alternatives.length })
  }
  return { analyzedAt: new Date().toISOString(), weekStart: weekStart.toISOString(), snapshotFingerprint: fingerprint, summary: { analyzedMissions: current.length, validBaselines, validAlternatives, suggestions: suggestions.length }, suggestions, diagnostics: { noValidAlternative, belowThreshold, incomplete }, missionDiagnostics }
}

export async function analyzePlanningForSuggestions(weekStart: Date): Promise<PlanningSuggestionAnalysis> {
  return withRouteOperation('Gerard Intelligence analyze', () => analyzePlanningForSuggestionsInternal(weekStart))
}
