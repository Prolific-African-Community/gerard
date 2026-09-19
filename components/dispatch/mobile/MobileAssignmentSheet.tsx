import { useMemo, useState } from "react";

import { dayLabels, dispatchDays } from "../../../lib/dispatch/mock-data";
import type { DispatchDay, Driver, Mission, Trailer, Truck } from "../../../lib/dispatch/mock-data";
import type { MissionPlacement } from "./types";

const planningDays = dispatchDays.filter(
  (day) => day !== "saturday" && day !== "sunday",
);

type MobileAssignmentSheetProps = {
  drivers: Driver[];
  isSaving: boolean;
  mission: Mission | null;
  placement?: MissionPlacement | null;
  trailers: Trailer[];
  trucks: Truck[];
  onAssign: (data: {
    day: DispatchDay;
    driverId: string | null;
    truckId: string | null;
    trailerId: string | null;
  }) => Promise<void>;
  onClose: () => void;
};

export function MobileAssignmentSheet({
  drivers,
  isSaving,
  mission,
  placement,
  trailers,
  trucks,
  onAssign,
  onClose,
}: MobileAssignmentSheetProps) {
  const initialTruckId = placement?.truckId ?? "";
  const [day, setDay] = useState<DispatchDay>(placement?.day ?? "monday");
  const [driverId, setDriverId] = useState(placement?.driverId ?? "");
  const [truckId, setTruckId] = useState(initialTruckId);
  const [trailerId, setTrailerId] = useState("");

  const selectedDriverTruck = useMemo(() => {
    if (!driverId) {
      return undefined;
    }

    return trucks.find((truck) => truck.driverId === driverId);
  }, [driverId, trucks]);

  if (!mission) {
    return null;
  }

  function handleDriverChange(nextDriverId: string) {
    setDriverId(nextDriverId);

    const truck = trucks.find((item) => item.driverId === nextDriverId);
    if (truck && !truckId) {
      setTruckId(truck.id);
    }
  }

  async function handleSubmit() {
    await onAssign({
      day,
      driverId: driverId || null,
      truckId: truckId || null,
      trailerId: trailerId || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/25 px-3 pb-3 backdrop-blur-[2px]">
      <section className="w-full rounded-[32px] bg-white p-4 shadow-[0_24px_80px_rgba(17,18,15,0.24)]">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-black/10" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#73796d]">
              Assigner mission
            </p>
            <h2 className="mt-1 truncate text-xl font-semibold text-[#11120f]">
              {mission.reference}
            </h2>
            <p className="mt-1 text-sm font-semibold text-[#565c51]">
              {mission.pickupCity} → {mission.deliveryCity}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#F4F5F1] text-sm font-black text-[#565c51]"
          >
            ×
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <Select
            label="Jour"
            value={day}
            onChange={(value) => setDay(value as DispatchDay)}
            options={planningDays.map((item) => ({
              value: item,
              label: dayLabels[item],
            }))}
          />
          <Select
            label="Chauffeur"
            value={driverId}
            onChange={handleDriverChange}
            options={[
              { value: "", label: "Aucun chauffeur" },
              ...drivers.map((driver) => ({
                value: driver.id,
                label: driver.name,
              })),
            ]}
          />
          {selectedDriverTruck && !truckId ? (
            <p className="rounded-2xl bg-lime-50 px-3 py-2 text-[11px] font-semibold text-[#49630b]">
              Camion proposé : {selectedDriverTruck.plateNumber}
            </p>
          ) : null}
          <Select
            label="Camion"
            value={truckId}
            onChange={setTruckId}
            options={[
              { value: "", label: "Aucun camion" },
              ...trucks.map((truck) => ({
                value: truck.id,
                label: `${truck.plateNumber}${
                  truck.driverId && truck.driverId !== driverId
                    ? " · déjà affecté"
                    : ""
                }`,
              })),
            ]}
          />
          <Select
            label="Remorque"
            value={trailerId}
            onChange={setTrailerId}
            options={[
              { value: "", label: "Aucune remorque" },
              ...trailers.map((trailer) => ({
                value: trailer.id,
                label: `${trailer.plateNumber}${
                  trailer.truckId && trailer.truckId !== truckId
                    ? " · déjà assignée"
                    : ""
                }`,
              })),
            ]}
          />
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSaving}
          className="mt-4 h-12 w-full rounded-[20px] bg-[#11130f] text-sm font-bold text-white shadow-[0_16px_38px_rgba(17,18,15,0.18)] disabled:bg-black/20"
        >
          {isSaving ? "Assignation..." : "Valider"}
        </button>
      </section>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#73796d]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-12 w-full rounded-[18px] border border-black/10 bg-[#F4F5F1] px-4 text-sm font-bold text-[#171814] outline-none focus:border-lime-300 focus:bg-white focus:ring-4 focus:ring-lime-200/35"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

