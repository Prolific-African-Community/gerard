import type { MissionImportPreview } from "./types";

export type EditableMissionImport = MissionImportPreview & {
  editedFields: Record<string, unknown>;
  isDirty: boolean;
};

export function createEditableMissionImport(
  preview: MissionImportPreview,
): EditableMissionImport {
  return {
    ...preview,
    editedFields: {},
    isDirty: false,
  };
}

export function editMissionImportField<
  Field extends keyof MissionImportPreview,
>(
  preview: EditableMissionImport,
  field: Field,
  value: MissionImportPreview[Field],
): EditableMissionImport {
  const next = {
    ...preview,
    [field]: value,
    editedFields: {
      ...preview.editedFields,
      [field]: value,
    },
    isDirty: true,
  };
  return recalculateImportMissingFields(next);
}

/** Rebuild parser warnings from the values that will actually be sent. */
export function recalculateImportMissingFields(
  preview: EditableMissionImport,
): EditableMissionImport {
  const missing: string[] = [];
  const empty = (value: unknown) =>
    value === undefined || value === null ||
    (typeof value === "string" && value.trim().length === 0);
  if (empty(preview.reference)) missing.push("reference");
  if (empty(preview.clientName)) missing.push("clientName");
  if (empty(preview.pickupCity)) missing.push("pickupCity");
  if (empty(preview.deliveryCity)) missing.push("deliveryCity");
  if (empty(preview.pickupDate)) missing.push("pickupDate");
  if (empty(preview.deliveryDate)) missing.push("deliveryDate");
  if (empty(preview.pickupAddress)) missing.push("pickupAddress");
  if (empty(preview.deliveryAddress)) missing.push("deliveryAddress");
  if (empty(preview.priceAmount)) missing.push("priceAmount");
  if (empty(preview.requiredTruckType)) missing.push("requiredTruckType");
  if (empty(preview.requiredTrailerType)) missing.push("requiredTrailerType");
  return { ...preview, missingFields: missing };
}

export function normalizeMissionReference(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, "-").toUpperCase();
}

export function suggestAvailableReference(
  requestedReference: string,
  usedReferences: ReadonlySet<string>,
) {
  const normalized = normalizeMissionReference(requestedReference);
  if (!normalized || !usedReferences.has(normalized)) return normalized;

  let suffix = 2;
  while (usedReferences.has(`${normalized}-${suffix}`)) suffix += 1;
  return `${normalized}-${suffix}`;
}

export function mergeRequiredTrailerType(
  requirements: Record<string, unknown> | undefined,
  requiredTrailerType: string | undefined,
) {
  if (!requiredTrailerType?.trim()) return requirements;
  return {
    ...(requirements ?? {}),
    requiredTrailerType: requiredTrailerType.trim(),
  };
}

export function collectImportMissionWarnings(input: {
  clientName?: unknown;
  pickupCity?: unknown;
  deliveryCity?: unknown;
  pickupAddress?: unknown;
  deliveryAddress?: unknown;
  pickupDate?: unknown;
  deliveryDate?: unknown;
  priceAmount?: unknown;
  requiredTruckType?: unknown;
  requiredTrailerType?: unknown;
  contacts?: unknown;
  confidence?: unknown;
  alreadyCreated?: unknown;
}) {
  const warnings: string[] = [];
  const missing = (value: unknown) =>
    value === undefined ||
    value === null ||
    (typeof value === "string" &&
      (!value.trim() || value.trim().toLowerCase() === "à confirmer"));

  if (missing(input.clientName)) warnings.push("Client à confirmer.");
  if (missing(input.pickupCity)) warnings.push("Ville de chargement à confirmer.");
  if (missing(input.deliveryCity)) warnings.push("Ville de livraison à confirmer.");
  if (missing(input.pickupAddress)) warnings.push("Adresse de chargement à confirmer.");
  if (missing(input.deliveryAddress)) warnings.push("Adresse de livraison à confirmer.");
  if (missing(input.pickupDate)) warnings.push("Date de chargement à confirmer.");
  if (missing(input.deliveryDate)) warnings.push("Date de livraison à confirmer.");
  if (missing(input.priceAmount)) warnings.push("Prix à confirmer.");
  if (missing(input.requiredTruckType)) warnings.push("Type de camion à confirmer.");
  if (missing(input.requiredTrailerType)) warnings.push("Type de remorque à confirmer.");
  if (
    !input.contacts ||
    typeof input.contacts !== "object" ||
    Object.keys(input.contacts).length === 0
  ) {
    warnings.push("Contacts à compléter.");
  }
  if (typeof input.confidence === "number" && input.confidence < 0.6) {
    warnings.push("Confiance de parsing faible.");
  }
  if (input.alreadyCreated === true) {
    warnings.push("Un e-mail ou une mission similaire existe déjà.");
  }

  return warnings;
}
