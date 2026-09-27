import { createHash } from 'crypto'

import { prisma } from '../../prisma'
import { getWeekEndDate } from '../date-utils'
import { findResourceOccupationConflicts } from '../resource-availability'
import { analyzePlanningForSuggestions } from '../suggestions/planning-service'
import type { GerardSuggestion } from '../suggestions/types'

/**
 * Surface proactive de Gerard.
 *
 * Aucune logique métier nouvelle ici : chaque famille dérive d'un moteur
 * déterministe existant — l'analyse de planning pour les opportunités et les
 * données incomplètes, `findResourceOccupationConflicts` pour les conflits, le
 * statut des missions pour les non-affectées. Rien n'est persisté, rien n'est
 * écrit, et le modèle de langage n'intervient jamais.
 */

export type GerardInsightType =
  | 'UNASSIGNED_MISSION'
  | 'PLANNING_CONFLICT'
  | 'OPTIMIZATION_OPPORTUNITY'
  | 'INCOMPLETE_CRITICAL_DATA'

/**
 * CRITICAL : l'exploitation est invalide ou bloquée.
 * ATTENTION : une action est nécessaire, ou un risque matériel existe.
 * OPPORTUNITY : une amélioration valide existe, le plan actuel reste tenable.
 * INFO : contexte utile sur des données incomplètes, sans défaillance immédiate.
 */
export type GerardInsightSeverity = 'CRITICAL' | 'ATTENTION' | 'OPPORTUNITY' | 'INFO'

export type GerardInsightEvidence = {
  code: string
  label: string
  value?: string | number | null
}

export type GerardInsightAction =
  | { type: 'OPEN_MISSION'; label: string; missionId: string; missionReference: string }
  | {
      type: 'SIMULATE'
      label: string
      suggestionId: string
      missionId: string
      proposedPairRowId: string
    }

export type GerardInsight = {
  id: string
  type: GerardInsightType
  severity: GerardInsightSeverity
  title: string
  summary: string
  missionIds: string[]
  evidence: GerardInsightEvidence[]
  confidence: 'HIGH' | 'MEDIUM'
  availableActions: GerardInsightAction[]
  /** Date de l'évènement concerné : sert l'ordre par urgence opérationnelle. */
  occursAt: string | null
  /** Matérialité, uniquement pour les opportunités. */
  score: number | null
}

export type GerardInsightReport = {
  weekStart: string
  analyzedAt: string
  /** Nombre total d'insights détectés, avant plafonnement d'affichage. */
  total: number
  bySeverity: Record<GerardInsightSeverity, number>
  insights: GerardInsight[]
}

export const insightDisplayLimit = 5

const severityRank: Record<GerardInsightSeverity, number> = {
  CRITICAL: 0,
  ATTENTION: 1,
  OPPORTUNITY: 2,
  INFO: 3,
}

const conflictKindLabels: Record<string, string> = {
  DRIVER: 'chauffeur',
  TRUCK: 'camion',
  TRAILER: 'remorque',
}

/** Identité stable : même problème dans le même état, même insight. */
function insightId(type: GerardInsightType, subject: string, state: string) {
  return `insight:${type}:${subject}:${createHash('sha256').update(state).digest('hex').slice(0, 12)}`
}

/**
 * Champs dont l'analyseur a réellement besoin pour évaluer une mission affectée.
 * Ce sont exactement ceux que `planning-service` exige pour construire un
 * voisinage : leur absence explique pourquoi Gerard ne peut pas conclure.
 */
function missingCriticalFields(mission: {
  pickupResolvedAddress: string | null
  deliveryResolvedAddress: string | null
  pickupLat: number | null
  pickupLng: number | null
  deliveryLat: number | null
  deliveryLng: number | null
  routeDurationSeconds: number | null
}) {
  const missing: GerardInsightEvidence[] = []
  if (!mission.pickupResolvedAddress) missing.push({ code: 'PICKUP_ADDRESS', label: 'adresse d’enlèvement non résolue' })
  if (!mission.deliveryResolvedAddress) missing.push({ code: 'DELIVERY_ADDRESS', label: 'adresse de livraison non résolue' })
  if (typeof mission.pickupLat !== 'number' || typeof mission.pickupLng !== 'number') {
    missing.push({ code: 'PICKUP_COORDINATES', label: 'coordonnées d’enlèvement manquantes' })
  }
  if (typeof mission.deliveryLat !== 'number' || typeof mission.deliveryLng !== 'number') {
    missing.push({ code: 'DELIVERY_COORDINATES', label: 'coordonnées de livraison manquantes' })
  }
  if (typeof mission.routeDurationSeconds !== 'number') {
    missing.push({ code: 'ROUTE_DURATION', label: 'durée de route non calculée' })
  }
  return missing
}

