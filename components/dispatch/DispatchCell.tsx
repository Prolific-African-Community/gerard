"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState } from "react";

import type {
  DispatchDay,
  Mission,
  MissionStatus,
} from "../../lib/dispatch/mock-data";
import { MissionCard } from "./MissionCard";

const visibleMissionCount = 2;

const statusLabels: Record<MissionStatus, string> = {
  pending: "À planifier",
  assigned: "Assignée",
  in_progress: "En cours",
  done: "Terminée",
  issue: "Problème",
  cancelled: "Annulée",
};

const rowStatusStyles: Record<MissionStatus, string> = {
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

export function buildDispatchCellId(driverId: string, day: DispatchDay) {
  return `cell:${driverId}:${day}`;
}

type DispatchCellProps = {
  driverId: string;
  day: DispatchDay;
  missions: Mission[];
  onMissionClick: (mission: Mission) => void;
  dragDisabled?: boolean;
  previewMissions?: Array<{
    id: string;
    reference: string;
    conditional: boolean;
    timeLabel: string;
  }>;
};

type CellMissionRowProps = {
  mission: Mission;
  onMissionClick: (mission: Mission) => void;
  dragDisabled?: boolean;
};

function getVisibleStatus(mission: Mission): MissionStatus {
  return mission.status === "pending" ? "assigned" : mission.status;
}

function CellMissionRow({ mission, onMissionClick, dragDisabled = false }: CellMissionRowProps) {
  const status = getVisibleStatus(mission);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: mission.id,
      data: {
        type: "mission",
      },
      disabled: dragDisabled,
    });
  const style = {
    transform: CSS.Translate.toString(transform),
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onMissionClick(mission)}
      className={[
        "flex min-h-[23px] items-center justify-between gap-1 rounded-md border px-1.5 py-0.5 text-left shadow-[0_1px_5px_rgba(17,18,15,0.035)] transition",
        dragDisabled ? "cursor-pointer" : "touch-none cursor-grab active:cursor-grabbing",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300",
        rowStatusStyles[status],
        isDragging ? "opacity-35" : "opacity-100",
      ].join(" ")}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="break-words text-[9px] font-semibold uppercase tracking-[0.06em] text-[#191a16]">
          {mission.reference}
        </span>
        <span className="shrink-0 text-[10px] text-[#9aa090]">·</span>
        <span className="min-w-0 break-words text-[9px] font-semibold leading-tight text-[#24261f]">
          {mission.pickupCity} -&gt; {mission.deliveryCity}
        </span>
      </div>
      <span
        className={[
          "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none",
          badgeStatusStyles[status],
        ].join(" ")}
      >
        {statusLabels[status]}
      </span>
    </article>
  );
}

export function DispatchCell({
  driverId,
  day,
  missions,
  onMissionClick,
  dragDisabled = false,
  previewMissions = [],
}: DispatchCellProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const { isOver, setNodeRef } = useDroppable({
    id: buildDispatchCellId(driverId, day),
    data: {
      driverId,
      day,
    },
    disabled: dragDisabled,
  });

  const maxPageIndex = Math.max(
    0,
    Math.ceil(missions.length / visibleMissionCount) - 1,
  );

  useEffect(() => {
    setPageIndex((currentPageIndex) =>
      Math.min(currentPageIndex, maxPageIndex),
    );
  }, [maxPageIndex]);

  const visibleMissions = useMemo(() => {
    const startIndex = pageIndex * visibleMissionCount;
    return missions.slice(startIndex, startIndex + visibleMissionCount);
  }, [missions, pageIndex]);

  const remainingMissions =
    missions.length - (pageIndex + 1) * visibleMissionCount;
  const hasPagination = missions.length > visibleMissionCount;
  const isLastPage = pageIndex >= maxPageIndex;

  function handlePaginationClick() {
    setPageIndex((currentPageIndex) =>
      currentPageIndex >= maxPageIndex ? 0 : currentPageIndex + 1,
    );
  }

  return (
    <td className="h-[104px] border-l border-black/10 p-1 align-top">
      <div
        ref={setNodeRef}
        className={[
          "relative h-[96px] rounded-lg border border-dashed p-1 transition",
          isOver && !dragDisabled
            ? "border-lime-300 bg-lime-50/70 ring-4 ring-lime-200/40"
            : "border-black/10 bg-[#fbfcf8]",
        ].join(" ")}
      >
        {previewMissions.length > 0 ? (
          <div className="pointer-events-none absolute inset-1 z-20 flex flex-col gap-1 rounded-md bg-[#efffd6]/95 p-1.5 shadow-[0_8px_24px_rgba(79,112,24,0.16)] ring-1 ring-lime-400/70">
            {previewMissions.slice(0, 3).map((mission) => (
              <div
                key={mission.id}
                className={[
                  "rounded-md px-2 py-1 text-[9px] font-semibold",
                  mission.conditional
                    ? "bg-amber-100 text-amber-900 ring-1 ring-amber-300"
                    : "bg-white text-[#263313] shadow-sm",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{mission.reference}</span>
                  <span className="shrink-0 text-[8px] opacity-65">
                    {mission.timeLabel}
                  </span>
                </div>
                <span className="mt-0.5 block text-[8px] font-bold uppercase tracking-[0.12em] opacity-65">
                  Simulation · {mission.conditional ? "Conditionnelle" : "Confirmée"}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {missions.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-md text-center text-[11px] font-medium text-[#a0a69a]">
            {dragDisabled ? "Aucune mission" : "Déposer"}
          </div>
        ) : missions.length === 1 ? (
          <MissionCard
            mission={missions[0]}
            status={getVisibleStatus(missions[0])}
            compact
            className="h-full overflow-hidden"
            onClick={onMissionClick}
            dragDisabled={dragDisabled}
          />
        ) : (
          <div className="flex h-full flex-col gap-[2px]">
            {visibleMissions.map((mission) => (
              <CellMissionRow
                key={mission.id}
                mission={mission}
                onMissionClick={onMissionClick}
                dragDisabled={dragDisabled}
              />
            ))}

            {hasPagination ? (
              <button
                type="button"
                onClick={handlePaginationClick}
                className="mt-auto h-[14px] shrink-0 self-end rounded-full border border-black/10 bg-white px-2 text-[9px] font-semibold leading-none text-[#4f5549] shadow-[0_1px_5px_rgba(17,18,15,0.05)] transition hover:border-lime-300 hover:text-[#415c08]"
              >
                {isLastPage ? "← retour" : `+${remainingMissions} →`}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </td>
  );
}
