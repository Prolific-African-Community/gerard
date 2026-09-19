"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import type { Driver, Trailer, Truck, TruckStatus } from "../../lib/dispatch/mock-data";
import { getTrailerCargoStyle } from "../../lib/dispatch/trailer-display";
import {
  getDisplayCardVariantClass,
  getDisplayStatusBadgeClass,
  getMaintenanceSummaryClass,
  getVehicleDisplayStatus,
  maintenanceInterventionShortLabels,
} from "../../lib/dispatch/maintenance-display";
import {
  formatTechnicalInspectionDisplayDate,
  getTechnicalInspectionBadgeClass,
  getTechnicalInspectionState,
} from "../../lib/dispatch/technical-inspection";
import type { VehicleBaseStatusKind } from "../../lib/dispatch/maintenance-display";
import { normalizeSlExternalInvoiceReference } from "../../lib/dispatch/sl-invoice-reference";
import { StatusDot } from "./StatusDot";
import {
  defaultResourceCardAppearanceClassName,
  resourceCardShellClassName,
} from "./ResourcePoolPrimitives";
import { useResourceCardActivation } from "./useResourceCardActivation";

type TruckCardProps = {
  truck: Truck;
  statusLabel?: string;
  compact?: boolean;
  /**
   * Rendu grille : uniquement plaque + marque/modèle, sur toute la largeur de
   * la colonne. Aucune troncature, aucune réserve de padding à droite.
   */
  dense?: boolean;
  /** Laisse les lignes secondaires passer à la ligne au lieu d'être tronquées. */
  wrapContent?: boolean;
  dragDisabled?: boolean;
  className?: string;
  driver?: Driver;
  onEdit?: (truck: Truck) => void;
  showAssignmentDetails?: boolean;
  showTrailerDetails?: boolean;
  trailer?: Trailer;
  trailerFallbackLabel?: string;
  trailerLabel?: string;
};

const truckStatusLabels: Record<TruckStatus, string> = {
  AVAILABLE: "Disponible",
  ASSIGNED: "Assigné",
  EN_ROUTE_TO_PICKUP: "Vers chargement",
  AT_PICKUP: "Au chargement",
  ON_MISSION: "En mission",
  RETURNING_TO_BASE: "Retour base",
  AT_BASE: "À la base",
  IN_MAINTENANCE: "Maintenance à la base",
  MAINTENANCE_EXT: "Maintenance extérieure",
  OUT_OF_SERVICE: "Hors service",
};

const truckBaseStatusKind: Record<TruckStatus, VehicleBaseStatusKind> = {
  AVAILABLE: "available",
  ASSIGNED: "assigned",
  EN_ROUTE_TO_PICKUP: "assigned",
  AT_PICKUP: "assigned",
  ON_MISSION: "assigned",
  RETURNING_TO_BASE: "assigned",
  AT_BASE: "assigned",
  IN_MAINTENANCE: "maintenance",
  MAINTENANCE_EXT: "maintenance",
  OUT_OF_SERVICE: "outOfService",
};

