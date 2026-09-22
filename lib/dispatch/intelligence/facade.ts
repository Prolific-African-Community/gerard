import { prisma } from '../../prisma'
import { getWeekEndDate } from '../date-utils'
import { compatibilityMessages } from '../optimization/compatibility'
import { analyzePlanningForSuggestions } from '../suggestions/planning-service'
import type { GerardSuggestion } from '../suggestions/types'
import type { GerardAssistantContext, GerardAssistantFact } from './types'
import { computeWeeklyProfitability } from '../profitability'

function fact(label: string, value: GerardAssistantFact['value'], source: string, confidence?: GerardAssistantFact['confidence']): GerardAssistantFact {
  return { label, value, source, ...(confidence ? { confidence } : {}) }
}

export async function getPlanningSummary(weekStart: Date): Promise<GerardAssistantContext> {
  const weekEnd = getWeekEndDate(weekStart)
  const [analysis, assigned, pending] = await Promise.all([
    analyzePlanningForSuggestions(weekStart),
    prisma.missionAssignment.count({ where: { scheduledDate: { gte: weekStart, lte: weekEnd } } }),
    prisma.mission.count({ where: { status: 'PENDING', pickupDate: { gte: weekStart, lte: weekEnd } } }),
  ])
  return {
    weekStart: weekStart.toISOString(), missionIds: analysis.missionDiagnostics.map((item) => item.missionId),
    driverIds: [], truckIds: [], trailerIds: [],
    facts: [
      fact('Missions affectées', assigned, 'MissionAssignment'),
      fact('Missions à planifier', pending, 'Mission'),
      fact('Missions analysées', analysis.summary.analyzedMissions, 'Gerard Intelligence'),
      fact('Baselines valides', analysis.summary.validBaselines, 'Gerard Intelligence'),
      fact('Alternatives valides', analysis.summary.validAlternatives, 'Gerard Intelligence'),
      fact('Suggestions applicables', analysis.summary.suggestions, 'Gerard Intelligence'),
    ],
    warnings: analysis.diagnostics.incomplete ? [`${analysis.diagnostics.incomplete} mission(s) n'ont pas pu être analysées complètement.`] : [],
    availableActions: analysis.suggestions.map((item) => ({ type: 'SIMULATE' as const, label: `Simuler ${item.proposedState.missionReference}`, suggestionId: item.id })),
    suggestions: analysis.suggestions,
    details: { summary: analysis.summary, diagnostics: analysis.diagnostics, snapshotFingerprint: analysis.snapshotFingerprint },
  }
}

export async function resolveMissionReference(weekStart: Date, reference: string) {
  const weekEnd = getWeekEndDate(weekStart)
  const normalized = /^\d{6}-\d{2}$/i.test(reference) ? `GRD-${reference}` : reference
  const suffix = /^\d{1,2}$/.test(normalized) ? `-${normalized.padStart(2, '0')}` : null
  const matches = await prisma.mission.findMany({
    where: suffix ? {
      reference: { endsWith: suffix, mode: 'insensitive' },
      assignment: { scheduledDate: { gte: weekStart, lte: weekEnd } },
    } : { reference: { equals: normalized, mode: 'insensitive' } }, take: 3,
    include: { assignment: { include: { driver: true, truck: true, trailer: true, planningRow: true } } },
  })
  if (!matches.length) return { status: 'NOT_FOUND' as const, mission: null, references: [] as string[] }
  if (matches.length > 1) return { status: 'AMBIGUOUS' as const, mission: null, references: matches.map((item) => item.reference) }
  return { status: 'FOUND' as const, mission: matches[0], references: [matches[0].reference] }
}

