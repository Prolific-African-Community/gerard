import { prisma } from '../../prisma'
import { formatDateParam, getWeekEndDate } from '../date-utils'
import { buildAutoPlanningSnapshot } from '../auto-planning/snapshot'
import { reconcileOptimizationOutcomes } from '../auto-planning/simulation'
import { buildOptimizationCandidates, optimizeDispatch, rankOptimizationCandidates } from '../optimization/engine'
import type { OptimizationCandidate } from '../optimization/types'
import { evaluateMissionPrerequisites } from '../mission-prerequisites'
import { classifyPlanningPoolMission } from '../planning-pool'
import { isKnownReasonCode, translateReasonCode } from '../reason-labels'
import { analyzePlanningForSuggestions } from '../suggestions/planning-service'
import type { GerardSuggestion } from '../suggestions/types'
import { describeSuggestion } from './describe-suggestion'
import { getMissionContext, getPlanningInsights, getPlanningSummary, getResourceAvailability, resolveMissionReference, simulateSuggestion } from './facade'

/**
 * Outils en lecture seule exposés à l'agent conversationnel. Chacun enveloppe
 * une fonction déterministe existante : le moteur reste l'autorité, le modèle
 * ne fait qu'expliquer ce qu'il renvoie. Aucun outil n'écrit en base, aucun
 * n'émet de jeton de confirmation, aucun n'appelle un fournisseur de routes :
 * la requête entière s'exécute sous un budget Google de zéro appel.
 */
export type AgentToolContext = {
  weekStart: Date
  conversationContext?: { missionReference?: string; suggestionId?: string }
  now?: Date
  /** Mémoire d'une requête : un calcul coûteux n'est fait qu'une fois par tour de chat. */
  memo: Map<string, Promise<unknown>>
}

export type AgentTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  run: (args: Record<string, unknown>, context: AgentToolContext) => Promise<unknown>
}

export function createAgentToolContext(input: Omit<AgentToolContext, 'memo'>): AgentToolContext {
  return { ...input, memo: new Map() }
}

function once<T>(context: AgentToolContext, key: string, task: () => Promise<T>): Promise<T> {
  let pending = context.memo.get(key) as Promise<T> | undefined
  if (!pending) {
    pending = task()
    context.memo.set(key, pending)
    pending.catch(() => context.memo.delete(key))
  }
  return pending
}

