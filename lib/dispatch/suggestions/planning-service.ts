import { AsyncLocalStorage } from 'node:async_hooks'
import { formatDateParam, getWeekEndDate } from '../date-utils'
import { prisma } from '../../prisma'
import { buildAutoPlanningSnapshot, fingerprintSnapshot } from '../auto-planning/snapshot'
import { analyzeExistingPlanningMission } from './planning-analysis'
import type { GerardSuggestion } from './types'
import { measureRouteOperation } from '../maps/route-control'
import { observeIntelligenceOperation } from '../intelligence/observability'

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
  // Une mission affectée dont les adresses ou coordonnées sont incomplètes ne
  // figure pas dans le voisinage : l'analyser ferait échouer toute la semaine.
  // Elle est comptée comme non analysable, pas propagée en erreur.
  const analysable = new Set(neighbors.map((neighbor) => neighbor.missionId))
  const current = assignments.filter(
    (assignment) =>
      assignment.mission.status === 'ASSIGNED' &&
      assignment.planningRowId &&
      analysable.has(assignment.missionId)
  )
  const notAnalysable = assignments.filter(
    (assignment) =>
      assignment.mission.status === 'ASSIGNED' &&
      assignment.planningRowId &&
      !analysable.has(assignment.missionId)
  )
  const snapshots = new Map<string, Awaited<ReturnType<typeof buildAutoPlanningSnapshot>>>()
  const suggestions: GerardSuggestion[] = []
  const missionDiagnostics: PlanningSuggestionAnalysis['missionDiagnostics'] = []
  let validBaselines = 0
  let validAlternatives = 0
  let noValidAlternative = 0
  let belowThreshold = 0
  let incomplete = 0
  let fingerprint = ''
  for (const assignment of notAnalysable) {
    incomplete += 1
    missionDiagnostics.push({
      missionId: assignment.missionId,
      reference: assignment.mission.reference,
      diagnostics: ['INCOMPLETE_MISSION_DATA'],
      validAlternatives: 0,
    })
  }
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

const analysisMemoStorage = new AsyncLocalStorage<Map<string, Promise<PlanningSuggestionAnalysis>>>()

/**
 * Mémoïse l'analyse hebdomadaire le temps d'une seule requête. Un tour de chat
 * peut enchaîner plusieurs outils qui lisent la même analyse : sans cela, chacun
 * recalculerait toute la semaine. La mémoire disparaît à la fin de la requête,
 * jamais partagée entre utilisateurs ni entre requêtes.
 */
export function withPlanningAnalysisMemo<T>(task: () => Promise<T>): Promise<T> {
  return analysisMemoStorage.getStore() ? task() : analysisMemoStorage.run(new Map(), task)
}

export async function analyzePlanningForSuggestions(weekStart: Date): Promise<PlanningSuggestionAnalysis> {
  const memo = analysisMemoStorage.getStore()
  if (!memo) return analyzePlanningForSuggestionsUncached(weekStart)
  const key = formatDateParam(weekStart)
  let pending = memo.get(key)
  if (!pending) {
    pending = analyzePlanningForSuggestionsUncached(weekStart)
    memo.set(key, pending)
    // Un échec n'est pas mémorisé : le prochain outil peut réessayer.
    pending.catch(() => memo.delete(key))
  }
  return pending
}

async function analyzePlanningForSuggestionsUncached(weekStart: Date): Promise<PlanningSuggestionAnalysis> {
  const week = formatDateParam(weekStart)
  return observeIntelligenceOperation(
    { started: 'analysis.started', completed: 'analysis.completed', failed: 'analysis.failed' },
    { week },
    async () => {
      const { result, metrics } = await measureRouteOperation(
        'Gerard Intelligence analyze',
        () => analyzePlanningForSuggestionsInternal(weekStart)
      )
      return {
        value: result,
        completedFields: {
          analyzedMissions: result.summary.analyzedMissions,
          incompleteMissions: result.diagnostics.incomplete,
          suggestions: result.summary.suggestions,
          routeLookups: metrics.lookups,
          routeCacheHits: metrics.cacheHits,
          routeProviderCalls: metrics.googleCalls,
          routeBlocked: metrics.blockedByLimit,
        },
      }
    }
  )
}
