import { dayLabels } from "../../../lib/dispatch/mock-data";
import {
  classifyPlanningPoolMissions,
  groupPlanningBuckets,
} from "../../../lib/dispatch/planning-pool";
import type { Driver, Mission, Trailer, Truck } from "../../../lib/dispatch/mock-data";
import type { MissionPlacement } from "./types";

type MobileMissionQueueProps = {
  drivers: Driver[];
  missions: Mission[];
  placements: Record<string, MissionPlacement | null>;
  trailers: Trailer[];
  trucks: Truck[];
  onAssign: (mission: Mission) => void;
  onDetails: (mission: Mission) => void;
  onEdit: (mission: Mission) => void;
  canAssign: boolean;
  canEdit: boolean;
  /** Semaine consultée : nécessaire pour juger la pertinence temporelle. */
  weekStartDate?: Date;
  weekEndDate?: Date;
};

const statusLabels: Record<Mission["status"], string> = {
  pending: "À planifier",
  assigned: "Assignée",
  in_progress: "En cours",
  done: "Terminée",
  issue: "Problème",
  cancelled: "Annulée",
};

export function MobileMissionQueue({
  drivers,
  missions,
  placements,
  trailers,
  trucks,
  onAssign,
  onDetails,
  onEdit,
  canAssign,
  canEdit,
  weekStartDate,
  weekEndDate,
}: MobileMissionQueueProps) {
  // Même classification que le bandeau desktop : l'affectation réelle fait
  // foi, jamais le seul statut ni la semaine consultée.
  const buckets = groupPlanningBuckets(
    classifyPlanningPoolMissions(
      missions.map((mission) => ({
        mission,
        status: mission.status,
        preparationStatus: mission.preparationStatus,
        pickupDate: mission.pickupDate,
        deliveryDate: mission.deliveryDate,
        // Le placement mobile ne porte pas de date : la présence d'une ligne
        // planning ou d'une ressource suffit à prouver l'affectation.
        assignment: placements[mission.id]
          ? {
              planningRowId: placements[mission.id]?.planningRowId ?? null,
              driverId: placements[mission.id]?.driverId ?? null,
              truckId: placements[mission.id]?.truckId ?? null,
            }
          : mission.assignment ?? null,
      })),
      { weekStart: weekStartDate, weekEnd: weekEndDate },
    ),
  );
  const pendingMissions = buckets.PLANNABLE.map((entry) => entry.mission);
  const alertMissions = [
    ...buckets.BACKLOG,
    ...buckets.TO_VERIFY,
    ...buckets.ANOMALY,
  ].map((entry) => entry.mission);
  const issueMissions = missions.filter((mission) => mission.status === "issue");
  const plannedMissions = missions.filter((mission) => {
    const placement = placements[mission.id];
    return Boolean(placement) && mission.status !== "done" && mission.status !== "cancelled";
  });

  return (
    <div className="space-y-5 px-4 pb-28 pt-4">
      <MissionSection
        title="À planifier"
        emptyLabel="Aucune mission en attente."
        drivers={drivers}
        missions={pendingMissions}
        placements={placements}
        trailers={trailers}
        trucks={trucks}
        onAssign={onAssign}
        onDetails={onDetails}
        onEdit={onEdit}
        canAssign={canAssign}
        canEdit={canEdit}
      />
      <MissionSection
        title="À vérifier"
        emptyLabel="Aucune mission à vérifier."
        drivers={drivers}
        missions={alertMissions}
        placements={placements}
        trailers={trailers}
        trucks={trucks}
        onAssign={onAssign}
        onDetails={onDetails}
        onEdit={onEdit}
        canAssign={canAssign}
        canEdit={canEdit}
      />
      <MissionSection
        title="Cette semaine"
        emptyLabel="Aucune mission planifiée cette semaine."
        drivers={drivers}
        missions={plannedMissions}
        placements={placements}
        trailers={trailers}
        trucks={trucks}
        onAssign={onAssign}
        onDetails={onDetails}
        onEdit={onEdit}
        canAssign={canAssign}
        canEdit={canEdit}
      />
      <MissionSection
        title="Problèmes"
        emptyLabel="Aucune mission en problème."
        drivers={drivers}
        missions={issueMissions}
        placements={placements}
        trailers={trailers}
        trucks={trucks}
        onAssign={onAssign}
        onDetails={onDetails}
        onEdit={onEdit}
        canAssign={canAssign}
        canEdit={canEdit}
      />
    </div>
  );
}

type MissionSectionProps = MobileMissionQueueProps & {
  title: string;
  emptyLabel: string;
};