function optimizationInsight(suggestion: GerardSuggestion): GerardInsight {
  const savedKm = Math.max(0, -suggestion.impact.emptyKm.delta)
  const marginGain = suggestion.impact.estimatedMargin.delta
  const primary = suggestion.scoreBreakdown.components.find(
    (component) => component.code === suggestion.scoreBreakdown.primaryReason
  )
  return {
    // L'empreinte de preuve change dès que les faits changent : l'insight suit
    // exactement l'état de la suggestion qu'il annonce.
    id: insightId('OPTIMIZATION_OPPORTUNITY', suggestion.currentState.missionId, suggestion.evidenceFingerprint),
    type: 'OPTIMIZATION_OPPORTUNITY',
    severity: 'OPPORTUNITY',
    title: `${savedKm.toFixed(0)} km à vide peuvent être évités`,
    summary: `${suggestion.currentState.missionReference} : ${suggestion.proposedState.driverName} à la place de ${suggestion.currentState.driverName}. ${primary?.detail ?? ''}`.trim(),
    missionIds: [suggestion.currentState.missionId],
    evidence: [
      { code: 'EMPTY_KM_SAVED', label: 'Kilomètres à vide évités', value: Math.round(savedKm * 10) / 10 },
      {
        code: 'MARGIN_GAIN',
        label: suggestion.scoreBreakdown.economicBasis === 'UNAVAILABLE'
          ? 'Comparaison économique indisponible'
          : 'Marge estimée gagnée (paramètres de coût par défaut)',
        value: marginGain === null ? null : Math.round(marginGain * 100) / 100,
      },
      { code: 'SCORE', label: 'Score de classement', value: suggestion.scoreBreakdown.total },
    ],
    confidence: suggestion.confidence,
    availableActions: [{
      type: 'SIMULATE',
      label: `Simuler ${suggestion.currentState.missionReference}`,
      suggestionId: suggestion.id,
      missionId: suggestion.proposedState.missionId,
      proposedPairRowId: suggestion.proposedState.pairRowId,
    }],
    occursAt: suggestion.currentState.possibleStartAt,
    score: suggestion.scoreBreakdown.total,
  }
}

