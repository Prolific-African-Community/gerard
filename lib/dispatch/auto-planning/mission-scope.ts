import {
  getMissionOccupation,
  missionIntersectsPeriod,
} from '../multi-day-mission'

export type PlanningMissionScopeCode =
  | 'INCLUDED'
  | 'MISSING_PICKUP_DATE'
  | 'OUTSIDE_PERIOD'
  | 'STATUS_EXCLUDED'
  | 'ALREADY_ASSIGNED'
  | 'FORCED_EXISTING'

export type PlanningMissionScopeItem = {
  missionId: string
  reference: string
  status: string
  pickupDate: string | null
  deliveryDate: string | null
  code: PlanningMissionScopeCode
  reason: string
}

export type PlanningMissionScopeSummary = {
  periodStart: string
  periodEnd: string
  visibleMissionIds: string[]
  includedMissionIds: string[]
  exclusions: PlanningMissionScopeItem[]
  statusExclusions: PlanningMissionScopeItem[]
  counts: {
    visible: number
    included: number
    outsidePeriod: number
    missingPickupDate: number
    excludedByStatus: number
    alreadyAssigned: number
    forcedExisting: number
    manualPreserved: number
  }
}

type MissionScopeSource = {
  id: string
  reference: string
  status: string
  pickupDate: Date | string | null
  deliveryDate?: Date | string | null
  routeDurationSeconds?: number | null
  assignment?: {
    scheduledDate: Date | string
    plannedEndAt?: Date | string | null
  } | null
}

function asIso(value: Date | string | null) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function classifyPlanningMissions(input: {
  missions: MissionScopeSource[]
  periodStart: Date
  periodEnd: Date
  includeExistingForced: boolean
}): PlanningMissionScopeSummary {
  const visibleMissionIds: string[] = []
  const includedMissionIds: string[] = []
  const exclusions: PlanningMissionScopeItem[] = []
  const statusExclusions: PlanningMissionScopeItem[] = []
  let forcedExisting = 0
  let manualPreserved = 0

  for (const mission of input.missions) {
    const pickupDate = asIso(mission.pickupDate)
    const deliveryDate = asIso(mission.deliveryDate ?? null)
    const occupation = getMissionOccupation({
      pickupDate: mission.pickupDate,
      deliveryDate: mission.deliveryDate,
      routeDurationSeconds: mission.routeDurationSeconds,
      scheduledDate: mission.assignment?.scheduledDate,
      plannedEndAt: mission.assignment?.plannedEndAt,
    })
    const assignmentDate = mission.assignment
      ? asIso(mission.assignment.scheduledDate)
      : null
    const assignmentInPeriod =
      assignmentDate !== null &&
      missionIntersectsPeriod(occupation, input.periodStart, input.periodEnd)
    const visible =
      mission.status === 'PENDING' ||
      (mission.status === 'ASSIGNED' && assignmentInPeriod)
    if (visible) visibleMissionIds.push(mission.id)
    if (
      mission.assignment &&
      !input.includeExistingForced &&
      assignmentInPeriod
    ) {
      manualPreserved += 1
      exclusions.push({
        missionId: mission.id,
        reference: mission.reference,
        status: mission.status,
        pickupDate,
        deliveryDate,
        code: 'ALREADY_ASSIGNED',
        reason: `Mission déjà affectée le ${assignmentDate}. Décision manuelle préservée.`,
      })
      continue
    }

    const statusAccepted =
      mission.status === 'PENDING' ||
      (input.includeExistingForced && mission.status === 'ASSIGNED')
    if (!statusAccepted) {
      statusExclusions.push({
        missionId: mission.id,
        reference: mission.reference,
        status: mission.status,
        pickupDate,
        deliveryDate,
        code: 'STATUS_EXCLUDED',
        reason: `Statut ${mission.status} non admissible pour cette simulation.`,
      })
      continue
    }
    if (!pickupDate) {
      exclusions.push({
        missionId: mission.id,
        reference: mission.reference,
        status: mission.status,
        pickupDate: null,
        deliveryDate,
        code: 'MISSING_PICKUP_DATE',
        reason: 'Date de chargement absente.',
      })
      continue
    }
    if (
      !missionIntersectsPeriod(
        occupation,
        input.periodStart,
        input.periodEnd
      )
    ) {
      exclusions.push({
        missionId: mission.id,
        reference: mission.reference,
        status: mission.status,
        pickupDate,
        deliveryDate,
        code: 'OUTSIDE_PERIOD',
        reason: `Chargement prévu le ${pickupDate}, hors de la semaine sélectionnée.`,
      })
      continue
    }
    if (mission.assignment && !input.includeExistingForced) {
      manualPreserved += 1
      exclusions.push({
        missionId: mission.id,
        reference: mission.reference,
        status: mission.status,
        pickupDate,
        deliveryDate,
        code: 'ALREADY_ASSIGNED',
        reason: `Mission déjà affectée le ${asIso(
          mission.assignment.scheduledDate
        )}.`,
      })
      continue
    }
    if (mission.assignment && input.includeExistingForced) {
      forcedExisting += 1
    }
    includedMissionIds.push(mission.id)
  }

  return {
    periodStart: input.periodStart.toISOString(),
    periodEnd: input.periodEnd.toISOString(),
    visibleMissionIds,
    includedMissionIds,
    exclusions,
    statusExclusions,
    counts: {
      visible: visibleMissionIds.length,
      included: includedMissionIds.length,
      outsidePeriod: exclusions.filter((item) => item.code === 'OUTSIDE_PERIOD')
        .length,
      missingPickupDate: exclusions.filter(
        (item) => item.code === 'MISSING_PICKUP_DATE'
      ).length,
      excludedByStatus: statusExclusions.length,
      alreadyAssigned: exclusions.filter(
        (item) => item.code === 'ALREADY_ASSIGNED'
      ).length,
      forcedExisting,
      manualPreserved,
    },
  }
}