function MissionSection({
  title,
  emptyLabel,
  drivers,
  missions,
  placements,
  trailers,
  trucks,
  onAssign,
  onDetails,
  onEdit,
  canAssign,
  canEdit,
}: MissionSectionProps) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-[11px] font-black uppercase tracking-[0.22em] text-[#697064]">
          {title}
        </h2>
        <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[10px] font-bold text-[#6d7468]">
          {missions.length}
        </span>
      </div>

      {missions.length === 0 ? (
        <p className="rounded-[24px] bg-white px-4 py-5 text-sm font-semibold text-[#7a8074] shadow-[0_10px_30px_rgba(17,18,15,0.05)]">
          {emptyLabel}
        </p>
      ) : (
        <div className="space-y-3">
          {missions.map((mission) => (
            <MobileMissionCard
              key={mission.id}
              drivers={drivers}
              mission={mission}
              placement={placements[mission.id]}
              trailers={trailers}
              trucks={trucks}
              onAssign={() => onAssign(mission)}
              onDetails={() => onDetails(mission)}
              onEdit={() => onEdit(mission)}
              canAssign={canAssign}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MobileMissionCard({
  drivers,
  mission,
  placement,
  trailers,
  trucks,
  onAssign,
  onDetails,
  onEdit,
  canAssign,
  canEdit,
}: {
  drivers: Driver[];
  mission: Mission;
  placement?: MissionPlacement | null;
  trailers: Trailer[];
  trucks: Truck[];
  onAssign: () => void;
  onDetails: () => void;
  onEdit: () => void;
  canAssign: boolean;
  canEdit: boolean;
}) {
  const driver = placement?.driverId
    ? drivers.find((item) => item.id === placement.driverId)
    : undefined;
  const truck = placement?.truckId
    ? trucks.find((item) => item.id === placement.truckId)
    : undefined;
  const trailer = truck
    ? trailers.find((item) => item.truckId === truck.id)
    : undefined;
  const distanceLabel =
    typeof mission.routeDistanceMeters === "number"
      ? `${Math.round(mission.routeDistanceMeters / 1000)} km`
      : typeof mission.estimatedKm === "number" && mission.estimatedKm > 0
        ? `≈ ${mission.estimatedKm} km`
        : "Distance N/A";
  const primaryReference = mission.clientReference || mission.reference;

  return (
    <article
      data-mission-id={mission.id}
      className="rounded-[28px] border border-black/5 bg-white p-4 shadow-[0_14px_38px_rgba(17,18,15,0.07)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7a8074]">
            {primaryReference}
          </p>
          {mission.clientReference ? (
            <p className="mt-0.5 text-[10px] font-semibold text-[#8a9184]">
              Interne : {mission.reference}
            </p>
          ) : null}
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-[#11120f]">
            {mission.clientName}
          </h3>
          <p className="mt-1 text-sm font-semibold text-[#34382f]">
            {mission.pickupCity} <span className="text-[#9aa090]">→</span>{" "}
            {mission.deliveryCity}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-lime-300 bg-lime-100 px-2.5 py-1 text-[10px] font-bold text-[#49630b]">
          {statusLabels[mission.status]}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-semibold text-[#656b60]">
        <Info label="Jour" value={placement ? dayLabels[placement.day] : "Non planifiée"} />
        <Info label="Distance" value={distanceLabel} />
        <Info label="Chauffeur" value={driver?.name ?? "Non assigné"} />
        <Info label="Camion" value={truck?.plateNumber ?? "Non assigné"} />
        <Info label="Remorque" value={trailer?.plateNumber ?? "Non assignée"} />
        <Info label="Prix" value={formatPrice(mission)} />
      </div>

      <div className="mt-4 flex gap-2">
        {canAssign ? <ActionButton label="Assigner" tone="dark" onClick={onAssign} /> : null}
        {canEdit ? <ActionButton label="Modifier" onClick={onEdit} /> : null}
        <ActionButton label="Détails" onClick={onDetails} />
      </div>
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-[#F4F5F1] px-3 py-2">
      <p className="text-[9px] font-black uppercase tracking-[0.14em] text-[#8a9184]">
        {label}
      </p>
      <p className="mt-1 truncate text-[12px] font-bold text-[#252821]">
        {value}
      </p>
    </div>
  );
}

function ActionButton({
  label,
  tone = "soft",
  onClick,
}: {
  label: string;
  tone?: "soft" | "dark";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-11 flex-1 rounded-[17px] text-xs font-bold transition active:scale-95",
        tone === "dark"
          ? "bg-[#11130f] text-white shadow-[0_12px_28px_rgba(17,18,15,0.16)]"
          : "bg-[#F4F5F1] text-[#4f5549]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function formatPrice(mission: Mission) {
  if (typeof mission.priceAmount !== "number") {
    return "Prix N/A";
  }

  return `${mission.priceAmount.toLocaleString("fr-FR")} ${
    mission.priceCurrency ?? "EUR"
  }`;
}
