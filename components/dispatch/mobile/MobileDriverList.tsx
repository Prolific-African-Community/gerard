import type { Driver } from "../../../lib/dispatch/mock-data";
import { DriverOperationalCardContent } from "../DriverOperationalCardContent";

type MobileDriverListProps = {
  drivers: Driver[];
  onEdit?: (driver: Driver) => void;
};

export function MobileDriverList({
  drivers,
  onEdit,
}: MobileDriverListProps) {
  return (
    <div className="space-y-3 px-4 pb-28 pt-4">
      <div className="flex items-end justify-between">
        <h2 className="text-[11px] font-black uppercase tracking-[0.22em] text-[#697064]">
          Chauffeurs
        </h2>
        <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[10px] font-bold text-[#6d7468]">
          {drivers.length}
        </span>
      </div>

      {drivers.length === 0 ? (
        <p className="rounded-[24px] bg-white px-4 py-5 text-sm font-semibold text-[#7a8074] shadow-[0_10px_30px_rgba(17,18,15,0.05)]">
          Aucun chauffeur enregistré.
        </p>
      ) : (
        drivers.map((driver) => (
          <article
            key={driver.id}
            onClick={() => onEdit?.(driver)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onEdit?.(driver);
              }
            }}
            role={onEdit ? "button" : undefined}
            tabIndex={onEdit ? 0 : undefined}
            aria-label={onEdit ? `Ouvrir la fiche de ${driver.name}` : undefined}
            className={[
              "rounded-[20px] border border-black/5 bg-white px-4 py-3.5 shadow-[0_10px_28px_rgba(17,18,15,0.055)] transition",
              onEdit ? "cursor-pointer hover:ring-1 hover:ring-black/10" : "",
            ].join(" ")}
          >
            <DriverOperationalCardContent minimal driver={driver} />
          </article>
        ))
      )}
    </div>
  );
}
