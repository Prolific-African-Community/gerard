import { useState } from "react";
import type { ReactNode } from "react";

import type {
  Driver,
  DriverStatus,
  Trailer,
  TrailerCargoType,
  TrailerLoadStatus,
  TrailerStatus,
  TrailerType,
  Truck,
  TruckStatus,
} from "../../../lib/dispatch/mock-data";
import {
  trailerCargoTypeLabels,
  trailerLoadStatusLabels,
} from "../../../lib/dispatch/trailer-display";
import { TrailerRotationPanel } from "../TrailerRotationPanel";
import type { TrailerRotationResult } from "../TrailerRotationPanel";
import type { TrailerActiveMission } from "../../../lib/dispatch/trailer-rotation";
import {
  formatTechnicalInspectionDateInput,
  formatTechnicalInspectionDisplayDate,
  getTechnicalInspectionAlertDate,
  getTechnicalInspectionExpiresAt,
  parseTechnicalInspectionDateInput,
} from "../../../lib/dispatch/technical-inspection";
import {
  COUPLING_TYPE_VALUES,
  couplingTypeLabels,
  NOT_PROVIDED_LABEL,
} from "../../../lib/dispatch/technical-attributes";
import { normalizeCompatibleCargoTypes } from "../../../lib/dispatch/form-normalization";
import { DriverRegulatorySummary } from "../DriverRegulatorySummary";

type MobileResourceFormSheetProps = {
  driver: Driver | null;
  trailer: Trailer | null;
  truck: Truck | null;
  trucks: Truck[];
  onClose: () => void;
  onDeleteDriver?: (driverId: string) => Promise<void>;
  onDeleteTrailer?: (trailerId: string) => Promise<void>;
  onDeleteTruck?: (truckId: string) => Promise<void>;
  onSaveDriver: (driverId: string, data: DriverPayload) => Promise<void>;
  onSaveTrailer: (trailerId: string, data: TrailerPayload) => Promise<void>;
  /** Mission réellement portée par la remorque, calculée par l'appelant. */
  trailerActiveMission?: TrailerActiveMission | null;
  availableTrucks?: Truck[];
  canManageTrailers?: boolean;
  onOpenMission?: (missionId: string) => void;
  onTrailerRotated?: (result: TrailerRotationResult, toast: string) => void;
  onSaveTruck: (truckId: string, data: TruckPayload) => Promise<void>;
  canManageDriverCredentials?: boolean;
};

export type DriverPayload = {
  name: string;
  phone?: string | null;
  email?: string | null;
  username?: string | null;
  password?: string | null;
  hourlyCostAmount?: number | null;
  hourlyCostCurrency?: string | null;
  status?: DriverStatus;
  truckId?: string | null;
};

export type TruckPayload = {
  plateNumber: string;
  brand?: string | null;
  model?: string | null;
  status?: TruckStatus;
  gpsDeviceId?: string | null;
  technicalInspectionDate?: string | null;
  category?: string | null;
  capacityKg?: number | null;
  couplingType?: string | null;
};

export type TrailerPayload = {
  plateNumber: string;
  type: TrailerType;
  status: TrailerStatus;
  loadStatus: TrailerLoadStatus;
  cargoType?: TrailerCargoType | null;
  compatibleCargoTypes?: TrailerCargoType[] | null;
  cargoDescription?: string | null;
  notes?: string | null;
  truckId?: string | null;
  technicalInspectionDate?: string | null;
  capacityKg?: number | null;
  couplingType?: string | null;
};

/** Analyse une capacité saisie (chaîne) : '' => null ; sinon entier > 0. */
function parseCapacityInput(
  value: string
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false };
  return { ok: true, value: parsed };
}

const couplingSelectOptions = ["", ...COUPLING_TYPE_VALUES];
const couplingSelectLabels: Record<string, string> = {
  "": NOT_PROVIDED_LABEL,
  ...couplingTypeLabels,
};

