"use client";

import {
  ControlBar,
  ControlButton,
  ControlDivider,
  ControlGroup,
  Icons,
  SegmentedShell,
  SegmentedTabs,
} from "../ui/ControlKit";
import {
  addDays,
  formatWeekLabel,
  getWeekStartDate,
} from "../../lib/dispatch/date-utils";

export type DispatchToolbarView =
  | "planning"
  | "map"
  | "profitability"
  | "invoices"
  | "park";

/**
 * Barre de contrôles unique du cockpit : vues, semaine et actions vivent sur
 * la même surface. Les libellés longs sont devenus des icônes, le planning
 * gagne la place laissée libre.
 */
export function DispatchToolbar({
  viewMode,
  viewOptions,
  onViewChange,
  selectedWeekStartDate,
  onWeekChange,
  onOpenSearch,
  onOpenAutoPlanning,
  onAnalyzePlanning,
  onOpenAssistant,
  onCompletePlanningRows,
  completePlanningRowsLabel,
  onOpenImports,
  onOpenClientProfiles,
  onCreateMission,
}: {
  viewMode: DispatchToolbarView;
  viewOptions: ReadonlyArray<{ value: DispatchToolbarView; label: string }>;
  onViewChange: (view: DispatchToolbarView) => void;
  /** Absent sur les vues sans notion de semaine (Parc). */
  selectedWeekStartDate?: Date;
  onWeekChange?: (weekStartDate: Date) => void;
  onOpenSearch?: () => void;
  onOpenAutoPlanning?: () => void;
  onAnalyzePlanning?: () => void;
  onOpenAssistant?: () => void;
  onCompletePlanningRows?: () => void;
  completePlanningRowsLabel?: string;
  onOpenImports?: () => void;
  onOpenClientProfiles?: () => void;
  onCreateMission?: () => void;
}) {
  const currentWeekStartDate = getWeekStartDate();
  const isCurrentWeek =
    selectedWeekStartDate?.getTime() === currentWeekStartDate.getTime();

  return (
    <ControlBar className="mb-3">
      {viewOptions.length > 1 ? (
        <SegmentedTabs value={viewMode} options={viewOptions} onChange={onViewChange} />
      ) : null}

      {selectedWeekStartDate && onWeekChange ? (
        <>
          <ControlDivider />

          <div className="flex min-w-0 items-center gap-2">
            <SegmentedShell>
              <ControlButton
                label="Semaine précédente"
                icon={<Icons.chevronLeft />}
                onClick={() => onWeekChange(addDays(selectedWeekStartDate, -7))}
              />
              <ControlButton
                label="Aujourd’hui"
                showLabel
                icon={<span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-accent)]" />}
                onClick={() => onWeekChange(currentWeekStartDate)}
                disabled={isCurrentWeek}
              />
              <ControlButton
                label="Semaine suivante"
                icon={<Icons.chevronRight />}
                onClick={() => onWeekChange(addDays(selectedWeekStartDate, 7))}
              />
            </SegmentedShell>

            <p className="truncate text-[13px] font-semibold tracking-[-0.015em] text-[#11120f]">
              {formatWeekLabel(selectedWeekStartDate)}
            </p>
          </div>
        </>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        {onOpenSearch ? (
          <ControlButton label="Rechercher" icon={<Icons.search />} onClick={onOpenSearch} />
        ) : null}

        {onOpenAssistant ? (
          <ControlButton label="Assistant Gerard" icon={<Icons.assistant />} onClick={onOpenAssistant} />
        ) : null}

        {onOpenAutoPlanning || onAnalyzePlanning || onCompletePlanningRows ? (
          <>
            <ControlDivider />
            <ControlGroup>
              {onOpenAutoPlanning ? (
                <ControlButton
                  label="Planification automatique"
                  icon={<Icons.autoPlan />}
                  tone="solid"
                  onClick={onOpenAutoPlanning}
                />
              ) : null}
              {onAnalyzePlanning ? (
                <ControlButton
                  label="Analyser le planning"
                  icon={<Icons.analyze />}
                  onClick={onAnalyzePlanning}
                />
              ) : null}
              {onCompletePlanningRows ? (
                <ControlButton
                  label={completePlanningRowsLabel ?? "Compléter les lignes de cette semaine"}
                  icon={<Icons.addRows />}
                  onClick={onCompletePlanningRows}
                />
              ) : null}
            </ControlGroup>
          </>
        ) : null}

        {onOpenImports || onOpenClientProfiles || onCreateMission ? (
          <>
            <ControlDivider />
            <ControlGroup>
              {onOpenImports ? (
                <ControlButton label="Imports" icon={<Icons.imports />} onClick={onOpenImports} />
              ) : null}
              {onOpenClientProfiles ? (
                <ControlButton
                  label="Profils clients"
                  icon={<Icons.clients />}
                  onClick={onOpenClientProfiles}
                />
              ) : null}
              {onCreateMission ? (
                <ControlButton
                  label="Nouvelle mission"
                  icon={<Icons.plus />}
                  tone="accent"
                  onClick={onCreateMission}
                />
              ) : null}
            </ControlGroup>
          </>
        ) : null}
      </div>
    </ControlBar>
  );
}
