"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import { useGerardApplication } from "@prolific/gerard-core/react";
import type { Mission, MissionStatus } from "../../lib/dispatch/mock-data";

const statusLabels: Record<MissionStatus, string> = {
  pending: "À planifier",
  assigned: "Assignée",
  in_progress: "En cours",
  done: "Terminée",
  issue: "Problème",
  cancelled: "Annulée",
};

const cardStatusStyles: Record<MissionStatus, string> = {
  pending: "border-black/10 bg-white text-[#171814]",
  assigned: "border-lime-300/75 bg-[#f7fbe9] text-[#18200c]",
  in_progress: "border-sky-200 bg-[#f3f9ff] text-[#0e1b24]",
  done: "border-emerald-200 bg-[#f1fbf6] text-[#102017]",
  issue: "border-red-200 bg-[#fff5f5] text-[#251112]",
  cancelled: "border-black/10 bg-[#eceee8] text-[#34372f]",
};

const badgeStatusStyles: Record<MissionStatus, string> = {
  pending: "border-black/10 bg-[#f4f5f1] text-[#56594f]",
  assigned: "border-lime-300 bg-lime-100 text-[#49630b]",
  in_progress: "border-sky-200 bg-sky-100 text-sky-800",
  done: "border-emerald-200 bg-emerald-100 text-emerald-800",
  issue: "border-red-200 bg-red-100 text-red-800",
  cancelled: "border-black/10 bg-[#e6e8e1] text-[#34372f]",
};

function getDistanceLabel(mission: Mission) {
  if (typeof mission.routeDistanceMeters === "number") {
    return `${Math.round(mission.routeDistanceMeters / 1000)} km calculés`;
  }

  if (typeof mission.estimatedKm === "number" && mission.estimatedKm > 0) {
    return `≈ ${mission.estimatedKm} km`;
  }

  return "Distance à calculer";
}

type MissionCardProps = {
  mission: Mission;
  status?: MissionStatus;
  dragDisabled?: boolean;
  compact?: boolean;
  className?: string;
  onClick?: (mission: Mission) => void;
  /**
   * Accent de catégorie du bandeau. Même carte, même taille : seul un petit
   * badge distingue le bucket, sans créer une seconde famille visuelle.
   */
  bucketBadge?: { label: string; className: string } | null;
};

type MissionCardVisualProps = Omit<MissionCardProps, "dragDisabled"> & {
  isDragging?: boolean;
  draggable?: boolean;
};

