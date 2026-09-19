export type MaintenanceVehicleType = 'TRUCK' | 'TRAILER'

export type MaintenanceInterventionType =
  | 'DIAGNOSTIC'
  | 'TIRES'
  | 'BRAKES'
  | 'OIL_SERVICE'
  | 'ELECTRICAL'
  | 'BODYWORK'
  | 'TRAILER_REPAIR'
  | 'SAFETY_CHECK'
  | 'OTHER'

export type MaintenanceUrgency = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'

export type MaintenanceRequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'RECEIVED'
  | 'UNDER_REVIEW'
  | 'QUOTE_RECEIVED'
  | 'QUOTE_APPROVED'
  | 'QUOTE_REJECTED'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'INVOICED'
  | 'PAID'
  | 'CLOSED'
  | 'CANCELLED'

export const maintenanceStatusLabels: Record<MaintenanceRequestStatus, string> =
  {
    DRAFT: 'Brouillon',
    SUBMITTED: 'Envoyée',
    RECEIVED: 'Reçue',
    UNDER_REVIEW: 'En analyse',
    QUOTE_RECEIVED: 'Frais reçus',
    QUOTE_APPROVED: 'Frais acceptés',
    QUOTE_REJECTED: 'Frais refusés',
    SCHEDULED: 'Planifiée',
    IN_PROGRESS: 'En intervention',
    COMPLETED: 'Terminée',
    INVOICED: 'Payée',
    PAID: 'Payée',
    CLOSED: 'Clôturée',
    CANCELLED: 'Annulée',
  }

export const maintenanceInterventionLabels: Record<
  MaintenanceInterventionType,
  string
> = {
  DIAGNOSTIC: 'Diagnostic mécanique',
  TIRES: 'Pneus',
  BRAKES: 'Freins',
  OIL_SERVICE: 'Vidange / entretien',
  ELECTRICAL: 'Électricité',
  BODYWORK: 'Carrosserie',
  TRAILER_REPAIR: 'Réparation remorque',
  SAFETY_CHECK: 'Contrôle sécurité',
  OTHER: 'Autre',
}

export const maintenanceInterventionShortLabels: Record<
  MaintenanceInterventionType,
  string
> = {
  DIAGNOSTIC: 'Diagnostic',
  TIRES: 'Pneus',
  BRAKES: 'Freins',
  OIL_SERVICE: 'Vidange',
  ELECTRICAL: 'Électricité',
  BODYWORK: 'Carrosserie',
  TRAILER_REPAIR: 'Réparation',
  SAFETY_CHECK: 'Sécurité',
  OTHER: 'Maintenance',
}

export const maintenanceUrgencyLabels: Record<MaintenanceUrgency, string> = {
  LOW: 'Faible',
  NORMAL: 'Normale',
  HIGH: 'Haute',
  CRITICAL: 'Critique',
}

const activeMaintenanceStatuses = new Set<MaintenanceRequestStatus>([
  'DRAFT',
  'SUBMITTED',
  'RECEIVED',
  'UNDER_REVIEW',
  'QUOTE_RECEIVED',
  'QUOTE_APPROVED',
  'SCHEDULED',
  'IN_PROGRESS',
])

export function isActiveMaintenanceStatus(status: MaintenanceRequestStatus) {
  return activeMaintenanceStatuses.has(status)
}

const terminalMaintenanceStatuses = new Set<MaintenanceRequestStatus>([
  'COMPLETED',
  'INVOICED',
  'PAID',
  'CLOSED',
  'CANCELLED',
  'QUOTE_REJECTED',
])

export function isTerminalMaintenanceStatus(status: MaintenanceRequestStatus) {
  return terminalMaintenanceStatuses.has(status)
}

const interventionMaintenanceStatuses = new Set<MaintenanceRequestStatus>([
  'RECEIVED',
  'UNDER_REVIEW',
  'QUOTE_RECEIVED',
  'QUOTE_APPROVED',
  'SCHEDULED',
  'IN_PROGRESS',
])

const warningMaintenanceStatuses = new Set<MaintenanceRequestStatus>([
  'DRAFT',
  'SUBMITTED',
  'RECEIVED',
  'QUOTE_RECEIVED',
])

export function shouldVehicleBeInMaintenance(status: MaintenanceRequestStatus) {
  return interventionMaintenanceStatuses.has(status)
}

export function deriveVehicleOperationalStatusFromMaintenance<
  VehicleStatus extends string,
