"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

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
  /** Note courte contextuelle (« En retard de 3 j », raison de vérification). */
  note?: string | null;
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
  note = null,
}: MissionCardVisualProps) {
  const primaryReference = mission.clientReference || mission.reference;

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
          <p className="break-words text-[10px] font-bold uppercase leading-[1.15] tracking-[0.04em] text-[#20211d]">
            {primaryReference}
          </p>
          <p className="mt-[2px] break-words text-[10px] font-semibold leading-[1.15] text-[#11120f]">
            {mission.pickupCity} <span className="text-[#8d9386]">-&gt;</span>{" "}
            {mission.deliveryCity}
          </p>
          <div className="mt-[2px] flex flex-wrap items-center gap-x-1.5 gap-y-[1px] text-[9px] leading-[1.15] text-[#62665c]">
            <span className="break-words">{mission.clientName}</span>
            <span className="font-semibold text-[#1f211c]">
              {getDistanceLabel(mission)}
            </span>
            <span
              className={[
                "rounded-full border px-1 text-[8px] font-semibold leading-[1.3]",
                badgeStatusStyles[status],
              ].join(" ")}
            >
              {statusLabels[status]}
            </span>
          </div>
          {mission.trailerPlateNumber ? (
            <p className="mt-[2px] break-words text-[8px] font-semibold leading-[1.15] text-[#4f5549]">
              Remorque : {mission.trailerPlateNumber} ·{' '}
              {mission.trailerCustodyLabel ?? 'État à confirmer'}
              {mission.trailerRelayAvailable ? (
                <span className="ml-1 rounded-full bg-amber-100 px-1 text-amber-800">
                  Relais
                </span>
              ) : null}
            </p>
          ) : null}
          {mission.cmrNumber ? (
            <p className="mt-[2px] text-[8px] font-semibold leading-none text-[#62665c]">
              CMR {mission.cmrNumber}
            </p>
          ) : null}
          {mission.deliveryNoteNumber ? (
            <p className="mt-[2px] text-[8px] font-semibold leading-none text-[#62665c]">
              BL {mission.deliveryNoteNumber}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words text-[11px] font-bold uppercase leading-tight tracking-[0.08em] text-[#20211d]">
                {primaryReference}
              </p>
              {mission.clientReference ? (
                <p className="mt-0.5 break-words text-[9px] font-semibold leading-tight text-[#747a6f]">
                  Interne : {mission.reference}
                </p>
              ) : null}
              <p className="mt-1.5 text-sm font-semibold leading-snug text-[#11120f]">
                {mission.pickupCity} <span className="text-[#8d9386]">-&gt;</span>{" "}
                {mission.deliveryCity}
              </p>
            </div>
            {/*
              Un seul badge de statut par carte. Lorsque le bandeau fournit une
              catégorie (À planifier, En retard, À vérifier, Anomalie, À venir),
              elle occupe ce slot : c'est l'information la plus précise, et le
              badge de statut générique ferait doublon.
            */}
            <span
              className={[
                "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-tight",
                bucketBadge ? bucketBadge.className : badgeStatusStyles[status],
              ].join(" ")}
            >
              {bucketBadge ? bucketBadge.label : statusLabels[status]}
            </span>
          </div>

          {note ? (
            <p className="mt-1.5 break-words text-[10px] font-semibold leading-tight text-[#7a8074]">
              {note}
            </p>
          ) : null}

          <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-[10px] text-[#62665c]">
            <span className="min-w-0 break-words leading-tight">
              Client : {mission.clientName}
            </span>
            <span className="shrink-0 font-semibold text-[#1f211c]">
              {getDistanceLabel(mission)}
            </span>
          </div>
          {mission.trailerPlateNumber ? (
            <p className="mt-1.5 text-[10px] font-semibold text-[#4f5549]">
              Remorque : {mission.trailerPlateNumber} ·{' '}
              {mission.trailerCustodyLabel ?? 'État à confirmer'}
              {mission.trailerRelayAvailable ? (
                <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-800">
                  Relais possible
                </span>
              ) : null}
            </p>
          ) : null}
          {mission.cmrNumber ? (
            <p className="mt-1 text-[9px] font-semibold text-[#62665c]">
              CMR {mission.cmrNumber}
            </p>
          ) : null}
          {mission.deliveryNoteNumber ? (
            <p className="mt-1 text-[9px] font-semibold text-[#62665c]">
              BL {mission.deliveryNoteNumber}
            </p>
          ) : null}
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
  note = null,
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
        note={note}
      />
    </div>
  );
}
