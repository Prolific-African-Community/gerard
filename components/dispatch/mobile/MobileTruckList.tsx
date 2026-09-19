import type { Driver, Mission, Trailer, Truck } from "../../../lib/dispatch/mock-data";
import { getTrailerCargoStyle } from "../../../lib/dispatch/trailer-display";
import type { MissionPlacement, TruckPosition } from "./types";

type MobileTruckListProps = {
  drivers: Driver[];
  missions: Mission[];
  placements: Record<string, MissionPlacement | null>;
  trailers: Trailer[];
  trucks: Truck[];
  truckPositions: TruckPosition[];
  onEdit?: (truck: Truck) => void;
  onShowMap: () => void;
  onMaintenance?: (truck: Truck) => void;
};

const truckStatusLabels: Record<string, string> = {
  AVAILABLE: "Disponible",
  ASSIGNED: "Assigné",
  EN_ROUTE_TO_PICKUP: "Vers pickup",
  AT_PICKUP: "Au pickup",
  ON_MISSION: "En mission",
  RETURNING_TO_BASE: "Retour base",
  AT_BASE: "À la base",
  IN_MAINTENANCE: "Maintenance",
  MAINTENANCE_EXT: "Maintenance extérieure",
  OUT_OF_SERVICE: "Hors service",
};

export function MobileTruckList({
  drivers,
  missions,
  placements,
  trailers,
  trucks,
  truckPositions,
  onEdit,
  onShowMap,
  onMaintenance,
}: MobileTruckListProps) {
  return (
    <div className="space-y-3 px-4 pb-28 pt-4">
      <div className="flex items-end justify-between">
        <h2 className="text-[11px] font-black uppercase tracking-[0.22em] text-[#697064]">
          Camions
        </h2>
        <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[10px] font-bold text-[#6d7468]">
          {trucks.length}
        </span>
      </div>

      {trucks.length === 0 ? (
        <p className="rounded-[24px] bg-white px-4 py-5 text-sm font-semibold text-[#7a8074] shadow-[0_10px_30px_rgba(17,18,15,0.05)]">
          Aucun camion enregistré.
        </p>
      ) : (
        trucks.map((truck) => {
          const driver = truck.driverId
            ? drivers.find((item) => item.id === truck.driverId)
            : undefined;
          const trailer = trailers.find((item) => item.truckId === truck.id);
          const mission = missions.find((item) => {
            const placement = placements[item.id];
            return placement?.truckId === truck.id && item.status !== "done";
          });
          const position = truckPositions.find((item) => item.truckId === truck.id);
          const cargoStyle = getTrailerCargoStyle(trailer);

          return (
            <article
              key={truck.id}
              data-truck-id={truck.id}
              onClick={() => onEdit?.(truck)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onEdit?.(truck);
                }
              }}
              role={onEdit ? "button" : undefined}
              tabIndex={onEdit ? 0 : undefined}
              className={[
                "rounded-[28px] border p-4 shadow-[0_14px_38px_rgba(17,18,15,0.07)] transition",
                onEdit ? "cursor-pointer hover:ring-1 hover:ring-black/10" : "",
                cargoStyle.card,
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-semibold tracking-tight text-[#11120f]">
                    {truck.plateNumber}
                  </h3>
                  <p className="mt-1 text-xs font-semibold text-[#747a6f]">
                    {[truck.brand, truck.model].filter(Boolean).join(" · ") ||
                      "Modèle non renseigné"}
                  </p>
                </div>
                <span className="rounded-full border border-lime-300 bg-lime-100 px-2.5 py-1 text-[10px] font-bold text-[#49630b]">
                  {truckStatusLabels[truck.status ?? "AVAILABLE"] ?? truck.status}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Info label="Chauffeur" value={driver?.name ?? "Non assigné"} />
                <Info label="Remorque" value={trailer?.plateNumber ?? "Non assignée"} />
                <Info label="Mission" value={mission?.reference ?? "Aucune"} />
                <Info
                  label="Live"
                  value={position ? formatPosition(position.recordedAt) : "Aucune"}
                />
              </div>

              <div className="mt-4 flex gap-2">
                {onMaintenance ? <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onMaintenance(truck);
                  }}
                  className="h-11 flex-1 rounded-[17px] bg-[#F4F5F1] text-xs font-bold text-[#4f5549]"
                >
                  Maintenance
                </button> : null}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onShowMap();
                  }}
                  disabled={!position}
                  className="h-11 flex-1 rounded-[17px] bg-[#11130f] text-xs font-bold text-white disabled:bg-black/20"
                >
                  Carte
                </button>
              </div>
            </article>
          );
        })
      )}
    </div>
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

function formatPosition(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