>(input: {
  currentStatus: VehicleStatus
  maintenanceStatus: MaintenanceRequestStatus
  immobilizationRequired?: boolean
  inMaintenanceStatus: VehicleStatus
  outOfServiceStatus: VehicleStatus
}) {
  if (!isActiveMaintenanceStatus(input.maintenanceStatus)) {
    return null
  }

  if (input.immobilizationRequired) {
    return input.currentStatus === input.outOfServiceStatus
      ? null
      : input.outOfServiceStatus
  }

  if (!shouldVehicleBeInMaintenance(input.maintenanceStatus)) {
    return null
  }

  if (
    input.currentStatus === input.outOfServiceStatus ||
    input.currentStatus === input.inMaintenanceStatus
  ) {
    return null
  }

  return input.inMaintenanceStatus
}

export function getMaintenanceIndicatorTone(
  status: MaintenanceRequestStatus | null | undefined,
  immobilizationRequired?: boolean
) {
  if (!status) {
    return 'neutral'
  }

  if (!isActiveMaintenanceStatus(status)) {
    return 'closed'
  }

  if (
    immobilizationRequired ||
    status === 'UNDER_REVIEW' ||
    status === 'QUOTE_APPROVED' ||
    status === 'SCHEDULED' ||
    status === 'IN_PROGRESS'
  ) {
    return 'critical'
  }

  if (warningMaintenanceStatuses.has(status)) {
    return 'warning'
  }

  return 'neutral'
}

export function getMaintenanceIndicatorClass(
  status: MaintenanceRequestStatus | null | undefined,
  immobilizationRequired?: boolean
) {
  const tone = getMaintenanceIndicatorTone(status, immobilizationRequired)

  if (tone === 'critical') {
    return 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.16)] animate-pulse'
  }

  if (tone === 'warning') {
    return 'bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.18)] animate-pulse'
  }

  if (tone === 'closed') {
    return 'bg-zinc-300'
  }

  return 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]'
}

export function getMaintenanceSummaryClass(
  status: MaintenanceRequestStatus | null | undefined,
  immobilizationRequired?: boolean
) {
  const tone = getMaintenanceIndicatorTone(status, immobilizationRequired)

  if (immobilizationRequired) {
    return 'border-red-200 bg-red-100/80 text-red-800'
  }

  if (tone === 'critical') {
    return 'border-red-200 bg-red-50/80 text-red-800'
  }

  if (tone === 'warning') {
    return 'border-amber-200 bg-amber-50/90 text-amber-900'
  }

  if (tone === 'closed') {
    return 'border-zinc-200 bg-zinc-50/80 text-zinc-600'
  }

  return 'border-black/10 bg-white/75 text-[#5f6558]'
}

export function getMaintenanceStatusBadgeClass(
  status: MaintenanceRequestStatus
) {
  if (
    status === 'COMPLETED' ||
    status === 'INVOICED' ||
    status === 'PAID' ||
    status === 'CLOSED'
  ) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (status === 'CANCELLED' || status === 'QUOTE_REJECTED') {
    return 'border-red-200 bg-red-50 text-red-700'
  }

  if (status === 'IN_PROGRESS') {
    return 'border-amber-200 bg-amber-50 text-amber-800'
  }

  return 'border-black/10 bg-white text-[#4f5549]'
}

export function getMaintenanceUrgencyBadgeClass(urgency: MaintenanceUrgency) {
  if (urgency === 'CRITICAL') {
    return 'border-red-200 bg-red-50 text-red-700'
  }

  if (urgency === 'HIGH') {
    return 'border-amber-200 bg-amber-50 text-amber-800'
  }

  if (urgency === 'LOW') {
    return 'border-black/10 bg-[#F4F5F1] text-[#6f756a]'
  }

  return 'border-lime-300 bg-lime-100 text-[#49630b]'
}

export function getMaintenanceSignalLabel(urgency: MaintenanceUrgency) {
  if (urgency === 'CRITICAL') {
    return 'Critique'
  }

  if (urgency === 'HIGH') {
    return 'Urgent'
  }

  return null
}

// ---------------------------------------------------------------------------
// Canonical card display status
//
// A truck/trailer card must show exactly ONE operational status. That status is
// derived here from the NovoTralux vehicle status combined with the active SL
// Automotive maintenance state, following a strict priority order so the user
// never has to reconcile two systems at once.
// ---------------------------------------------------------------------------

export type VehicleDisplayTone = 'red' | 'orange' | 'green' | 'neutral'

export type VehicleDisplayPulseColor = 'red' | 'orange' | 'green' | 'gray'

export type VehicleDisplayCardVariant =
  | 'available'
  | 'pending'
  | 'active'
  | 'immobilized'
  | 'terminal'
  | 'neutral'

// How a raw NovoTralux vehicle status should read when no active maintenance
// overrides it. Each card maps its own status enum to one of these kinds.
export type VehicleBaseStatusKind =
  | 'available'
  | 'assigned'
  | 'maintenance'
  | 'outOfService'
  | 'neutral'