export async function getMissionContext(weekStart: Date, reference: string): Promise<GerardAssistantContext | null> {
  const resolved = await resolveMissionReference(weekStart, reference)
  if (resolved.status !== 'FOUND' || !resolved.mission) return null
  const mission = resolved.mission
  const assignment = mission.assignment
  const [analysis, profitability] = await Promise.all([
    analyzePlanningForSuggestions(weekStart),
    computeWeeklyProfitability({ weekStartDate: weekStart, fuelPricePerLiter: 1.65, defaultConsumptionL100: 30, defaultDriverHourlyCost: 20 }),
  ])
  const diagnostic = analysis.missionDiagnostics.find((item) => item.missionId === mission.id)
  const suggestion = analysis.suggestions.find((item) => item.affectedMissionIds.includes(mission.id))
  const economics = profitability.byMission.find((item) => item.missionId === mission.id)
  const estimatedCost = economics ? Math.round((economics.fuelCost + economics.driverCost) * 100) / 100 : null
  return {
    weekStart: weekStart.toISOString(), missionIds: [mission.id],
    driverIds: assignment?.driverId ? [assignment.driverId] : [], truckIds: assignment?.truckId ? [assignment.truckId] : [], trailerIds: assignment?.trailerId ? [assignment.trailerId] : [],
    facts: [
      fact('Mission', mission.reference, 'Mission'), fact('Statut', mission.status, 'Mission'),
      fact('Origine', mission.pickupResolvedAddress ?? mission.pickupAddress ?? mission.pickupCity, 'Mission'),
      fact('Destination', mission.deliveryResolvedAddress ?? mission.deliveryAddress ?? mission.deliveryCity, 'Mission'),
      fact('Chauffeur', assignment?.driver?.name ?? null, 'MissionAssignment'),
      fact('Camion', assignment?.truck?.plateNumber ?? null, 'MissionAssignment'),
      fact('Remorque', assignment?.trailer?.plateNumber ?? null, 'MissionAssignment'),
      fact('Début planifié', assignment?.scheduledDate.toISOString() ?? null, 'MissionAssignment'),
      fact('Fin planifiée', assignment?.plannedEndAt?.toISOString() ?? mission.deliveryDate?.toISOString() ?? null, 'MissionAssignment'),
      fact('Prix client enregistré', mission.priceAmount, 'Mission'),
      fact('Coût opérationnel estimé', estimatedCost, 'Profitability estimate', economics?.missingFields.length ? 'LOW' : 'MEDIUM'),
      fact('Marge opérationnelle estimée', economics?.operationalMargin ?? null, 'Profitability estimate', economics?.missingFields.length ? 'LOW' : 'MEDIUM'),
      fact('Alternatives valides', diagnostic?.validAlternatives ?? 0, 'Gerard Intelligence'),
    ],
    warnings: [...(diagnostic?.diagnostics.filter((item) => item !== 'ANALYZED') ?? []), ...(economics?.missingFields.length ? [`Estimation économique incomplète : ${economics.missingFields.join(', ')}.`] : [])],
    availableActions: suggestion ? [{ type: 'SIMULATE', label: `Simuler ${mission.reference}`, suggestionId: suggestion.id }] : [],
    suggestions: suggestion ? [suggestion] : [], details: { diagnostic },
  }
}