const driverStatusOptions: DriverStatus[] = [
  "ACTIVE",
  "UNAVAILABLE",
  "ON_LEAVE",
  "INACTIVE",
];

const truckStatusOptions: TruckStatus[] = [
  "AVAILABLE",
  "ASSIGNED",
  "EN_ROUTE_TO_PICKUP",
  "AT_PICKUP",
  "ON_MISSION",
  "RETURNING_TO_BASE",
  "AT_BASE",
  "IN_MAINTENANCE",
  "MAINTENANCE_EXT",
  "OUT_OF_SERVICE",
];

const trailerTypeOptions: TrailerType[] = [
  "CURTAINSIDER",
  "FLATBED",
  "REFRIGERATED",
  "CONTAINER",
  "BOX",
  "OTHER",
];

const trailerStatusOptions: TrailerStatus[] = [
  "AVAILABLE",
  "ASSIGNED",
  "AT_BASE",
  "IN_MAINTENANCE",
  "MAINTENANCE_EXT",
  "OUT_OF_SERVICE",
];

const trailerStatusLabels: Record<TrailerStatus, string> = {
  AVAILABLE: "Disponible",
  ASSIGNED: "Assignée",
  AT_BASE: "À la Base",
  IN_MAINTENANCE: "Maintenance à la Base",
  MAINTENANCE_EXT: "Maintenance extérieure",
  OUT_OF_SERVICE: "Hors service",
};

const trailerLoadStatusOptions: TrailerLoadStatus[] = ["EMPTY", "LOADED"];

const trailerCargoTypeOptions: TrailerCargoType[] = [
  "WOOD",
  "ALUMINIUM",
  "STEEL",
  "PALLETS",
  "CONSTRUCTION_MATERIALS",
  "FOOD",
  "MACHINERY",
  "TEXTILE",
  "CHEMICALS",
  "OTHER",
];

export function MobileResourceFormSheet({
  driver,
  trailer,
  truck,
  trucks,
  onClose,
  onDeleteDriver,
  onDeleteTrailer,
  onDeleteTruck,
  onSaveDriver,
  onSaveTrailer,
  onSaveTruck,
  canManageDriverCredentials = false,
  trailerActiveMission = null,
  availableTrucks,
  canManageTrailers = true,
  onOpenMission,
  onTrailerRotated,
}: MobileResourceFormSheetProps) {
  if (driver) {
    return (
      <DriverSheet
        driver={driver}
        onClose={onClose}
        onDelete={onDeleteDriver}
        onSave={onSaveDriver}
        canManageCredentials={canManageDriverCredentials}
      />
    );
  }

  if (truck) {
    return (
      <TruckSheet
        truck={truck}
        onClose={onClose}
        onDelete={onDeleteTruck}
        onSave={onSaveTruck}
      />
    );
  }

  if (trailer) {
    return (
      <TrailerSheet
        trailer={trailer}
        trucks={trucks}
        onClose={onClose}
        onDelete={onDeleteTrailer}
        onSave={onSaveTrailer}
        activeMission={trailerActiveMission}
        availableTrucks={availableTrucks}
        canManage={canManageTrailers}
        onOpenMission={onOpenMission}
        onRotated={onTrailerRotated}
      />
    );
  }

  return null;
}