export function MissionCardVisual({
  mission,
  status = mission.status,
  compact = false,
  className = "",
  onClick,
  isDragging = false,
  draggable = false,
  bucketBadge = null,
}: MissionCardVisualProps) {
  const application = useGerardApplication();
  const references = application.policies.missionReference(mission);
  const primaryReference = references.primary;
  const secondaryReference = references.secondary;
  const ReferenceSlot = application.ui.components.MissionCardReference;
  const HeaderSlot = application.ui.components.MissionCardHeader;
  const FooterSlot = application.ui.components.MissionCardFooter;
  const slotProps = { mission, compact, primaryReference, secondaryReference };
  const visibleFields = new Set(application.ui.missionCard.visibleFields);
  const detailFields = {
    client: <span key="client" className="min-w-0 break-words leading-tight">{application.terminology.client} : {mission.clientName}</span>,
    distance: <span key="distance" className="shrink-0 font-semibold text-[#1f211c]">{getDistanceLabel(mission)}</span>,
  };

  return (
    <article
      // Ancre stable du locator de recherche : la carte reste identifiable
      // dans la grille comme dans le bandeau, sans modifier la donnée.
      data-mission-id={mission.id}
      onClick={() => onClick?.(mission)}
      className={[
        "touch-none rounded-lg border text-left shadow-[0_1px_8px_rgba(17,18,15,0.045)] transition",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300",
        cardStatusStyles[status],
        draggable ? "cursor-grab active:cursor-grabbing" : "",
        isDragging ? "opacity-35" : "opacity-100",
        compact ? "p-1.5" : "p-3",
        className,
      ].join(" ")}
    >
      {compact ? (
        // Rendu cellule de grille : le badge de statut rejoint la ligne de
        // méta pour laisser la référence et le trajet occuper toute la
        // largeur de la colonne, sans troncature ni scroll interne.
        <>
          {ReferenceSlot ? <ReferenceSlot {...slotProps} /> : (
            <p className="truncate text-[10px] font-bold uppercase leading-[1.15] tracking-[0.04em] text-[#20211d]">
              {primaryReference}
            </p>
          )}
          {visibleFields.has("route") ? <p className="mt-[2px] break-words text-[10px] font-semibold leading-[1.15] text-[#11120f]">
            {mission.pickupCity} <span className="text-[#8d9386]">-&gt;</span>{" "}
            {mission.deliveryCity}
          </p> : null}
          <div className="mt-[3px] flex min-w-0 items-center gap-1.5 text-[9px] leading-[1.15] text-[#62665c]">
            {visibleFields.has("client") ? <span className="min-w-0 flex-1 truncate">{mission.clientName}</span> : null}
            {visibleFields.has("distance") ? <span className="shrink-0 font-semibold text-[#1f211c]">
              {getDistanceLabel(mission)}
            </span> : null}
            {visibleFields.has("status") ? <span
              className={[
                "shrink-0 rounded-full border px-1 text-[8px] font-semibold leading-[1.3]",
                badgeStatusStyles[status],
              ].join(" ")}
            >
              {statusLabels[status]}
            </span> : null}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            {HeaderSlot ? <HeaderSlot {...slotProps} /> : (
              <div className="min-w-0">
                {ReferenceSlot ? <ReferenceSlot {...slotProps} /> : (
                  <>
                    <p className="break-words text-[11px] font-bold uppercase leading-tight tracking-[0.08em] text-[#20211d]">
                      {primaryReference}
                    </p>
                    {secondaryReference ? (
                      <p className="mt-0.5 break-words text-[9px] font-semibold leading-tight text-[#747a6f]">
                        {application.terminology.internalReference} : {secondaryReference}
                      </p>
                    ) : null}
                  </>
                )}
                {visibleFields.has("route") ? <p className="mt-1.5 text-sm font-semibold leading-snug text-[#11120f]">
                  {mission.pickupCity} <span className="text-[#8d9386]">-&gt;</span>{" "}
                  {mission.deliveryCity}
                </p> : null}
              </div>
            )}
            {/*
              Un seul badge de statut par carte. Lorsque le bandeau fournit une
              catégorie (À planifier, En retard, À vérifier, Anomalie, À venir),
              elle occupe ce slot : c'est l'information la plus précise, et le
              badge de statut générique ferait doublon.
            */}
            {visibleFields.has("status") ? <span
              className={[
                "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-tight",
                bucketBadge ? bucketBadge.className : badgeStatusStyles[status],
              ].join(" ")}
            >
              {bucketBadge ? bucketBadge.label : statusLabels[status]}
            </span> : null}
          </div>

          {FooterSlot ? <FooterSlot {...slotProps} /> : <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-[10px] text-[#62665c]">
            {application.ui.missionCard.detailFieldOrder.filter((field) => visibleFields.has(field)).map((field) => detailFields[field])}
          </div>}
        </>
      )}
    </article>
  );
}

export function MissionCard({
  mission,
  status = mission.status,
  dragDisabled = false,
  compact = false,
  className = "",
  onClick,
  bucketBadge = null,
}: MissionCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: mission.id,
      data: {
        type: "mission",
      },
      disabled: dragDisabled,
    });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...listeners}
      {...attributes}
      className={className.includes("h-full") ? "h-full" : undefined}
    >
      <MissionCardVisual
        mission={mission}
        status={status}
        compact={compact}
        className={className}
        onClick={onClick}
        isDragging={isDragging}
        draggable={!dragDisabled}
        bucketBadge={bucketBadge}
      />
    </div>
  );
}