export type VehicleDisplayStatus = {
  label: string
  tone: VehicleDisplayTone
  pulseColor: VehicleDisplayPulseColor
  isPulsing: boolean
  cardVariant: VehicleDisplayCardVariant
  shouldShowMaintenanceSummary: boolean
}

// Active SL intervention — work is committed/under way.
const interventionDisplayStatuses = new Set<MaintenanceRequestStatus>([
  'UNDER_REVIEW',
  'QUOTE_APPROVED',
  'SCHEDULED',
  'IN_PROGRESS',
])

// Pending SL request — submitted/awaiting analysis or a quote decision.
const pendingDisplayStatuses = new Set<MaintenanceRequestStatus>([
  'DRAFT',
  'SUBMITTED',
  'RECEIVED',
  'QUOTE_RECEIVED',
])

function getBaseDisplayStatus(
  label: string,
  kind: VehicleBaseStatusKind
): VehicleDisplayStatus {
  switch (kind) {
    case 'available':
      return {
        label,
        tone: 'green',
        pulseColor: 'green',
        isPulsing: false,
        cardVariant: 'available',
        shouldShowMaintenanceSummary: false,
      }
    case 'outOfService':
      return {
        label,
        tone: 'red',
        pulseColor: 'red',
        isPulsing: false,
        cardVariant: 'neutral',
        shouldShowMaintenanceSummary: false,
      }
    case 'maintenance':
      return {
        label,
        tone: 'orange',
        pulseColor: 'orange',
        isPulsing: false,
        cardVariant: 'neutral',
        shouldShowMaintenanceSummary: false,
      }
    case 'assigned':
    case 'neutral':
    default:
      return {
        label,
        tone: 'neutral',
        pulseColor: 'gray',
        isPulsing: false,
        cardVariant: 'neutral',
        shouldShowMaintenanceSummary: false,
      }
  }
}

export function getVehicleDisplayStatus(input: {
  baseStatusLabel: string
  baseStatusKind: VehicleBaseStatusKind
  activeMaintenance?: {
    status: MaintenanceRequestStatus
    immobilizationRequired?: boolean | null
  } | null
}): VehicleDisplayStatus {
  const maintenance = input.activeMaintenance

  if (maintenance && isActiveMaintenanceStatus(maintenance.status)) {
    // 1. Immobilization has the highest priority. The vehicle cannot roll, so
    //    the card never shows "Disponible" no matter what the raw DB status is.
    if (maintenance.immobilizationRequired) {
      return {
        label: 'Immobilisé',
        tone: 'red',
        pulseColor: 'red',
        isPulsing: true,
        cardVariant: 'immobilized',
        shouldShowMaintenanceSummary: true,
      }
    }

    // 2. Active SL intervention (committed / under way).
    if (interventionDisplayStatuses.has(maintenance.status)) {
      return {
        label: 'En intervention',
        tone: 'red',
        pulseColor: 'red',
        isPulsing: true,
        cardVariant: 'active',
        shouldShowMaintenanceSummary: true,
      }
    }

    // 3. Pending SL request (submitted / awaiting analysis or quote).
    if (pendingDisplayStatuses.has(maintenance.status)) {
      return {
        label: 'Demande SL',
        tone: 'orange',
        pulseColor: 'orange',
        isPulsing: true,
        cardVariant: 'pending',
        shouldShowMaintenanceSummary: true,
      }
    }
  }

  // 4 & 5. Terminal maintenance or no active maintenance: fall back to the raw
  // NovoTralux vehicle status. The card must not look active or alarming.
  return getBaseDisplayStatus(input.baseStatusLabel, input.baseStatusKind)
}

export function getDisplayStatusBadgeClass(tone: VehicleDisplayTone) {
  switch (tone) {
    case 'red':
      return 'border-red-200 bg-red-50 text-red-700'
    case 'orange':
      return 'border-amber-200 bg-amber-50 text-amber-800'
    case 'green':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    default:
      return 'border-black/10 bg-[#F4F5F1] text-[#4f5549]'
  }
}

// Subtle card framing per variant. Returns '' for non-maintenance states so the
// card keeps its native styling (e.g. trailer cargo colours).
export function getDisplayCardVariantClass(
  cardVariant: VehicleDisplayCardVariant
) {
  switch (cardVariant) {
    case 'immobilized':
      return 'border-red-300 border-l-4 border-l-red-500 bg-red-50/50'
    case 'active':
      return 'border-red-200 border-l-4 border-l-red-400 bg-red-50/25'
    case 'pending':
      return 'border-amber-200 border-l-4 border-l-amber-400 bg-amber-50/30'
    case 'terminal':
      return 'border-l-4 border-l-zinc-300'
    case 'available':
    case 'neutral':
    default:
      return ''
  }
}