function DriverSheet({
  driver,
  canManageCredentials,
  onClose,
  onDelete,
  onSave,
}: {
  driver: Driver;
  onClose: () => void;
  onDelete?: (driverId: string) => Promise<void>;
  canManageCredentials: boolean;
  onSave: (driverId: string, data: DriverPayload) => Promise<void>;
}) {
  const [name, setName] = useState(driver.name);
  const [phone, setPhone] = useState(driver.phone ?? "");
  const [email, setEmail] = useState(driver.email ?? "");
  const [username, setUsername] = useState(driver.username ?? "");
  const [password, setPassword] = useState("");
  const [hourlyCostAmount, setHourlyCostAmount] = useState(
    typeof driver.hourlyCostAmount === "number"
      ? String(driver.hourlyCostAmount)
      : "",
  );
  const [status, setStatus] = useState<DriverStatus>(driver.status ?? "ACTIVE");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      setError("Le nom chauffeur est obligatoire.");
      return;
    }

    if (canManageCredentials && password && password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }

    const parsedHourlyCost = optionalNumber(hourlyCostAmount);

    if (parsedHourlyCost === null && hourlyCostAmount.trim()) {
      setError("Le coût horaire doit être un nombre valide.");
      return;
    }

    if (typeof parsedHourlyCost === "number" && parsedHourlyCost < 0) {
      setError("Le coût horaire doit être positif.");
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      await onSave(driver.id, {
        name: name.trim(),
        phone: optionalString(phone),
        email: optionalString(email),
        username: canManageCredentials ? optionalString(username) : undefined,
        password: canManageCredentials ? optionalString(password) : undefined,
        hourlyCostAmount: parsedHourlyCost,
        hourlyCostCurrency: "EUR",
        status,
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible de modifier le chauffeur.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    const confirmed = window.confirm(
      "Supprimer cet élément ? Cette action est définitive.",
    );

    if (!confirmed) {
      return;
    }

    try {
      setIsDeleting(true);
      setError(null);
      await onDelete(driver.id);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Impossible de supprimer le chauffeur.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Sheet title="Modifier chauffeur" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nom" value={name} onChange={setName} />
        <Field label="Téléphone" value={phone} onChange={setPhone} />
        <Field label="Email" value={email} onChange={setEmail} />
        <Field
          label="Coût horaire"
          value={hourlyCostAmount}
          onChange={setHourlyCostAmount}
          placeholder="20 €/h"
        />
        {canManageCredentials ? <Field label="Username" value={username} onChange={setUsername} /> : null}
        {canManageCredentials ? <Field
          label="Nouveau password"
          value={password}
          onChange={setPassword}
          type="password"
          placeholder="Laisser vide pour conserver"
        /> : null}
        <Select
          label="Statut"
          value={status}
          onChange={(value) => setStatus(value as DriverStatus)}
          options={driverStatusOptions}
        />
      </div>
      <DriverRegulatorySummary
        driverId={driver.id}
        canCorrect={canManageCredentials}
      />
      <Submit
        deleteLabel="Supprimer chauffeur"
        error={error}
        isDeleting={isDeleting}
        isSaving={isSaving}
        onDelete={handleDelete}
        onSave={handleSave}
      />
    </Sheet>
  );
}

function TruckSheet({
  truck,
  onClose,
  onDelete,
  onSave,
}: {
  truck: Truck;
  onClose: () => void;
  onDelete?: (truckId: string) => Promise<void>;
  onSave: (truckId: string, data: TruckPayload) => Promise<void>;
}) {
  const [plateNumber, setPlateNumber] = useState(truck.plateNumber);
  const [brand, setBrand] = useState(truck.brand ?? "");
  const [model, setModel] = useState(truck.model ?? "");
  const [gpsDeviceId, setGpsDeviceId] = useState(truck.gpsDeviceId ?? "");
  const [technicalInspectionDate, setTechnicalInspectionDate] = useState(
    formatTechnicalInspectionDateInput(truck.technicalInspectionDate),
  );
  const [status, setStatus] = useState<TruckStatus>(
    truck.status ?? "AVAILABLE",
  );
  const [couplingType, setCouplingType] = useState(truck.couplingType ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleSave() {
    if (!plateNumber.trim()) {
      setError("La plaque camion est obligatoire.");
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      await onSave(truck.id, {
        plateNumber: plateNumber.trim(),
        brand: optionalString(brand),
        model: optionalString(model),
        gpsDeviceId: optionalString(gpsDeviceId),
        status,
        technicalInspectionDate: technicalInspectionDate || null,
        couplingType: couplingType ? couplingType : null,
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible de modifier le camion.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    const confirmed = window.confirm(
      "Supprimer cet élément ? Cette action est définitive.",
    );

    if (!confirmed) {
      return;
    }

    try {
      setIsDeleting(true);
      setError(null);
      await onDelete(truck.id);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Impossible de supprimer le camion.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Sheet title="Modifier camion" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Plaque" value={plateNumber} onChange={setPlateNumber} />
        <Field label="Marque" value={brand} onChange={setBrand} />
        <Field label="Modèle" value={model} onChange={setModel} />
        <Field
          label="GPS device ID"
          value={gpsDeviceId}
          onChange={setGpsDeviceId}
        />
        <Select
          label="Statut"
          value={status}
          onChange={(value) => setStatus(value as TruckStatus)}
          options={truckStatusOptions}
        />
        <Field
          label="Dernier contrôle technique"
          type="date"
          value={technicalInspectionDate}
          onChange={setTechnicalInspectionDate}
        />
        <TechnicalInspectionHelp value={technicalInspectionDate} />
        <p className="pt-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#73796d]">
          Attelage du tracteur
        </p>
        <Select
          label="Type d’attelage"
          value={couplingType}
          onChange={setCouplingType}
          options={couplingSelectOptions}
          labels={couplingSelectLabels}
        />
      </div>
      <Submit
        deleteLabel="Supprimer camion"
        error={error}
        isDeleting={isDeleting}
        isSaving={isSaving}
        onDelete={handleDelete}
        onSave={handleSave}
      />
    </Sheet>
  );
}

function TrailerSheet({
  trailer,
  trucks,
  onClose,
  onDelete,
  onSave,
  activeMission = null,
  availableTrucks,
  canManage = true,
  onOpenMission,
  onRotated,
}: {
  trailer: Trailer;
  trucks: Truck[];
  onClose: () => void;
  onDelete?: (trailerId: string) => Promise<void>;
  onSave: (trailerId: string, data: TrailerPayload) => Promise<void>;
  activeMission?: TrailerActiveMission | null;
  availableTrucks?: Truck[];
  canManage?: boolean;
  onOpenMission?: (missionId: string) => void;
  onRotated?: (result: TrailerRotationResult, toast: string) => void;
}) {
  const [plateNumber, setPlateNumber] = useState(trailer.plateNumber);
  const [type, setType] = useState<TrailerType>(trailer.type);
  const [status, setStatus] = useState<TrailerStatus>(trailer.status);
  const [loadStatus, setLoadStatus] = useState<TrailerLoadStatus>(
    trailer.loadStatus ?? "EMPTY",
  );
  const [cargoType, setCargoType] = useState<TrailerCargoType | "">(
    trailer.cargoType ?? "",
  );
  const [compatibleCargoTypes, setCompatibleCargoTypes] = useState(
    trailer.compatibleCargoTypes?.join(", ") ?? "",
  );
  const [cargoDescription, setCargoDescription] = useState(
    trailer.cargoDescription ?? "",
  );
  const [notes, setNotes] = useState(trailer.notes ?? "");
  const [truckId, setTruckId] = useState(trailer.truckId ?? "");
  const [technicalInspectionDate, setTechnicalInspectionDate] = useState(
    formatTechnicalInspectionDateInput(trailer.technicalInspectionDate),
  );
  const [capacityKg, setCapacityKg] = useState(
    typeof trailer.capacityKg === "number" ? String(trailer.capacityKg) : "",
  );
  const [couplingType, setCouplingType] = useState(trailer.couplingType ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleSave() {
    if (!plateNumber.trim()) {
      setError("La plaque remorque est obligatoire.");
      return;
    }

    const capacity = parseCapacityInput(capacityKg);
    if (!capacity.ok) {
      setError(
        "La capacité doit être un nombre entier de kilogrammes strictement positif.",
      );
      return;
    }
    const parsedCompatibleCargoTypes =
      normalizeCompatibleCargoTypes(compatibleCargoTypes);
    if (typeof parsedCompatibleCargoTypes === "undefined") {
      setError("Un type de marchandise compatible est invalide.");
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      await onSave(trailer.id, {
        plateNumber: plateNumber.trim(),
        type,
        status,
        loadStatus,
        cargoType: loadStatus === "LOADED" ? cargoType || null : null,
        compatibleCargoTypes:
          (parsedCompatibleCargoTypes?.length ?? 0) > 0
            ? (parsedCompatibleCargoTypes ?? null)
            : null,
        cargoDescription: optionalString(cargoDescription),
        notes: optionalString(notes),
        truckId: truckId || null,
        technicalInspectionDate: technicalInspectionDate || null,
        capacityKg: capacity.value,
        couplingType: couplingType ? couplingType : null,
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible de modifier la remorque.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    const confirmed = window.confirm(
      "Supprimer cet élément ? Cette action est définitive.",
    );

    if (!confirmed) {
      return;
    }

    try {
      setIsDeleting(true);
      setError(null);
      await onDelete(trailer.id);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Impossible de supprimer la remorque.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Sheet title={trailer.plateNumber} onClose={onClose}>
      <div className="space-y-3">
        {/*
          Exactement le composant desktop : situation en quatre dimensions,
          actions Décrocher / Atteler / Marquer vide / Ouvrir mission et
          derniers mouvements. Aucune règle métier n'est réimplémentée ici.
        */}
        <TrailerRotationPanel
          trailer={trailer}
          trucks={trucks}
          activeMission={activeMission}
          availableTrucks={availableTrucks}
          canManage={canManage}
          onOpenMission={onOpenMission}
          onRotated={onRotated}
        />
        <Field label="Plaque" value={plateNumber} onChange={setPlateNumber} />
        <Select
          label="Type"
          value={type}
          onChange={(value) => setType(value as TrailerType)}
          options={trailerTypeOptions}
        />
        <Select
          label="Statut"
          value={status}
          onChange={(value) => setStatus(value as TrailerStatus)}
          options={trailerStatusOptions}
          labels={trailerStatusLabels}
        />
        <Select
          label="Camion assigné"
          value={truckId}
          onChange={setTruckId}
          options={["", ...trucks.map((truck) => truck.id)]}
          labels={{
            "": "Aucun camion",
            ...Object.fromEntries(
              trucks.map((truck) => [truck.id, truck.plateNumber]),
            ),
          }}
        />
        <div className="rounded-[24px] border border-black/5 bg-[#F7F8F4] p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#73796d]">
            Chargement
          </p>
          <div className="mt-3 space-y-3">
            <Select
              label="État"
              value={loadStatus}
              onChange={(value) => setLoadStatus(value as TrailerLoadStatus)}
              options={trailerLoadStatusOptions}
              labels={{ ...trailerLoadStatusLabels }}
            />
            <Select
              label="Type chargement"
              value={cargoType}
              onChange={(value) => setCargoType(value as TrailerCargoType | "")}
              options={["", ...trailerCargoTypeOptions]}
              labels={{
                "": "Aucun type",
                ...trailerCargoTypeLabels,
              }}
            />
            <Field
              label="Description"
              value={cargoDescription}
              onChange={setCargoDescription}
              placeholder="Profilés aluminium, palettes Europe..."
            />
        </div>
        <Field
          label="Dernier contrôle technique"
          type="date"
          value={technicalInspectionDate}
          onChange={setTechnicalInspectionDate}
        />
        <TechnicalInspectionHelp value={technicalInspectionDate} />
      </div>
        <p className="pt-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#73796d]">
          Capacités et compatibilité
        </p>
        <Field
          label="Capacité utile (kg)"
          type="number"
          value={capacityKg}
          onChange={setCapacityKg}
          placeholder={NOT_PROVIDED_LABEL}
        />
        <Field
          label="Marchandises compatibles"
          value={compatibleCargoTypes}
          onChange={setCompatibleCargoTypes}
          placeholder="PALLETS, FOOD, STEEL"
        />
        <Select
          label="Type d’attelage"
          value={couplingType}
          onChange={setCouplingType}
          options={couplingSelectOptions}
          labels={couplingSelectLabels}
        />
        <Textarea label="Notes" value={notes} onChange={setNotes} />
      </div>
      <Submit
        deleteLabel="Supprimer remorque"
        error={error}
        isDeleting={isDeleting}
        isSaving={isSaving}
        onDelete={handleDelete}
        onSave={handleSave}
      />
    </Sheet>
  );
}

function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/25 px-3 pb-3 backdrop-blur-[2px]">
      <section className="max-h-[88vh] w-full overflow-y-auto rounded-[32px] bg-white p-4 shadow-[0_24px_80px_rgba(17,18,15,0.24)]">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-black/10" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#73796d]">
              Ressource
            </p>
            <h2 className="mt-1 text-xl font-semibold text-[#11120f]">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#F4F5F1] text-sm font-black text-[#565c51]"
          >
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#73796d]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 h-12 w-full rounded-[18px] border border-black/10 bg-[#F4F5F1] px-4 text-sm font-bold text-[#171814] outline-none focus:border-lime-300 focus:bg-white focus:ring-4 focus:ring-lime-200/35"
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#73796d]">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="mt-2 w-full resize-none rounded-[18px] border border-black/10 bg-[#F4F5F1] px-4 py-3 text-sm font-bold text-[#171814] outline-none focus:border-lime-300 focus:bg-white focus:ring-4 focus:ring-lime-200/35"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  labels = {},
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  labels?: Record<string, string>;
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
          <option key={option} value={option}>
            {labels[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

function TechnicalInspectionHelp({ value }: { value: string }) {
  const parsedDate = parseTechnicalInspectionDateInput(value);

  if (!value || parsedDate === null) {
    return (
      <p className="-mt-1 text-xs font-semibold text-[#8a9085]">
        Aucune date de contrôle technique renseignée.
      </p>
    );
  }

  if (typeof parsedDate === "undefined") {
    return (
      <p className="-mt-1 text-xs font-semibold text-red-700">
        Date de contrôle technique invalide.
      </p>
    );
  }

  const expiresAt = getTechnicalInspectionExpiresAt(parsedDate);
  const alertDate = getTechnicalInspectionAlertDate(expiresAt);
  const expiresLabel = formatTechnicalInspectionDisplayDate(expiresAt);
  const alertLabel = formatTechnicalInspectionDisplayDate(alertDate);

  return (
    <p className="-mt-1 text-xs font-semibold text-[#6f756a]">
      Valide jusqu’au : {expiresLabel ?? "à calculer"} · Alerte :{" "}
      {alertLabel ?? "à calculer"}
    </p>
  );
}

function Submit({
  deleteLabel,
  error,
  isDeleting,
  isSaving,
  onDelete,
  onSave,
}: {
  deleteLabel: string;
  error: string | null;
  isDeleting: boolean;
  isSaving: boolean;
  onDelete?: () => void;
  onSave: () => void;
}) {
  return (
    <>
      {error ? (
        <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      <div className={["mt-4 grid gap-2", onDelete ? "grid-cols-2" : "grid-cols-1"].join(" ")}>
        {onDelete ? <button
          type="button"
          onClick={onDelete}
          disabled={isSaving || isDeleting}
          className="h-12 rounded-[20px] bg-red-50 text-xs font-bold text-red-700 disabled:opacity-60"
        >
          {isDeleting ? "Suppression..." : deleteLabel}
        </button> : null}
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || isDeleting}
          className="h-12 rounded-[20px] bg-[#11130f] text-sm font-bold text-white shadow-[0_16px_38px_rgba(17,18,15,0.18)] disabled:bg-black/20"
        >
          {isSaving ? "Enregistrement..." : "Enregistrer"}
        </button>
      </div>
    </>
  );
}

function optionalString(value: string) {
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function optionalNumber(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return undefined;
  }

  const numberValue = Number(trimmedValue.replace(",", "."));
  return Number.isFinite(numberValue) ? numberValue : null;
}
