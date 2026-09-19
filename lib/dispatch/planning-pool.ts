/**
 * Classification du bandeau « Missions à planifier ».
 *
 * Invariant central : la source de vérité de l'affectation est la relation
 * `Mission.assignment` (table MissionAssignment), jamais `Mission.status` et
 * jamais la liste d'affectations restreinte à la semaine affichée.
 *
 * Une mission affectée reste affectée quelle que soit la semaine consultée :
 * changer de semaine ne peut donc plus la réintroduire dans le pool.
 */

export type PlanningPoolBucket =
  /** Affectation réelle : appartient à la grille, jamais au pool. */
  | "SCHEDULED"
  /** Non affectée et pertinente pour la semaine affichée. */
  | "PLANNABLE"
  /** Non affectée, date de transport dépassée : retard. */
  | "BACKLOG"
  /** Non affectée, transport postérieur à la semaine affichée. */
  | "UPCOMING"
  /** Non affectée, aucune date de transport exploitable. */
  | "TO_VERIFY"
  /** `status = ASSIGNED` sans MissionAssignment : incohérence de données. */
  | "ANOMALY"
  /** Terminée, annulée ou archivée. */
  | "HISTORY"

export type PlanningPoolAssignment = {
  id?: string | null
  scheduledDate?: Date | string | null
  plannedEndAt?: Date | string | null
  planningRowId?: string | null
  driverId?: string | null
  truckId?: string | null
}

export type PlanningPoolInput = {
  status?: string | null
  preparationStatus?: string | null
  pickupDate?: Date | string | null
  deliveryDate?: Date | string | null
  /**
   * Affectation réelle de la mission, indépendante de la semaine affichée.
   * `null` signifie « aucune MissionAssignment en base », pas « pas affectée
   * cette semaine-là ».
   */
  assignment?: PlanningPoolAssignment | null
  weekStart?: Date | string | null
  weekEnd?: Date | string | null
}

const TERMINAL_STATUSES = new Set(["DONE", "CANCELLED", "ARCHIVED"])
const REVIEW_PREPARATION_STATUSES = new Set(["REVIEW_REQUIRED", "FAILED"])