export function TruckCard({
  truck,
  statusLabel,
  compact = false,
  dense = false,
  wrapContent = false,
  dragDisabled = false,
  className = "",
  driver,
  onEdit,
  showAssignmentDetails = false,
  showTrailerDetails = true,
  trailer,
  trailerFallbackLabel,
  trailerLabel,
}: TruckCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: truck.id,
      data: {
        type: "truck",
      },
      disabled: dragDisabled,
    });

  const style = {
    transform: CSS.Translate.toString(transform),
  };
  const maintenance = truck.activeMaintenance;
  const maintenanceFees =
    maintenance?.quoteAmount ?? maintenance?.invoiceAmount ?? null;
  const maintenancePdfUrl =
    maintenance?.quotePdfUrl ?? maintenance?.invoicePdfUrl ?? null;
  const maintenancePdfReference = maintenancePdfUrl
    ? normalizeSlExternalInvoiceReference(
        maintenance?.slInvoiceReference,
        maintenance?.providerRequestId ?? maintenance?.id
      )
    : null;
  const truckStatus = truck.status ?? "AVAILABLE";
  const displayStatus = getVehicleDisplayStatus({
    baseStatusLabel: statusLabel ?? truckStatusLabels[truckStatus],
    baseStatusKind: truckBaseStatusKind[truckStatus],
    activeMaintenance: maintenance,
  });
  const showMaintenanceSummary =
    Boolean(maintenance) && displayStatus.shouldShowMaintenanceSummary;
  const technicalInspection = getTechnicalInspectionState(truck);
  const technicalInspectionExpiryLabel =
    formatTechnicalInspectionDisplayDate(technicalInspection.expiresAt);
  const cargoAppearance = trailer
    ? getTrailerCargoStyle(trailer).card
    : defaultResourceCardAppearanceClassName;
  const activation = useResourceCardActivation(truck, isDragging, onEdit);

  return (
    <article
      data-truck-id={truck.id}
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      {...activation}
      role={onEdit ? "button" : undefined}
      tabIndex={onEdit ? 0 : undefined}
      aria-label={onEdit ? `Ouvrir la fiche de ${truck.plateNumber}` : undefined}
      className={[
        resourceCardShellClassName,
        cargoAppearance,
        getDisplayCardVariantClass(displayStatus.cardVariant),
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300",
        onEdit
          ? "cursor-pointer hover:ring-1 hover:ring-black/10"
          : dragDisabled
            ? ""
            : "cursor-grab active:cursor-grabbing",
        isDragging ? "opacity-35" : "opacity-100",
        dense ? "p-0.5" : compact ? "p-2" : "p-3",
        className,
      ].join(" ")}
    >
      <div className={dense ? "min-w-0" : "min-w-0 pr-9"}>
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 break-all text-[12px] font-black uppercase leading-tight tracking-[0.08em] text-[#171814]">
            {truck.plateNumber}
          </p>
          {!dense ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                className={[
                  "rounded-full border px-2 py-0.5 text-[9px] font-bold leading-none",
                  getDisplayStatusBadgeClass(displayStatus.tone),
                ].join(" ")}
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
          {[truck.brand, truck.model].filter(Boolean).join(" · ") || "Camion"}
        </p>

        {dense ? null : showAssignmentDetails ? (
          <div className="mt-2 space-y-1">
            <TruckMetaLine type="driver" wrap={wrapContent}>
              {driver?.name ?? "Non assigné"}
            </TruckMetaLine>
            {showTrailerDetails ? (
              <TruckMetaLine type="trailer" wrap={wrapContent}>
                {trailer
                  ? `${trailer.plateNumber}${trailerLabel ? ` · ${trailerLabel}` : ""}`
                  : "Non assignée"}
              </TruckMetaLine>
            ) : null}
          </div>
        ) : showTrailerDetails && (trailer || trailerFallbackLabel) ? (
          <TruckMetaLine type="trailer" wrap={wrapContent}>
            {trailer
              ? `${trailer.plateNumber}${trailerLabel ? ` · ${trailerLabel}` : ""}`
              : trailerFallbackLabel ?? ""}
          </TruckMetaLine>
        ) : null}

        {dense ? null : (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              className={[
                "rounded-full border px-2 py-0.5 text-[9px] font-bold leading-none",
                getTechnicalInspectionBadgeClass(technicalInspection),
              ].join(" ")}
              title={
                technicalInspectionExpiryLabel
                  ? `Contrôle technique valable jusqu'au ${technicalInspectionExpiryLabel}`
                  : "Aucune date de contrôle technique renseignée"
              }
            >
              {technicalInspection.label}
            </span>
          </div>
        )}

        {!dense && showMaintenanceSummary && maintenance ? (
          <div
            className={[
              "mt-2 flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold leading-tight",
              getMaintenanceSummaryClass(
                maintenance.status,
                maintenance.immobilizationRequired
              ),
            ].join(" ")}
          >
            <span className={wrapContent ? "min-w-0 break-words" : "min-w-0 truncate"}>
              {maintenanceInterventionShortLabels[maintenance.interventionType]}
              {maintenanceFees !== null
                ? ` · ${formatMoney(maintenanceFees)}`
                : ""}
            </span>
            {maintenancePdfUrl ? (
              <span className="ml-auto max-w-[92px] shrink-0 truncate rounded-full border border-black/10 bg-white px-1.5 py-0.5 text-[9px] font-bold text-[#5f6558]">
                PDF{maintenancePdfReference ? ` · ${maintenancePdfReference}` : ""}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("fr-LU", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function TruckMetaLine({
  children,
  type,
  wrap = false,
}: {
  children: string;
  type: "driver" | "trailer";
  wrap?: boolean;
}) {
  return (
    <p
      className={[
        "flex min-w-0 gap-1.5 text-[10px] font-semibold leading-tight text-[#73796d]",
        wrap ? "items-start" : "items-center truncate",
      ].join(" ")}
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[#8b9186]">
        {type === "driver" ? <DriverIcon /> : <TrailerIcon />}
      </span>
      <span className={wrap ? "min-w-0 break-words" : "truncate"}>{children}</span>
    </p>
  );
}

function DriverIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 11.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5z" />
      <path d="M5.25 19.25c.8-3.1 3.05-4.8 6.75-4.8s5.95 1.7 6.75 4.8" />
    </svg>
  );
}

function TrailerIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8.5h12.5v6H4z" />
      <path d="M16.5 11.5H20" />
      <path d="M7 17.25a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z" />
      <path d="M15 17.25a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z" />
    </svg>
  );
}