export async function buildPlanningInsights(input: {
  weekStart: Date
  now?: Date
  limit?: number
}): Promise<GerardInsightReport> {
  const now = input.now ?? new Date()
  const weekEnd = getWeekEndDate(input.weekStart)
  const limit = input.limit ?? insightDisplayLimit

  const [analysis, missions, assignments] = await Promise.all([
    analyzePlanningForSuggestions(input.weekStart),
    prisma.mission.findMany({
      where: { pickupDate: { gte: input.weekStart, lte: weekEnd } },
      orderBy: [{ pickupDate: 'asc' }, { id: 'asc' }],
      include: { assignment: { select: { id: true } } },
    }),
    prisma.missionAssignment.findMany({
      where: { scheduledDate: { gte: input.weekStart, lte: weekEnd } },
      orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }],
      include: { mission: { select: { id: true, reference: true, deliveryDate: true } } },
    }),
  ])

  const candidates: GerardInsight[] = []

  // A — missions à planifier. Une mission dont l'enlèvement est déjà passé
  // bloque l'exploitation ; sinon elle demande une action.
  for (const mission of missions) {
    if (mission.status !== 'PENDING' || mission.assignment) continue
    const overdue = Boolean(mission.pickupDate && mission.pickupDate.getTime() < now.getTime())
    candidates.push({
      id: insightId('UNASSIGNED_MISSION', mission.id, `${mission.status}:${overdue}`),
      type: 'UNASSIGNED_MISSION',
      severity: overdue ? 'CRITICAL' : 'ATTENTION',
      title: overdue ? `${mission.reference} non affectée, enlèvement dépassé` : `${mission.reference} n’est pas affectée`,
      summary: overdue
        ? `L’enlèvement était prévu le ${mission.pickupDate?.toISOString().slice(0, 16).replace('T', ' ')} et aucune ressource n’est affectée.`
        : `Enlèvement prévu le ${mission.pickupDate?.toISOString().slice(0, 16).replace('T', ' ') ?? 'date inconnue'}, aucune ressource affectée.`,
      missionIds: [mission.id],
      evidence: [
        { code: 'MISSION_STATUS', label: 'Statut', value: mission.status },
        { code: 'PICKUP_DATE', label: 'Enlèvement prévu', value: mission.pickupDate?.toISOString() ?? null },
      ],
      confidence: 'HIGH',
      availableActions: [{ type: 'OPEN_MISSION', label: `Ouvrir ${mission.reference}`, missionId: mission.id, missionReference: mission.reference }],
      occursAt: mission.pickupDate?.toISOString() ?? null,
      score: null,
    })
  }

  // B — conflits de ressource entre deux affectations réelles de la semaine.
  const occupations = assignments.map((assignment) => ({
    missionId: assignment.missionId,
    driverId: assignment.driverId,
    truckId: assignment.truckId,
    trailerId: assignment.trailerId,
    startsAt: assignment.scheduledDate,
    endsAt: assignment.plannedEndAt ?? assignment.mission.deliveryDate,
  }))
  const referenceByMissionId = new Map(assignments.map((assignment) => [assignment.missionId, assignment.mission.reference]))
  const seenConflictPairs = new Set<string>()
  for (const conflict of findResourceOccupationConflicts({ proposed: occupations, occupied: occupations })) {
    // Un chevauchement est détecté deux fois, une par sens de comparaison.
    const pair = [conflict.proposedMissionId, conflict.occupiedMissionId].sort().join('|')
    if (seenConflictPairs.has(pair)) continue
    seenConflictPairs.add(pair)
    const kinds = conflict.kinds.map((kind) => conflictKindLabels[kind] ?? kind.toLocaleLowerCase('fr-FR'))
    const [firstMissionId, secondMissionId] = pair.split('|')
    const firstReference = referenceByMissionId.get(firstMissionId) ?? firstMissionId
    const secondReference = referenceByMissionId.get(secondMissionId) ?? secondMissionId
    candidates.push({
      id: insightId('PLANNING_CONFLICT', pair, kinds.join(',')),
      type: 'PLANNING_CONFLICT',
      severity: 'CRITICAL',
      title: `${firstReference} et ${secondReference} partagent ${kinds.length > 1 ? 'des ressources' : `un ${kinds[0]}`}`,
      summary: `Les deux missions se chevauchent sur : ${kinds.join(', ')}. Le planning n’est pas exécutable en l’état.`,
      missionIds: [firstMissionId, secondMissionId],
      evidence: [
        { code: 'SHARED_RESOURCES', label: 'Ressources partagées', value: kinds.join(', ') },
        { code: 'AVAILABILITY_UNKNOWN', label: 'Fin d’occupation connue', value: conflict.availabilityUnknown ? 'non' : 'oui' },
      ],
      confidence: conflict.availabilityUnknown ? 'MEDIUM' : 'HIGH',
      availableActions: [{ type: 'OPEN_MISSION', label: `Ouvrir ${firstReference}`, missionId: firstMissionId, missionReference: firstReference }],
      occursAt: assignments.find((item) => item.missionId === firstMissionId)?.scheduledDate.toISOString() ?? null,
      score: null,
    })
  }

  // C — opportunités déjà produites par le moteur du Run 3.
  for (const suggestion of analysis.suggestions) candidates.push(optimizationInsight(suggestion))

  // D — données critiques manquantes, nommées précisément.
  for (const mission of missions) {
    if (!mission.assignment) continue
    const missing = missingCriticalFields(mission)
    if (!missing.length) continue
    candidates.push({
      id: insightId('INCOMPLETE_CRITICAL_DATA', mission.id, missing.map((item) => item.code).join(',')),
      type: 'INCOMPLETE_CRITICAL_DATA',
      severity: 'INFO',
      title: `${mission.reference} ne peut pas être évaluée complètement`,
      summary: `Données manquantes : ${missing.map((item) => item.label).join(', ')}.`,
      missionIds: [mission.id],
      evidence: missing,
      confidence: 'HIGH',
      availableActions: [{ type: 'OPEN_MISSION', label: `Ouvrir ${mission.reference}`, missionId: mission.id, missionReference: mission.reference }],
      occursAt: mission.pickupDate?.toISOString() ?? null,
      score: null,
    })
  }

  // Déduplication : une même identité ne produit qu'un insight.
  const unique = new Map<string, GerardInsight>()
  for (const insight of candidates) if (!unique.has(insight.id)) unique.set(insight.id, insight)

  // Ordre déterministe : gravité, puis urgence opérationnelle, puis matérialité,
  // puis identifiant. Aucun modèle de langage n'intervient dans ce classement.
  const ordered = Array.from(unique.values()).sort((left, right) => {
    if (severityRank[left.severity] !== severityRank[right.severity]) {
      return severityRank[left.severity] - severityRank[right.severity]
    }
    const leftAt = left.occursAt ?? ''
    const rightAt = right.occursAt ?? ''
    if (leftAt !== rightAt) return leftAt < rightAt ? -1 : 1
    if ((left.score ?? 0) !== (right.score ?? 0)) return (right.score ?? 0) - (left.score ?? 0)
    return left.id.localeCompare(right.id)
  })

  const bySeverity: Record<GerardInsightSeverity, number> = { CRITICAL: 0, ATTENTION: 0, OPPORTUNITY: 0, INFO: 0 }
  for (const insight of ordered) bySeverity[insight.severity] += 1

  return {
    weekStart: input.weekStart.toISOString(),
    analyzedAt: analysis.analyzedAt,
    total: ordered.length,
    bySeverity,
    insights: ordered.slice(0, limit),
  }
}
