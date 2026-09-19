export type MissionDisplayLocation =
  | "WEEK_GRID"
  | "UNPLANNED_POOL"
  | "INCOMPLETE_POOL"
  | "HISTORY"
  | "REVIEW"

type MissionDisplayInput = {
  status?: string | null
  preparationStatus?: string | null
  pickupDate?: Date | string | null
  assignment?: {
    scheduledDate?: Date | string | null
    plannedEndAt?: Date | string | null
  } | null
  weekStart?: Date | null
  weekEnd?: Date | null
}

const terminalStatuses = new Set(["DONE", "CANCELLED", "ARCHIVED"])
const reviewPreparationStatuses = new Set(["REVIEW_REQUIRED", "FAILED"])

function asDate(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The sole display classification for a persisted mission. A missing business
 * field is never a reason to hide a mission: it only changes the destination
 * pool and the explanation shown to the dispatcher.
 */
export function getMissionDisplayLocation(
  mission: MissionDisplayInput,
): MissionDisplayLocation {
  const status = mission.status?.toUpperCase() ?? "PENDING"
  if (terminalStatuses.has(status)) return "HISTORY"

  const scheduledDate = asDate(mission.assignment?.scheduledDate)
  const plannedEndAt = asDate(mission.assignment?.plannedEndAt)
  if (scheduledDate) {
    const weekStart = mission.weekStart
    const weekEnd = mission.weekEnd
    if (!weekStart || !weekEnd) return "WEEK_GRID"

    // A scheduled start inside the selected week always belongs to that grid.
    // An old delivery date must never hide a valid manual assignment.
    if (scheduledDate >= weekStart && scheduledDate <= weekEnd) {
      return "WEEK_GRID"
    }
    if (plannedEndAt && plannedEndAt > weekStart && scheduledDate <= weekEnd) {
      return "WEEK_GRID"
    }
  }

  if (reviewPreparationStatuses.has(mission.preparationStatus ?? "")) {
    return "REVIEW"
  }

  if (!asDate(mission.pickupDate)) return "INCOMPLETE_POOL"
  return "UNPLANNED_POOL"
}

export function getMissionDisplayReason(location: MissionDisplayLocation) {
  switch (location) {
    case "WEEK_GRID":
      return "Affectée à la semaine sélectionnée"
    case "UNPLANNED_POOL":
      return "Non affectée"
    case "INCOMPLETE_POOL":
      return "Date ou informations à compléter"
    case "REVIEW":
      return "À vérifier avant planification"
    case "HISTORY":
      return "Mission terminée, annulée ou archivée"
  }
}
