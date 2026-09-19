'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

import type {
  Trailer,
  TrailerStatus,
  TrailerType,
  Truck,
} from '../../lib/dispatch/mock-data'
import {
  getTrailerCargoLabel,
  getTrailerCargoStyle,
  getTrailerLoadLabel,
} from '../../lib/dispatch/trailer-display'
import {
  getDisplayCardVariantClass,
  getDisplayStatusBadgeClass,
  getMaintenanceSummaryClass,
  getVehicleDisplayStatus,
  maintenanceInterventionShortLabels,
} from '../../lib/dispatch/maintenance-display'
import {
  formatTechnicalInspectionDisplayDate,
  getTechnicalInspectionBadgeClass,
  getTechnicalInspectionState,
} from '../../lib/dispatch/technical-inspection'
import type { VehicleBaseStatusKind } from '../../lib/dispatch/maintenance-display'
import { normalizeSlExternalInvoiceReference } from '../../lib/dispatch/sl-invoice-reference'
import { StatusDot } from './StatusDot'
import { resourceCardShellClassName } from './ResourcePoolPrimitives'
import { useResourceCardActivation } from './useResourceCardActivation'

type TrailerCardProps = {
  trailer: Trailer
  truck?: Truck
  compact?: boolean
  /**
   * Rendu grille : uniquement plaque/référence + type, sur toute la largeur de
   * la colonne. Aucune troncature, aucune réserve de padding à droite.
   */
  dense?: boolean
  /** Laisse les lignes secondaires passer à la ligne au lieu d'être tronquées. */
  wrapContent?: boolean
  dragDisabled?: boolean
  className?: string
  onEdit?: (trailer: Trailer) => void
  showTruckAssignment?: boolean
  /**
   * Résumé dérivé : chargement · mission · localisation · attelage.
   * Remplace le seul statut, qui ne décrivait qu'une dimension.
   */
  situationSummary?: string | null
}

const trailerTypeLabels: Record<TrailerType, string> = {
  CURTAINSIDER: 'Bâchée',
  FLATBED: 'Plateau',
  REFRIGERATED: 'Frigorifique',
  CONTAINER: 'Container',
  BOX: 'Fourgon',
  OTHER: 'Autre',
}

const trailerStatusLabels: Record<TrailerStatus, string> = {
  AVAILABLE: 'Disponible',
  ASSIGNED: 'Assignée',
  AT_BASE: 'À la Base',
  IN_MAINTENANCE: 'Maintenance à la Base',
  MAINTENANCE_EXT: 'Maintenance extérieure',
  OUT_OF_SERVICE: 'Hors service',
}

const trailerBaseStatusKind: Record<TrailerStatus, VehicleBaseStatusKind> = {
  AVAILABLE: 'available',
  ASSIGNED: 'assigned',
  AT_BASE: 'available',
  IN_MAINTENANCE: 'maintenance',
  MAINTENANCE_EXT: 'maintenance',
  OUT_OF_SERVICE: 'outOfService',
}