const text = (value: unknown, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const iso = (value: Date | null | undefined) => value ? value.toISOString() : null
const km = (meters: number | null | undefined) => typeof meters === 'number' ? Math.round(meters / 100) / 10 : null
const minutes = (seconds: number | null | undefined) => typeof seconds === 'number' ? Math.round(seconds / 60) : null

function reason(code: string) {
  if (!isKnownReasonCode(code)) return { code, title: code, explanation: undefined, nature: 'UNKNOWN' as const, severity: 'CONDITIONAL' as const, demonstrated: false }
  const label = translateReasonCode(code)
  return { code, title: label.title, explanation: label.explanation, severity: label.severity, nature: label.nature, demonstrated: label.demonstrated }
}

function dayBounds(day: string | undefined) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const start = new Date(`${day}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime())) return null
  return { start, end: new Date(start.getTime() + 24 * 3600_000 - 1) }
}

function engineView(context: AgentToolContext) {
  return once(context, 'engine', async () => {
    const snapshot = await buildAutoPlanningSnapshot({ weekStartDate: context.weekStart, includeExistingForced: false, routeConcurrency: 8 })
    const result = optimizeDispatch({ ...snapshot.input, strategy: 'BALANCED' })
    const outcomes = reconcileOptimizationOutcomes({ result, includedMissionIds: snapshot.input.missions.map((mission) => mission.id) })
    return { snapshot, outcomes }
  })
}

async function summarizeCandidates(candidates: OptimizationCandidate[], limit: number) {
  const ranked = rankOptimizationCandidates(candidates)
  const conflictIds = Array.from(new Set(ranked.flatMap((candidate) => candidate.occupationConflicts.map((item) => item.occupiedMissionId))))
  const references = new Map((conflictIds.length ? await prisma.mission.findMany({ where: { id: { in: conflictIds } }, select: { id: true, reference: true } }) : []).map((item) => [item.id, item.reference]))
  return {
    candidatesEvaluated: ranked.length,
    assessment: classifyCandidates(ranked),
    best: ranked.slice(0, limit).map((candidate) => describeCandidate(candidate, references)),
  }
}

/**
 * Sépare ce que le moteur a démontré (blocage) de ce qui n'est qu'une réserve ou
 * une donnée absente. La gravité vient du dictionnaire de raisons existant ;
 * rien n'est décidé ici. Un blocage n'est « réel » pour la mission que si aucun
 * candidat ne reste viable : sinon il écarte seulement certains couples.
 */
type ReasonEntry = ReturnType<typeof reason> & { affectsCandidates: string }

function classifyCandidates(ranked: OptimizationCandidate[]) {
  const total = ranked.length
  const tally = new Map<string, number>()
  for (const candidate of ranked) {
    const codes = new Set([...candidate.compatibility.codes, ...(candidate.temporalEvaluation?.decisions ?? []), ...candidate.compatibility.missingData, ...(candidate.temporalEvaluation?.missingData ?? [])])
    for (const code of Array.from(codes)) if (code !== 'COMPATIBLE' && code !== 'COMPATIBLE_WITH_CONDITION') tally.set(code, (tally.get(code) ?? 0) + 1)
  }
  const viable = ranked.filter((candidate) => candidate.compatibility.status !== 'INCOMPATIBLE' && candidate.temporalEvaluation?.status !== 'IMPOSSIBLE')
  const blocking: ReasonEntry[] = []
  const missing: ReasonEntry[] = []
  const warnings: ReasonEntry[] = []
  for (const [code, count] of Array.from(tally.entries())) {
    const label = reason(code)
    const entry = { ...label, affectsCandidates: `${count}/${total}` }
    if (label.severity === 'INFO') continue
    if (label.severity === 'BLOCKING') blocking.push(entry)
    else if (label.nature === 'MISSING_DATA') missing.push(entry)
    else warnings.push(entry)
  }
  return {
    viableCandidates: viable.length,
    totalCandidates: total,
    // Vrai blocage de la mission : plus aucun candidat viable.
    hardBlockers: viable.length === 0 ? blocking : [],
    // Raisons qui n'écartent que certains couples : d'autres restent possibles.
    ruledOutCandidatesBecause: viable.length === 0 ? [] : blocking,
    missingData: missing,
    warnings,
  }
}

function describeCandidate(candidate: OptimizationCandidate, references: Map<string, string>) {
  return {
    driver: candidate.pair.driverName,
    truck: candidate.pair.truckPlateNumber,
    trailer: candidate.trailer?.plateNumber ?? null,
    compatibility: candidate.compatibility.status,
    compatibilityIssues: candidate.compatibility.codes.filter((code) => code !== 'COMPATIBLE').map(reason),
    temporalStatus: candidate.temporalEvaluation?.status ?? null,
    temporalIssues: (candidate.temporalEvaluation?.decisions ?? []).map(reason),
    temporalMessages: candidate.temporalEvaluation?.messages ?? [],
    missingData: Array.from(new Set([...candidate.compatibility.missingData, ...(candidate.temporalEvaluation?.missingData ?? [])])),
    possibleStartAt: candidate.temporalEvaluation?.possibleStartAt ?? null,
    overlaps: candidate.occupationConflicts.map((item) => ({ withMission: references.get(item.occupiedMissionId) ?? item.occupiedMissionId, resources: item.kinds, endOfOccupationKnown: !item.availabilityUnknown })),
    estimatedEmptyKm: candidate.cost.emptyDistanceKm,
    // Un trajet à vide absent du cache est estimé à vol d'oiseau : le dire.
    routeQuality: candidate.transitions.some((item) => item.source === 'ESTIMATED') ? 'ESTIMATED_NOT_CACHED' : 'STORED_OR_CACHED',
  }
}

function suggestionView(suggestion: GerardSuggestion) {
  return {
    suggestionId: suggestion.id,
    mission: suggestion.currentState.missionReference,
    currentDriver: suggestion.currentState.driverName,
    proposedDriver: suggestion.proposedState.driverName,
    proposedTruck: (suggestion.proposedState as { truckPlateNumber?: string }).truckPlateNumber ?? null,
    emptyKmDelta: suggestion.impact.emptyKm.delta,
    marginDelta: suggestion.impact.estimatedMargin.delta ?? null,
    score: suggestion.scoreBreakdown?.total ?? null,
    primaryReason: suggestion.scoreBreakdown?.primaryReason ?? null,
    confidence: suggestion.confidence,
    explanation: describeSuggestion(suggestion),
  }
}

async function resolveMission(context: AgentToolContext, args: Record<string, unknown>) {
  const reference = text(args.missionReference, 60) || context.conversationContext?.missionReference || ''
  if (!reference) return { error: 'MISSION_REFERENCE_REQUIRED' as const }
  const resolution = await resolveMissionReference(context.weekStart, reference)
  if (resolution.status === 'AMBIGUOUS') return { error: 'AMBIGUOUS_MISSION' as const, candidates: resolution.references }
  if (resolution.status !== 'FOUND' || !resolution.mission) {
    const weekEnd = getWeekEndDate(context.weekStart)
    const known = await prisma.mission.findMany({ where: { OR: [{ pickupDate: { gte: context.weekStart, lte: weekEnd } }, { assignment: { scheduledDate: { gte: context.weekStart, lte: weekEnd } } }] }, select: { reference: true }, orderBy: { pickupDate: 'asc' }, take: 15 })
    return { error: 'MISSION_NOT_FOUND' as const, reference, missionsThisWeek: known.map((item) => item.reference) }
  }
  return { mission: resolution.mission }
}

const missionReferenceProperty = { type: 'string', description: 'Référence de la mission (ex. GRD-260916-06) ou numéro court. Omettre pour utiliser la mission sélectionnée dans la conversation.' }

const getWeekOverview: AgentTool = {
  name: 'get_week_overview',
  description: 'Situation du planning sur la semaine affichée (ou un jour) : missions planifiées et non planifiées, conflits, données incomplètes, opportunités, temps morts entre missions par chauffeur, avec les preuves. À utiliser pour « qu’est-ce qui ne va pas », « où perd-on du temps », « que ferais-tu ».',
  parameters: { type: 'object', additionalProperties: false, properties: { day: { type: ['string', 'null'], description: 'Jour AAAA-MM-JJ pour restreindre la vue, sinon null pour toute la semaine.' } }, required: ['day'] },
  async run(args, context) {
    const bounds = dayBounds(text(args.day, 10))
    const weekEnd = getWeekEndDate(context.weekStart)
    const [summary, insights, missions] = await Promise.all([
      getPlanningSummary(context.weekStart),
      getPlanningInsights(context.weekStart, { limit: 40, now: context.now }),
      prisma.mission.findMany({
        where: { OR: [{ pickupDate: { gte: context.weekStart, lte: weekEnd } }, { assignment: { scheduledDate: { gte: context.weekStart, lte: weekEnd } } }] },
        orderBy: [{ pickupDate: 'asc' }, { id: 'asc' }],
        take: 120,
        include: { assignment: { include: { driver: { select: { name: true } }, truck: { select: { plateNumber: true } }, trailer: { select: { plateNumber: true } } } } },
      }),
    ])
    const inScope = (mission: (typeof missions)[number]) => {
      if (!bounds) return true
      const at = mission.assignment?.scheduledDate ?? mission.pickupDate
      return Boolean(at && at >= bounds.start && at <= bounds.end)
    }
    const scoped = missions.filter(inScope)
    const idToReference = new Map(missions.map((mission) => [mission.id, mission.reference]))
    const view = scoped.map((mission) => ({
      reference: mission.reference,
      status: mission.status,
      from: mission.pickupCity ?? mission.pickupAddress ?? null,
      to: mission.deliveryCity ?? mission.deliveryAddress ?? null,
      pickupAt: iso(mission.pickupDate),
      driver: mission.assignment?.driver?.name ?? null,
      truck: mission.assignment?.truck?.plateNumber ?? null,
      trailer: mission.assignment?.trailer?.plateNumber ?? null,
      startsAt: iso(mission.assignment?.scheduledDate),
      endsAt: iso(mission.assignment?.plannedEndAt ?? mission.deliveryDate),
      storedDistanceKm: km(mission.routeDistanceMeters),
      storedDurationMin: minutes(mission.routeDurationSeconds),
      approachKm: km(mission.assignment?.approachDistanceMeters),
      approachMin: minutes(mission.assignment?.approachDurationSeconds),
      preparationStatus: mission.preparationStatus,
    }))
    // Temps morts : écart entre la fin d'une mission et le début de la suivante
    // pour un même chauffeur, calculé sur les horaires déjà planifiés.
    const byDriver = new Map<string, typeof view>()
    for (const mission of view) {
      if (!mission.driver || !mission.startsAt) continue
      byDriver.set(mission.driver, [...(byDriver.get(mission.driver) ?? []), mission])
    }
    const idleGaps = Array.from(byDriver.entries()).flatMap(([driver, items]) => {
      const ordered = [...items].sort((left, right) => String(left.startsAt).localeCompare(String(right.startsAt)))
      return ordered.slice(1).flatMap((next, index) => {
        const previous = ordered[index]
        const gap = previous.endsAt && next.startsAt ? Math.round((new Date(next.startsAt).getTime() - new Date(previous.endsAt).getTime()) / 60000) : null
        return gap !== null && gap >= 60 ? [{ driver, after: previous.reference, before: next.reference, gapMinutes: gap }] : []
      })
    }).sort((left, right) => right.gapMinutes - left.gapMinutes).slice(0, 10)
    const relevantInsights = insights.insights.filter((insight) => !bounds || insight.missionIds.some((id) => view.some((mission) => mission.reference === idToReference.get(id))) || !insight.missionIds.length)
    return {
      scope: bounds ? { day: text(args.day, 10) } : { week: formatDateParam(context.weekStart) },
      counts: Object.fromEntries(summary.facts.map((item) => [item.label, item.value])),
      incompleteAnalysisWarnings: summary.warnings,
      insightsBySeverity: insights.bySeverity,
      insights: relevantInsights.map((insight) => ({
        type: insight.type,
        severity: insight.severity,
        title: insight.title,
        summary: insight.summary,
        missions: insight.missionIds.map((id) => idToReference.get(id) ?? id),
        evidence: insight.evidence,
        occursAt: insight.occursAt,
      })),
      optimizationSuggestions: (summary.suggestions ?? []).slice(0, 5).map(suggestionView),
      missions: view,
      idleGapsOver60Minutes: idleGaps,
      note: 'Les distances viennent des trajets déjà stockés ou en cache ; une valeur null signifie « non disponible », pas zéro. La gravité CRITICAL d’un insight signifie « urgent » (ex. enlèvement dépassé), pas une violation de règle. Cette vue ne dit pas POURQUOI les missions ne sont pas planifiées : voir get_mission_blockers (scope all_unassigned).',
    }
  },
}

const getMissionFacts: AgentTool = {
  name: 'get_mission_facts',
  description: 'Faits détaillés d’une mission : statut, adresses, horaires, chauffeur/camion/remorque affectés, trajet et approche déjà stockés, rentabilité estimée, diagnostics, état de préparation.',
  parameters: { type: 'object', additionalProperties: false, properties: { missionReference: missionReferenceProperty }, required: ['missionReference'] },
  async run(args, context) {
    const resolved = await resolveMission(context, args)
    if ('error' in resolved) return resolved
    const mission = resolved.mission
    const missionContext = await getMissionContext(context.weekStart, mission.reference)
    const assignment = mission.assignment
    return {
      reference: mission.reference,
      facts: Object.fromEntries((missionContext?.facts ?? []).map((item) => [item.label, { value: item.value, source: item.source, confidence: item.confidence ?? null }])),
      route: { storedDistanceKm: km(mission.routeDistanceMeters), storedDurationMin: minutes(mission.routeDurationSeconds), calculatedAt: iso(mission.routeCalculatedAt), provider: mission.routeProvider },
      approach: assignment ? { distanceKm: km(assignment.approachDistanceMeters), durationMin: minutes(assignment.approachDurationSeconds), calculatedAt: iso(assignment.approachCalculatedAt) } : null,
      preparation: { status: mission.preparationStatus, pickupAddressStatus: mission.pickupResolutionStatus, deliveryAddressStatus: mission.deliveryResolutionStatus, pickupReason: mission.pickupResolutionReason, deliveryReason: mission.deliveryResolutionReason },
      diagnostics: (missionContext?.warnings ?? []).map(reason),
      alternativesNote: 'Les alternatives valides sont celles confirmées par le moteur ; utiliser get_planning_suggestions pour les détails.',
    }
  },
}

function planability(category: string | null, assessment: ReturnType<typeof classifyCandidates>) {
  if (category === 'CONFIRMED') return 'YES'
  if (category === 'CONDITIONAL') return 'YES_WITH_RESERVE'
  if (assessment.totalCandidates === 0) return 'NO_CANDIDATE'
  if (assessment.viableCandidates === 0) return 'NO'
  return 'POSSIBLE_BUT_NOT_PROPOSED'
}

const getMissionBlockers: AgentTool = {
  name: 'get_mission_blockers',
  description: 'Pourquoi une mission n’est pas planifiée ou ne peut pas être affectée. Renvoie un verdict déjà trié en vrais blocages (hardBlockers), réserves (warnings) et données manquantes (missingData), le verdict du moteur, et les meilleurs couples chauffeur/camion/remorque candidats avec leurs chevauchements. scope "mission" = une mission précise ; scope "all_unassigned" = digest compact de toutes les missions non planifiées de la semaine (à utiliser pour « qu’est-ce qui ne va pas / pourquoi rien n’est planifié » après get_week_overview). Une donnée manquante n’est PAS une incompatibilité.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      scope: { type: 'string', enum: ['mission', 'all_unassigned'], description: '"mission" pour une mission précise, "all_unassigned" pour le digest de la semaine.' },
      missionReference: { type: ['string', 'null'], description: 'Référence de la mission (scope "mission"). Null pour utiliser la mission sélectionnée dans la conversation.' },
    },
    required: ['scope', 'missionReference'],
  },
  async run(args, context) {
    if (text(args.scope, 20) === 'all_unassigned') {
      const { snapshot, outcomes } = await engineView(context)
      const titles = (entries: ReasonEntry[]) => entries.map((entry) => `${entry.title} (${entry.affectsCandidates})`)
      return {
        missions: snapshot.input.missions.map((mission) => {
          const ranked = rankOptimizationCandidates(buildOptimizationCandidates(snapshot.input, mission))
          const assessment = classifyCandidates(ranked)
          const best = ranked[0]
          const category = outcomes.find((item) => item.missionId === mission.id)?.category ?? null
          return {
            reference: mission.reference,
            engineVerdict: category,
            canBePlanned: planability(category, assessment),
            hardBlockers: titles(assessment.hardBlockers),
            missingData: titles(assessment.missingData),
            warnings: titles(assessment.warnings),
            missionDataGaps: mission.missingData,
            bestCandidate: best ? { driver: best.pair.driverName, truck: best.pair.truckPlateNumber, trailer: best.trailer?.plateNumber ?? null, compatibility: best.compatibility.status, routeQuality: best.transitions.some((item) => item.source === 'ESTIMATED') ? 'ESTIMATED_NOT_CACHED' : 'STORED_OR_CACHED' } : null,
          }
        }),
        excludedFromSimulation: snapshot.missionScope.exclusions.map((item) => ({ reference: item.reference, reason: item.reason, code: reason(item.code) })),
        note: 'Vue compacte ; appeler scope "mission" pour le détail d’une mission.',
      }
    }
    const resolved = await resolveMission(context, args)
    if ('error' in resolved) return resolved
    const mission = resolved.mission
    const weekEnd = getWeekEndDate(context.weekStart)
    const prerequisites = evaluateMissionPrerequisites(mission, { assigned: Boolean(mission.assignment?.driverId), regulatoryStateKnown: true })
    const poolBucket = classifyPlanningPoolMission({ status: mission.status, preparationStatus: mission.preparationStatus, pickupDate: mission.pickupDate, deliveryDate: mission.deliveryDate, assignment: mission.assignment, weekStart: context.weekStart, weekEnd })
    const base = {
      reference: mission.reference,
      status: mission.status,
      poolBucket,
      assigned: Boolean(mission.assignment),
      preparationStatus: mission.preparationStatus,
      prerequisitesNotConfirmed: prerequisites.filter((item) => item.key !== 'driver' && (item.status === 'MISSING' || item.status === 'ACTION_REQUIRED')).map((item) => ({ item: item.key, label: item.label, status: item.status, detail: item.detail })),
    }
    if (mission.assignment) {
      const analysis = await analyzePlanningForSuggestions(context.weekStart)
      const diagnostic = analysis.missionDiagnostics.find((item) => item.missionId === mission.id)
      return {
        ...base,
        currentAssignment: { driver: mission.assignment.driver?.name ?? null, truck: mission.assignment.truck?.plateNumber ?? null, trailer: mission.assignment.trailer?.plateNumber ?? null, startsAt: iso(mission.assignment.scheduledDate) },
        engineDiagnostics: (diagnostic?.diagnostics ?? []).filter((code) => code !== 'ANALYZED').map(reason),
        validAlternatives: diagnostic?.validAlternatives ?? 0,
        suggestions: analysis.suggestions.filter((item) => item.affectedMissionIds.includes(mission.id)).map(suggestionView),
        note: 'La mission est déjà affectée : ce ne sont pas des blocages de planification mais des diagnostics sur l’affectation actuelle.',
      }
    }
    const { snapshot, outcomes } = await engineView(context)
    const outcome = outcomes.find((item) => item.missionId === mission.id)
    const optimizationMission = snapshot.input.missions.find((item) => item.id === mission.id)
    const candidates = optimizationMission ? await summarizeCandidates(buildOptimizationCandidates(snapshot.input, optimizationMission), 6) : null
    return {
      ...base,
      engineVerdict: outcome ? { category: outcome.category, reason: outcome.reason, code: reason(outcome.code) } : null,
      canBePlanned: candidates ? planability(outcome?.category ?? null, candidates.assessment) : 'UNKNOWN',
      missionDataGaps: optimizationMission?.missingData ?? null,
      candidates,
      note: optimizationMission ? 'Trajets non présents en cache : estimés (routeQuality), jamais recalculés pour le chat.' : 'Mission hors du périmètre de simulation : voir engineVerdict.',
    }
  },
}

type ResourceKind = 'driver' | 'truck' | 'trailer'

async function findResources(kind: ResourceKind | '', name: string) {
  const kinds: ResourceKind[] = kind ? [kind] : ['driver', 'truck', 'trailer']
  for (const candidate of kinds) {
    if (candidate === 'driver') {
      const rows = await prisma.driver.findMany({ where: { name: { contains: name, mode: 'insensitive' } }, take: 5 })
      if (rows.length) return { kind: candidate, rows: rows.map((row) => ({ id: row.id, label: row.name, row })) }
    } else if (candidate === 'truck') {
      const rows = await prisma.truck.findMany({ where: { plateNumber: { contains: name, mode: 'insensitive' } }, take: 5 })
      if (rows.length) return { kind: candidate, rows: rows.map((row) => ({ id: row.id, label: row.plateNumber, row })) }
    } else {
      const rows = await prisma.trailer.findMany({ where: { plateNumber: { contains: name, mode: 'insensitive' } }, take: 5 })
      if (rows.length) return { kind: candidate, rows: rows.map((row) => ({ id: row.id, label: row.plateNumber, row })) }
    }
  }
  return null
}

const getResourceFacts: AgentTool = {
  name: 'get_resource_facts',
  description: 'Faits sur un chauffeur, un camion ou une remorque : statut, affectations de la semaine, dernière position connue, et si une mission est précisée, chevauchements et verdict du moteur pour cette ressource sur cette mission (« Marc peut-il prendre cette mission ? »).',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      kind: { type: ['string', 'null'], enum: ['driver', 'truck', 'trailer', null], description: 'Type de ressource, ou null si inconnu.' },
      name: { type: 'string', description: 'Nom (même partiel) du chauffeur, ou immatriculation du camion/de la remorque.' },
      missionReference: { type: ['string', 'null'], description: 'Mission à évaluer pour cette ressource, ou null pour utiliser la mission sélectionnée, ou aucune.' },
    },
    required: ['kind', 'name', 'missionReference'],
  },
  async run(args, context) {
    const name = text(args.name, 80)
    if (!name) return { error: 'RESOURCE_NAME_REQUIRED' }
    const kindArg = args.kind === 'driver' || args.kind === 'truck' || args.kind === 'trailer' ? args.kind : ''
    const found = await findResources(kindArg, name)
    if (!found) {
      const [drivers, trucks, trailers] = await Promise.all([
        prisma.driver.findMany({ select: { name: true }, take: 30 }),
        prisma.truck.findMany({ select: { plateNumber: true }, take: 30 }),
        prisma.trailer.findMany({ select: { plateNumber: true }, take: 30 }),
      ])
      return { error: 'RESOURCE_NOT_FOUND', name, knownDrivers: drivers.map((item) => item.name), knownTrucks: trucks.map((item) => item.plateNumber), knownTrailers: trailers.map((item) => item.plateNumber) }
    }
    if (found.rows.length > 1) return { error: 'AMBIGUOUS_RESOURCE', kind: found.kind, candidates: found.rows.map((row) => row.label) }
    const { id, label, row } = found.rows[0]
    const weekEnd = getWeekEndDate(context.weekStart)
    const key = found.kind === 'driver' ? 'driverId' : found.kind === 'truck' ? 'truckId' : 'trailerId'
    const assignments = await prisma.missionAssignment.findMany({
      where: { [key]: id, scheduledDate: { gte: context.weekStart, lte: weekEnd } },
      orderBy: { scheduledDate: 'asc' },
      include: { mission: { select: { reference: true, deliveryDate: true, pickupCity: true, deliveryCity: true } } },
    })
    const identity: Record<string, unknown> = found.kind === 'driver'
      ? { status: (row as { status: string }).status }
      : found.kind === 'truck'
        ? { status: (row as { status: string }).status, inspectionExpiresAt: iso((row as { technicalInspectionExpiresAt: Date | null }).technicalInspectionExpiresAt), capacityKg: (row as { capacityKg: number | null }).capacityKg, couplingType: (row as { couplingType: string | null }).couplingType }
        : { status: (row as { status: string }).status, type: (row as { type: string }).type, inspectionExpiresAt: iso((row as { technicalInspectionExpiresAt: Date | null }).technicalInspectionExpiresAt), capacityKg: (row as { capacityKg: number | null }).capacityKg, couplingType: (row as { couplingType: string | null }).couplingType, lastKnownLocation: (row as { currentLocationAddress: string | null }).currentLocationAddress, locationUpdatedAt: iso((row as { currentLocationUpdatedAt: Date | null }).currentLocationUpdatedAt) }
    if (found.kind === 'driver') {
      const position = await prisma.driverPosition.findFirst({ where: { driverId: id }, orderBy: { recordedAt: 'desc' } })
      identity.lastKnownPosition = position ? { latitude: position.latitude, longitude: position.longitude, recordedAt: iso(position.recordedAt), provider: position.provider } : null
    }
    const result: Record<string, unknown> = {
      kind: found.kind,
      resource: label,
      ...identity,
      weekAssignments: assignments.map((item) => ({ mission: item.mission.reference, from: item.mission.pickupCity, to: item.mission.deliveryCity, startsAt: iso(item.scheduledDate), endsAt: iso(item.plannedEndAt ?? item.mission.deliveryDate) })),
    }
    const missionReference = text(args.missionReference, 60) || context.conversationContext?.missionReference || ''
    if (!missionReference) return result
    const resolved = await resolveMission(context, { missionReference })
    if ('error' in resolved) return { ...result, missionEvaluation: resolved }
    const mission = resolved.mission
    if (mission.assignment) {
      // Mission déjà affectée : le moteur d'intelligence a déjà évalué les
      // alternatives, on réutilise sa vérification de disponibilité.
      const availability = await getResourceAvailability({ weekStart: context.weekStart, missionReference: mission.reference, ...(found.kind === 'driver' ? { driverName: label } : found.kind === 'truck' ? { truckPlate: label } : { trailerPlate: label }) })
      return {
        ...result,
        missionEvaluation: {
          mission: mission.reference,
          currentlyAssignedToThisResource: mission.assignment[key] === id,
          availableOnSlot: availability?.facts.find((item) => item.label === 'Disponible sur le créneau')?.value ?? null,
          overlaps: availability?.warnings.filter((warning) => / est déjà affecté /.test(warning)) ?? [],
          engineValidatesReassignment: Boolean(availability?.details?.candidateValidated),
          note: 'Seule une réaffectation validée par le moteur (seuils économiques inclus) est proposée ; l’absence de chevauchement ne suffit pas.',
        },
      }
    }
    const { snapshot } = await engineView(context)
    const optimizationMission = snapshot.input.missions.find((item) => item.id === mission.id)
    const candidates = optimizationMission ? buildOptimizationCandidates(snapshot.input, optimizationMission).filter((candidate) => found.kind === 'driver' ? candidate.pair.pair.driverId === id : found.kind === 'truck' ? candidate.pair.pair.truckId === id : candidate.trailer?.id === id) : []
    const summary = await summarizeCandidates(candidates, 4)
    const windowStart = mission.pickupDate ?? null
    const windowEnd = mission.deliveryDate ?? null
    const overlaps = windowStart && windowEnd ? assignments.filter((item) => item.scheduledDate < windowEnd && (item.plannedEndAt ?? item.mission.deliveryDate ?? item.scheduledDate) > windowStart).map((item) => item.mission.reference) : []
    return {
      ...result,
      missionEvaluation: {
        mission: mission.reference,
        missionPlanned: false,
        overlapsWithPlannedMissions: overlaps,
        engineCandidates: summary,
        note: optimizationMission ? 'Résultat du moteur de planification : un candidat absent de la liste n’a pas été généré (ressource exclue ou hors périmètre).' : 'La mission n’est pas dans le périmètre de simulation de la semaine.',
      },
    }
  },
}

const getPlanningSuggestions: AgentTool = {
  name: 'get_planning_suggestions',
  description: 'Suggestions d’optimisation validées par le moteur (réaffectations) avec preuves : kilomètres à vide gagnés, marge, score, raison principale, confiance. Optionnellement filtrées sur une mission.',
  parameters: { type: 'object', additionalProperties: false, properties: { missionReference: { type: ['string', 'null'], description: 'Référence pour filtrer, ou null pour toute la semaine.' } }, required: ['missionReference'] },
  async run(args, context) {
    const analysis = await analyzePlanningForSuggestions(context.weekStart)
    const reference = text(args.missionReference, 60)
    const filtered = reference ? analysis.suggestions.filter((item) => item.currentState.missionReference.toLowerCase().endsWith(reference.toLowerCase())) : analysis.suggestions
    return {
      summary: analysis.summary,
      diagnostics: analysis.diagnostics,
      suggestions: filtered.slice(0, 8).map(suggestionView),
      note: analysis.diagnostics.incomplete ? `${analysis.diagnostics.incomplete} mission(s) non analysées complètement (données manquantes).` : null,
    }
  },
}

const simulatePlanningSuggestion: AgentTool = {
  name: 'simulate_planning_suggestion',
  description: 'Revalide (lecture seule) qu’une suggestion désignée est toujours valide. N’applique rien : l’application passe uniquement par la confirmation explicite de l’utilisateur dans l’interface.',
  parameters: { type: 'object', additionalProperties: false, properties: { suggestionId: { type: ['string', 'null'], description: 'Identifiant de suggestion (issu de get_planning_suggestions), ou null pour celle de la conversation.' } }, required: ['suggestionId'] },
  async run(args, context) {
    const suggestionId = text(args.suggestionId, 200) || context.conversationContext?.suggestionId || ''
    const result = await simulateSuggestion(context.weekStart, suggestionId)
    return {
      status: result.status,
      suggestion: result.suggestion ? suggestionView(result.suggestion) : null,
      applied: false,
      note: 'Simulation uniquement. Pour appliquer, l’utilisateur doit utiliser le bouton de confirmation.',
    }
  },
}

export const agentTools: AgentTool[] = [getWeekOverview, getMissionFacts, getMissionBlockers, getResourceFacts, getPlanningSuggestions, simulatePlanningSuggestion]
