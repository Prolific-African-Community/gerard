"use client";

import {
  addDays,
  formatWeekLabel,
  getWeekStartDate,
} from "../../lib/dispatch/date-utils";
import { SmartSearchButton } from "./DispatchSmartSearch";

type WeekNavigatorProps = {
  selectedWeekStartDate: Date;
  onWeekChange: (weekStartDate: Date) => void;
  onCreateMission?: () => void;
  onOpenImports?: () => void;
  onOpenClientProfiles?: () => void;
  onOpenAutoPlanning?: () => void;
  onOpenSearch?: () => void;
};

export function WeekNavigator({
  selectedWeekStartDate,
  onWeekChange,
  onCreateMission,
  onOpenImports,
  onOpenClientProfiles,
  onOpenAutoPlanning,
  onOpenSearch,
}: WeekNavigatorProps) {
  const currentWeekStartDate = getWeekStartDate();
  const isCurrentWeek =
    selectedWeekStartDate.getTime() === currentWeekStartDate.getTime();

  const buttonBase =
    "appearance-none !border-0 outline-none ring-0 rounded-[18px] px-4 py-2.5 text-xs font-semibold tracking-[-0.01em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/60";

  const buttonSoft =
    "bg-white/70 text-[#5f665b] shadow-[0_10px_26px_rgba(17,18,15,0.06)] hover:-translate-y-0.5 hover:bg-[#B9FF4A]/20 hover:text-[#11120f] hover:shadow-[0_14px_32px_rgba(17,18,15,0.09)]";

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#73796d]">
          Planning
        </p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-[#11120f]">
          {formatWeekLabel(selectedWeekStartDate)}
        </h2>
      </div>

      <div className="flex items-center gap-3">
        {onOpenSearch ? <SmartSearchButton onClick={onOpenSearch} /> : null}

        {onOpenAutoPlanning ? (
          <button
            type="button"
            onClick={onOpenAutoPlanning}
            className="h-[46px] rounded-[18px] bg-[#11130f] px-5 text-xs font-semibold text-white shadow-[0_12px_30px_rgba(17,19,15,0.16)] transition hover:-translate-y-0.5 hover:bg-[#B9FF4A] hover:text-[#11130f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/70"
            style={{ border: 0 }}
          >
            Planification automatique
          </button>
        ) : null}
        {onOpenImports ? (
          <button
            type="button"
            onClick={onOpenImports}
            style={{ border: 0 }}
            className="h-[46px] rounded-[18px] bg-white/70 px-4 text-xs font-semibold tracking-[-0.01em] text-[#5f665b] shadow-[0_10px_26px_rgba(17,18,15,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#B9FF4A]/20 hover:text-[#11120f] hover:shadow-[0_14px_32px_rgba(17,18,15,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/60"
          >
            Imports
          </button>
        ) : null}

        {onOpenClientProfiles ? (
          <ClientProfilesButton onClick={onOpenClientProfiles} />
        ) : null}

        {onCreateMission ? (
          <CreateMissionButton onClick={onCreateMission} />
        ) : null}

        <div className="flex items-center gap-1.5 rounded-[24px] !border-0 bg-black/[0.035] p-1.5 shadow-[0_18px_50px_rgba(17,18,15,0.05)]">
          <button
            type="button"
            style={{ border: 0 }}
            onClick={() => onWeekChange(addDays(selectedWeekStartDate, -7))}
            className={`${buttonBase} ${buttonSoft}`}
          >
            Précédente
          </button>

          <button
            type="button"
            style={{ border: 0 }}
            onClick={() => onWeekChange(currentWeekStartDate)}
            disabled={isCurrentWeek}
            className={[
              buttonBase,
              isCurrentWeek
                ? "cursor-default bg-black/[0.045] text-[#9aa090]"
                : "bg-white/70 text-[#5f665b] shadow-[0_10px_26px_rgba(17,18,15,0.06)] hover:bg-[#B9FF4A]/20 hover:text-[#11120f]",
            ].join(" ")}
          >
            Aujourd’hui
          </button>

          <button
            type="button"
            style={{ border: 0 }}
            onClick={() => onWeekChange(addDays(selectedWeekStartDate, 7))}
            className={`${buttonBase} ${buttonSoft}`}
          >
            Suivante
          </button>
        </div>
      </div>
    </div>
  );
}

type CreateMissionButtonProps = {
  onClick: () => void;
};

type ClientProfilesButtonProps = {
  onClick: () => void;
};

function ClientProfilesButton({ onClick }: ClientProfilesButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ border: 0 }}
      aria-label="Ouvrir les profils clients"
      className="group relative flex h-[46px] w-[46px] appearance-none items-center justify-start overflow-hidden rounded-[18px] bg-white/85 pl-[7px] pr-4 text-[#11130F] shadow-[0_14px_34px_rgba(17,18,15,0.10)] outline-none ring-0 transition-all duration-300 ease-out hover:w-[156px] hover:-translate-y-0.5 hover:shadow-[0_20px_46px_rgba(17,18,15,0.16)] focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/70"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[14px] bg-[#EEF0E8] text-[#11130F] shadow-[0_8px_18px_rgba(17,18,15,0.08)] transition-transform duration-300 group-hover:scale-[1.04] group-hover:bg-[#B9FF4A]">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-[15px] w-[15px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 19.5h16" />
          <path d="M6.5 19.5V8.5A1.5 1.5 0 0 1 8 7h8a1.5 1.5 0 0 1 1.5 1.5v11" />
          <path d="M9 11h6" />
          <path d="M9 14.5h6" />
          <path d="M12 7V4.5" />
        </svg>
      </span>

      <span className="ml-3 translate-x-2 whitespace-nowrap text-[13px] font-semibold tracking-[-0.02em] opacity-0 transition-all duration-300 ease-out group-hover:translate-x-0 group-hover:opacity-100">
        Profils clients
      </span>
    </button>
  );
}

function CreateMissionButton({ onClick }: CreateMissionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ border: 0 }}
      aria-label="Créer une mission"
      className="group relative flex h-[46px] w-[46px] appearance-none items-center justify-start overflow-hidden rounded-[18px] bg-[#11130F] pl-[7px] pr-4 text-white shadow-[0_14px_34px_rgba(17,18,15,0.16)] outline-none ring-0 transition-all duration-300 ease-out hover:w-[164px] hover:-translate-y-0.5 hover:shadow-[0_20px_46px_rgba(17,18,15,0.22)] focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/70"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[14px] bg-[#B9FF4A] text-[#11130F] shadow-[0_8px_18px_rgba(185,255,74,0.22)] transition-transform duration-300 group-hover:scale-[1.04]">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-[15px] w-[15px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </span>

      <span className="ml-3 translate-x-2 whitespace-nowrap text-[13px] font-semibold tracking-[-0.02em] opacity-0 transition-all duration-300 ease-out group-hover:translate-x-0 group-hover:opacity-100">
        Nouvelle mission
      </span>
    </button>
  );
}
