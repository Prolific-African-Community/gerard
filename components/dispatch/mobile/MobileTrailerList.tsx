import type { Trailer, Truck } from "../../../lib/dispatch/mock-data";
import {
  getTrailerCargoLabel,
  getTrailerCargoStyle,
  getTrailerLoadLabel,
} from "../../../lib/dispatch/trailer-display";

type MobileTrailerListProps = {
  trailers: Trailer[];
  trucks: Truck[];
  onEdit?: (trailer: Trailer) => void;
  onMaintenance?: (trailer: Trailer) => void;
};

const trailerTypeLabels: Record<string, string> = {
  CURTAINSIDER: "Bâchée",
  FLATBED: "Plateau",
  REFRIGERATED: "Frigorifique",
  CONTAINER: "Container",
  BOX: "Fourgon",
  OTHER: "Autre",
};

const trailerStatusLabels: Record<string, string> = {
  AVAILABLE: "Disponible",
  ASSIGNED: "Assignée",
  AT_BASE: "À la Base",
  IN_MAINTENANCE: "Maintenance à la Base",
  MAINTENANCE_EXT: "Maintenance extérieure",
  OUT_OF_SERVICE: "Hors service",
};

export function MobileTrailerList({
  trailers,
  trucks,
  onEdit,
  onMaintenance,
}: MobileTrailerListProps) {
  return (
    <div className="space-y-3 px-4 pb-28 pt-4">
      <div className="flex items-end justify-between">
        <h2 className="text-[11px] font-black uppercase tracking-[0.22em] text-[#697064]">
          Remorques
        </h2>
        <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[10px] font-bold text-[#6d7468]">
          {trailers.length}
        </span>
      </div>

      {trailers.length === 0 ? (
        <p className="rounded-[24px] bg-white px-4 py-5 text-sm font-semibold text-[#7a8074] shadow-[0_10px_30px_rgba(17,18,15,0.05)]">
          Aucune remorque enregistrée.
        </p>
      ) : (
        trailers.map((trailer) => {
          const truck = trailer.truckId
            ? trucks.find((item) => item.id === trailer.truckId)
            : undefined;
          const cargoStyle = getTrailerCargoStyle(trailer);
          const cargoLabel = getTrailerCargoLabel(trailer);
          const loadLabel = getTrailerLoadLabel(trailer);

          return (
            <article
              key={trailer.id}
              data-trailer-id={trailer.id}
              onClick={() => onEdit?.(trailer)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onEdit?.(trailer);
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
                    {trailer.plateNumber}
                  </h3>
                  <p className="mt-1 text-xs font-semibold text-[#747a6f]">
                    {trailerTypeLabels[trailer.type]}
                  </p>
                </div>
                <span className="rounded-full border border-lime-300 bg-lime-100 px-2.5 py-1 text-[10px] font-bold text-[#49630b]">
                  {trailerStatusLabels[trailer.status]}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <span
                  className={[
                    "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em]",
                    cargoStyle.badge,
                  ].join(" ")}
                >
                  {loadLabel}
                </span>
                {cargoLabel ? (
                  <span
                    className={[
                      "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em]",
                      cargoStyle.badge,
                    ].join(" ")}
                  >
                    {cargoLabel}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Info
                  label="Camion"
                  value={truck?.plateNumber ?? "Non assignée"}
                />
                <Info label="Type" value={trailerTypeLabels[trailer.type]} />
              </div>

              {trailer.notes ? (
                <p className="mt-3 rounded-2xl bg-[#F4F5F1] px-3 py-2 text-xs font-semibold leading-relaxed text-[#656b60]">
                  {trailer.notes}
                </p>
              ) : null}
              {trailer.cargoDescription ? (
                <p
                  className={[
                    "mt-3 rounded-2xl px-3 py-2 text-xs font-bold leading-relaxed",
                    cargoStyle.badge,
                  ].join(" ")}
                >
                  {trailer.cargoDescription}
                </p>
              ) : null}

              {onMaintenance ? <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onMaintenance(trailer);
                }}
                className="mt-4 h-11 w-full rounded-[17px] bg-[#F4F5F1] text-xs font-bold text-[#4f5549]"
              >
                Maintenance
              </button> : null}
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