export function TrailerCard({
  trailer,
  truck,
  compact = false,
  dense = false,
  wrapContent = false,
  dragDisabled = false,
  className = '',
  onEdit,
  showTruckAssignment = false,
  situationSummary = null,
}: TrailerCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: trailer.id,
      data: {
        type: 'trailer',
      },
      disabled: dragDisabled,
    })

  const style = {
    transform: CSS.Translate.toString(transform),
  }
  const cargoStyle = getTrailerCargoStyle(trailer)
  const cargoLabel = getTrailerCargoLabel(trailer)
  const loadLabel = getTrailerLoadLabel(trailer)
  const maintenance = trailer.activeMaintenance
  const maintenanceFees =
    maintenance?.quoteAmount ?? maintenance?.invoiceAmount ?? null
  const maintenancePdfUrl =
    maintenance?.quotePdfUrl ?? maintenance?.invoicePdfUrl ?? null
  const maintenancePdfReference = maintenancePdfUrl
    ? normalizeSlExternalInvoiceReference(
        maintenance?.slInvoiceReference,
        maintenance?.providerRequestId ?? maintenance?.id
      )
    : null
  const displayStatus = getVehicleDisplayStatus({
    baseStatusLabel: trailerStatusLabels[trailer.status],
    baseStatusKind: trailerBaseStatusKind[trailer.status],
    activeMaintenance: maintenance,
  })
  const showMaintenanceSummary =
    Boolean(maintenance) && displayStatus.shouldShowMaintenanceSummary
  const technicalInspection = getTechnicalInspectionState(trailer)
  const technicalInspectionExpiryLabel =
    formatTechnicalInspectionDisplayDate(technicalInspection.expiresAt)
  const activation = useResourceCardActivation(trailer, isDragging, onEdit)
  const custodyLabel =
    trailer.custodyState === 'RELAY_AVAILABLE'
      ? 'Chargée · à la base · relais possible'
      : trailer.custodyState === 'IN_MISSION'
        ? 'Chargée · en mission'
        : trailer.custodyState === 'IMMOBILIZED'
          ? 'Indisponible'
          : trailer.loadStatus === 'LOADED'
            ? 'Chargée'
            : 'Vide · disponible'
  const custodyClass =
    trailer.custodyState === 'RELAY_AVAILABLE'
      ? 'bg-amber-100 text-amber-800'
      : trailer.custodyState === 'IN_MISSION'
        ? 'bg-sky-100 text-sky-800'
        : trailer.custodyState === 'IMMOBILIZED'
          ? 'bg-red-100 text-red-800'
          : 'bg-emerald-100 text-emerald-800'

  return (
    <article
      data-trailer-id={trailer.id}
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      {...activation}
      role={onEdit ? 'button' : undefined}
      tabIndex={onEdit ? 0 : undefined}
      aria-label={
        onEdit ? `Ouvrir la fiche de ${trailer.plateNumber}` : undefined
      }
      className={[
        resourceCardShellClassName,
        cargoStyle.card,
        getDisplayCardVariantClass(displayStatus.cardVariant),
        onEdit
          ? 'cursor-pointer hover:ring-1 hover:ring-black/10'
          : dragDisabled
            ? ''
            : 'cursor-grab active:cursor-grabbing',
        isDragging ? 'opacity-35' : 'opacity-100',
        dense ? 'p-0.5' : compact ? 'p-2' : 'p-3',
        className,
      ].join(' ')}
    >
      <div className={dense ? 'min-w-0' : 'min-w-0 pr-9'}>
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 break-all text-[12px] font-black uppercase leading-tight tracking-[0.08em] text-[#171814]">
            {trailer.plateNumber}
          </p>
          {!dense ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                className={[
                  'rounded-full border px-2 py-0.5 text-[9px] font-bold leading-none',
                  getDisplayStatusBadgeClass(displayStatus.tone),
                ].join(' ')}
              >
                {displayStatus.label}
              </span>
              <StatusDot
                color={displayStatus.pulseColor}
                pulsing={displayStatus.isPulsing}
              />
            </div>
          ) : (
            <StatusDot
              color={displayStatus.pulseColor}
              pulsing={displayStatus.isPulsing}
            />
          )}
        </div>
        <p className="mt-0.5 break-words text-[10px] font-semibold leading-tight text-[#6b7065]">
          {trailerTypeLabels[trailer.type]}
        </p>
        {!dense ? (
          <span
            className={[
              'mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold',
              custodyClass,
            ].join(' ')}
          >
            {custodyLabel}
          </span>
        ) : null}

        {!dense && situationSummary ? (
          <p className="mt-2 break-words text-[10px] font-semibold leading-tight text-[#4e554b]">
            {situationSummary}
          </p>
        ) : !dense && showTruckAssignment ? (
          <p
            className={[
              'mt-2 text-[10px] font-semibold leading-tight text-[#73796d]',
              wrapContent ? 'break-words' : 'truncate',
            ].join(' ')}
          >
            {truck ? `Camion ${truck.plateNumber}` : 'Non assignée'}
          </p>
        ) : null}
        {!dense && trailer.notes ? (
          <p
            className={[
              'mt-1 text-[10px] font-medium leading-snug text-[#8a9085]',
              wrapContent ? 'break-words' : 'truncate',
            ].join(' ')}
          >
            {trailer.notes}
          </p>
        ) : null}

        <div
          className={[
            'mt-2 flex flex-wrap items-center gap-1.5',
            dense ? 'hidden' : '',
          ].join(' ')}
        >
          <span
            className={[
              'rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em]',
              cargoStyle.badge,
            ].join(' ')}
          >
            {loadLabel}
          </span>
          {cargoLabel ? (
            <span
              className={[
                'rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em]',
                cargoStyle.badge,
              ].join(' ')}
            >
              {cargoLabel}
            </span>
          ) : null}
          <span
            className={[
              'rounded-full border px-2 py-0.5 text-[9px] font-bold leading-none',
              getTechnicalInspectionBadgeClass(technicalInspection),
            ].join(' ')}
            title={
              technicalInspectionExpiryLabel
                ? `Contrôle technique valable jusqu'au ${technicalInspectionExpiryLabel}`
                : 'Aucune date de contrôle technique renseignée'
            }
          >
            {technicalInspection.label}
          </span>
        </div>
        {!dense && trailer.cargoDescription ? (
          <p
            className={[
              'mt-1 text-[10px] font-semibold leading-snug',
              wrapContent ? 'break-words' : 'truncate',
              cargoStyle.text,
            ].join(' ')}
          >
            {trailer.cargoDescription}
          </p>
        ) : null}

        {!dense && showMaintenanceSummary && maintenance ? (
          <div
            className={[
              'mt-2 flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold leading-tight',
              getMaintenanceSummaryClass(
                maintenance.status,
                maintenance.immobilizationRequired
              ),
            ].join(' ')}
          >
            <span className={wrapContent ? 'min-w-0 break-words' : 'min-w-0 truncate'}>
              {maintenanceInterventionShortLabels[maintenance.interventionType]}
              {maintenanceFees !== null
                ? ` · ${formatMoney(maintenanceFees)}`
                : ''}
            </span>
            {maintenancePdfUrl ? (
              <span className="ml-auto max-w-[92px] shrink-0 truncate rounded-full border border-black/10 bg-white px-1.5 py-0.5 text-[9px] font-bold text-[#5f6558]">
                PDF{maintenancePdfReference ? ` · ${maintenancePdfReference}` : ''}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

    </article>
  )
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('fr-LU', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)
}