export async function getResourceAvailability(input: { weekStart: Date; missionReference: string; driverName?: string; truckPlate?: string; trailerPlate?: string }): Promise<GerardAssistantContext | null> {
  const resolved = await resolveMissionReference(input.weekStart, input.missionReference)
  if (resolved.status !== 'FOUND' || !resolved.mission?.assignment) return null
  const [drivers, trucks, trailers] = await Promise.all([
    input.driverName ? prisma.driver.findMany({ where: { name: { contains: input.driverName, mode: 'insensitive' } }, take: 3 }) : [],
    input.truckPlate ? prisma.truck.findMany({ where: { plateNumber: { equals: input.truckPlate, mode: 'insensitive' } }, take: 2 }) : [],
    input.trailerPlate ? prisma.trailer.findMany({ where: { plateNumber: { equals: input.trailerPlate, mode: 'insensitive' } }, take: 2 }) : [],
  ])
  const base = await getMissionContext(input.weekStart, input.missionReference)
  if (!base) return null
  const matches = input.driverName ? drivers : input.truckPlate ? trucks : trailers
  const kind = input.driverName ? 'Chauffeur' : input.truckPlate ? 'Camion' : 'Remorque'
  const requested = input.driverName ?? input.truckPlate ?? input.trailerPlate ?? ''
  if (matches.length !== 1) return { ...base, warnings: matches.length ? [`${kind} ambigu : ${requested}.`] : [`${kind} inconnu : ${requested}.`], details: { ...base.details, resolution: matches.length ? 'AMBIGUOUS' : 'NOT_FOUND' } }
  const resource = matches[0]
  const resourceId = resource.id
  const resourceLabel = 'name' in resource ? resource.name : resource.plateNumber
  const assignment = resolved.mission.assignment
  const endsAt = assignment.plannedEndAt ?? resolved.mission.deliveryDate ?? assignment.scheduledDate
  const conflicts = await prisma.missionAssignment.findMany({
    where: { ...(input.driverName ? { driverId: resourceId } : input.truckPlate ? { truckId: resourceId } : { trailerId: resourceId }), missionId: { not: resolved.mission.id }, scheduledDate: { lt: endsAt }, OR: [{ plannedEndAt: { gt: assignment.scheduledDate } }, { plannedEndAt: null, mission: { deliveryDate: { gt: assignment.scheduledDate } } }] },
    include: { mission: { select: { reference: true, deliveryDate: true } } }, orderBy: { scheduledDate: 'asc' },
  })
  const analysis = await analyzePlanningForSuggestions(input.weekStart)
  const validSuggestion = analysis.suggestions.find((item) => item.currentState.missionId === resolved.mission!.id && (input.driverName ? item.proposedState.driverId === resourceId : input.truckPlate ? item.proposedState.truckId === resourceId : item.proposedState.trailerId === resourceId))
  return {
    ...base,
    driverIds: input.driverName ? Array.from(new Set([...base.driverIds, resourceId])) : base.driverIds,
    truckIds: input.truckPlate ? Array.from(new Set([...base.truckIds, resourceId])) : base.truckIds,
    trailerIds: input.trailerPlate ? Array.from(new Set([...base.trailerIds, resourceId])) : base.trailerIds,
    facts: [...base.facts, fact(`${kind} évalué`, resourceLabel, kind), fact('Disponible sur le créneau', conflicts.length === 0, 'Resource availability', 'HIGH'), fact('Conflits détectés', conflicts.length, 'MissionAssignment', 'HIGH')],
    warnings: [...base.warnings, ...conflicts.map((item) => `${resourceLabel} est déjà affecté à ${item.mission.reference} du ${item.scheduledDate.toISOString()} au ${(item.plannedEndAt ?? item.mission.deliveryDate)?.toISOString() ?? 'créneau inconnu'}.`)],
    availableActions: validSuggestion ? [{ type: 'SIMULATE', label: `Simuler ${resolved.mission.reference}`, suggestionId: validSuggestion.id }] : [],
    suggestions: validSuggestion ? [validSuggestion] : [], details: { ...base.details, conflictMissionIds: conflicts.map((item) => item.missionId), candidateValidated: Boolean(validSuggestion) },
  }
}

export async function getPlanningSuggestions(weekStart: Date) {
  return getPlanningSummary(weekStart)
}

export async function explainSuggestion(weekStart: Date, suggestionId: string): Promise<GerardSuggestion | null> {
  const analysis = await analyzePlanningForSuggestions(weekStart)
  return analysis.suggestions.find((item) => item.id === suggestionId) ?? null
}

export async function simulateSuggestion(weekStart: Date, suggestionId?: string) {
  const analysis = await analyzePlanningForSuggestions(weekStart)
  const suggestion = suggestionId ? analysis.suggestions.find((item) => item.id === suggestionId) : analysis.suggestions[0]
  return suggestion ? { status: 'VALID' as const, suggestion, snapshotFingerprint: analysis.snapshotFingerprint } : { status: 'STALE' as const, suggestion: null, snapshotFingerprint: analysis.snapshotFingerprint }
}

export function compatibilityReason(code: keyof typeof compatibilityMessages) {
  return compatibilityMessages[code]
}
