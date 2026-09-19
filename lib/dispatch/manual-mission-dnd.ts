export function getMissionDropIndex({
  activeTop,
  activeHeight,
  cellTop,
  cellHeight,
  missionCount,
}: {
  activeTop: number | undefined;
  activeHeight: number | undefined;
  cellTop: number;
  cellHeight: number;
  missionCount: number;
}) {
  if (
    typeof activeTop !== "number" ||
    typeof activeHeight !== "number" ||
    !Number.isFinite(activeTop) ||
    !Number.isFinite(activeHeight) ||
    !Number.isFinite(cellTop) ||
    !Number.isFinite(cellHeight) ||
    cellHeight <= 0 ||
    missionCount <= 0
  ) {
    return Math.max(0, missionCount);
  }

  const center = activeTop + activeHeight / 2;
  const relativePosition = Math.min(
    1,
    Math.max(0, (center - cellTop) / cellHeight),
  );

  return Math.min(
    missionCount,
    Math.floor(relativePosition * (missionCount + 1)),
  );
}

export function isSameMissionDestination(
  previousKey: string | null,
  activeId: string,
  overId: string | null,
) {
  return previousKey === `${activeId}:${overId ?? "none"}`;
}

export function getVisibleMissionDays<T extends string>(departureDay: T) {
  return [departureDay]
}

export function resolveMissionPlacementAfterRequest<T>(
  previousPlacement: T,
  requestedPlacement: T,
  succeeded: boolean
) {
  return succeeded ? requestedPlacement : previousPlacement
}