export function toDate(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Une affectation ne compte que si la ligne existe réellement. Une ligne
 * totalement orpheline (ni planning, ni chauffeur, ni camion, ni date) est
 * traitée comme inactive.
 */
export function hasActiveAssignment(
  assignment: PlanningPoolAssignment | null | undefined,
): boolean {
  if (!assignment) return false
  return Boolean(
    assignment.planningRowId ||
      assignment.driverId ||
      assignment.truckId ||
      toDate(assignment.scheduledDate),
  )
}

/**
 * La préparation automatique (géocodage, itinéraire) peut échouer sans que la
 * mission cesse d'être planifiable par un humain : c'est un signal de carte,
 * pas un critère de tri du bandeau.
 */
export function needsPreparationReview(preparationStatus?: string | null) {
  return REVIEW_PREPARATION_STATUSES.has(preparationStatus ?? "")
}

/**
 * Date à laquelle le transport doit avoir lieu. `createdAt` n'est jamais
 * utilisé : une mission créée aujourd'hui pour octobre n'est pas du travail
 * de la semaine courante.
 */
export function getTransportReferenceDate(input: PlanningPoolInput) {
  return toDate(input.pickupDate) ?? toDate(input.deliveryDate)
}

export function classifyPlanningPoolMission(
  input: PlanningPoolInput,
): PlanningPoolBucket {
  const status = input.status?.toUpperCase() ?? "PENDING"

  if (TERMINAL_STATUSES.has(status)) return "HISTORY"

  // Règles 1, 2 et 3 : une affectation réelle sort définitivement la mission
  // du pool, quelle que soit la semaine affichée.
  if (hasActiveAssignment(input.assignment)) return "SCHEDULED"

  // Le statut prétend « assignée » alors qu'aucune affectation n'existe :
  // incohérence à signaler, surtout pas du travail à replanifier en silence.
  if (status === "ASSIGNED") return "ANOMALY"

  const reference = getTransportReferenceDate(input)
  if (!reference) return "TO_VERIFY"

  const weekStart = toDate(input.weekStart)
  const weekEnd = toDate(input.weekEnd)

  // Sans fenêtre de semaine, on ne peut pas juger la pertinence temporelle :
  // la mission reste planifiable plutôt que d'être masquée à tort.
  if (!weekStart || !weekEnd) return "PLANNABLE"

  if (reference < weekStart) return "BACKLOG"
  if (reference > weekEnd) return "UPCOMING"
  return "PLANNABLE"
}

export type ClassifiedMission<T> = {
  mission: T
  bucket: PlanningPoolBucket
  needsReview: boolean
}

export function classifyPlanningPoolMissions<T extends PlanningPoolInput>(
  missions: T[],
  window: { weekStart?: Date | string | null; weekEnd?: Date | string | null },
): ClassifiedMission<T>[] {
  return missions.map((mission) => ({
    mission,
    bucket: classifyPlanningPoolMission({ ...mission, ...window }),
    needsReview: needsPreparationReview(mission.preparationStatus),
  }))
}

/** Rail principal : uniquement le travail réellement à planifier. */
export function selectPlanningRail<T>(classified: ClassifiedMission<T>[]) {
  return classified
    .filter((item) => item.bucket === "PLANNABLE")
    .map((item) => item.mission)
}

/**
 * Travail annexe, présenté séparément du rail principal pour ne pas noyer la
 * semaine opérationnelle sous l'historique.
 */
export function selectPlanningAttention<T>(classified: ClassifiedMission<T>[]) {
  return {
    backlog: classified
      .filter((item) => item.bucket === "BACKLOG")
      .map((item) => item.mission),
    toVerify: classified
      .filter((item) => item.bucket === "TO_VERIFY")
      .map((item) => item.mission),
    upcoming: classified
      .filter((item) => item.bucket === "UPCOMING")
      .map((item) => item.mission),
    anomalies: classified
      .filter((item) => item.bucket === "ANOMALY")
      .map((item) => item.mission),
  }
}

export function countPlanningBuckets<T>(classified: ClassifiedMission<T>[]) {
  const counts: Record<PlanningPoolBucket, number> = {
    SCHEDULED: 0,
    PLANNABLE: 0,
    BACKLOG: 0,
    UPCOMING: 0,
    TO_VERIFY: 0,
    ANOMALY: 0,
    HISTORY: 0,
  }

  classified.forEach((item) => {
    counts[item.bucket] += 1
  })

  return counts
}

/* ------------------------------------------------------------------ */
/* Présentation des buckets dans le bandeau                            */
/* ------------------------------------------------------------------ */

/** Ordre d'affichage : le travail restant d'abord, la consultation ensuite. */
export const planningBucketOrder: PlanningPoolBucket[] = [
  "PLANNABLE",
  "BACKLOG",
  "TO_VERIFY",
  "ANOMALY",
  "UPCOMING",
  "SCHEDULED",
  "HISTORY",
]

/** Buckets mis en avant dans le sélecteur principal. */
export const primaryPlanningBuckets: PlanningPoolBucket[] = [
  "PLANNABLE",
  "BACKLOG",
  "TO_VERIFY",
  "ANOMALY",
]

/** Buckets de consultation, relégués dans le menu secondaire. */
export const secondaryPlanningBuckets: PlanningPoolBucket[] = [
  "UPCOMING",
  "SCHEDULED",
  "HISTORY",
]

export const planningBucketLabels: Record<PlanningPoolBucket, string> = {
  PLANNABLE: "À planifier",
  BACKLOG: "En retard",
  TO_VERIFY: "À vérifier",
  ANOMALY: "Anomalies",
  UPCOMING: "À venir",
  SCHEDULED: "Affectées",
  HISTORY: "Historique",
}

/** Libellé court affiché sur la carte elle-même. */
export const planningBucketCardLabels: Record<PlanningPoolBucket, string> = {
  PLANNABLE: "À planifier",
  BACKLOG: "En retard",
  TO_VERIFY: "À vérifier",
  ANOMALY: "Anomalie",
  UPCOMING: "À venir",
  SCHEDULED: "Affectée",
  HISTORY: "Historique",
}

export const planningBucketEmptyLabels: Record<PlanningPoolBucket, string> = {
  PLANNABLE: "Aucune mission à planifier cette semaine.",
  BACKLOG: "Aucune mission en retard.",
  TO_VERIFY: "Aucune mission à vérifier.",
  ANOMALY: "Aucune anomalie détectée.",
  UPCOMING: "Aucune mission à venir.",
  SCHEDULED: "Aucune mission affectée.",
  HISTORY: "Aucune mission dans l’historique.",
}

/**
 * Le glisser-déposer n'est autorisé que lorsqu'il produit une planification
 * sensée. Il reste interdit là où il masquerait une donnée manquante ou une
 * incohérence de base.
 */
export function isDragAllowedForBucket(bucket: PlanningPoolBucket) {
  return bucket === "PLANNABLE" || bucket === "BACKLOG" || bucket === "UPCOMING"
}

const MS_PER_DAY = 86_400_000

/**
 * Retard exprimé en jours pleins par rapport au début de la semaine
 * consultée. Retourne `null` hors du bucket BACKLOG.
 */
export function getBacklogDelayDays(
  input: PlanningPoolInput,
  weekStart?: Date | string | null,
) {
  const reference = getTransportReferenceDate(input)
  const start = toDate(weekStart ?? input.weekStart)
  if (!reference || !start || reference >= start) return null
  return Math.max(1, Math.floor((start.getTime() - reference.getTime()) / MS_PER_DAY))
}

export type PlanningVerifyReason =
  | "missingTransportDate"
  | "preparationReview"
  | "unknown"

/** Raison réellement calculée pour laquelle une mission est à vérifier. */
export function getVerifyReason(input: PlanningPoolInput): PlanningVerifyReason {
  if (!getTransportReferenceDate(input)) return "missingTransportDate"
  if (needsPreparationReview(input.preparationStatus)) return "preparationReview"
  return "unknown"
}

export const planningVerifyReasonLabels: Record<PlanningVerifyReason, string> = {
  missingTransportDate: "Date de transport manquante",
  preparationReview: "Préparation à revoir",
  unknown: "Informations à compléter",
}

/** Note courte affichée sur la carte selon son bucket. */
export function getPlanningBucketNote(
  input: PlanningPoolInput,
  bucket: PlanningPoolBucket,
  weekStart?: Date | string | null,
): string | null {
  if (bucket === "BACKLOG") {
    const days = getBacklogDelayDays(input, weekStart)
    // Le badge porte déjà « En retard » : la note ne répète pas le libellé,
    // elle en donne uniquement l'ampleur.
    return days === null ? "Retard à confirmer" : `Retard de ${days} j`
  }
  if (bucket === "TO_VERIFY") {
    return planningVerifyReasonLabels[getVerifyReason(input)]
  }
  if (bucket === "ANOMALY") {
    return "Aucune affectation Planning"
  }
  return null
}

/** Regroupe une classification par bucket, sans recalculer la logique. */
export function groupPlanningBuckets<T>(classified: ClassifiedMission<T>[]) {
  const groups: Record<PlanningPoolBucket, T[]> = {
    PLANNABLE: [],
    BACKLOG: [],
    TO_VERIFY: [],
    UPCOMING: [],
    ANOMALY: [],
    SCHEDULED: [],
    HISTORY: [],
  }

  classified.forEach((item) => {
    groups[item.bucket].push(item.mission)
  })

  return groups
}
