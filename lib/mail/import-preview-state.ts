import type {
  ImportAssignmentSummary,
  ImportAttentionReason,
  ImportState,
  MissionImportPreview,
} from "./types";

export type ExistingMissionImportIdentity = {
  id: string;
  reference: string;
  sourceEmailId: string | null;
  clientReference: string | null;
  status?: string;
  preparationStatus?: string;
  visibility?: "PLANNING" | "POOL" | "REVIEW_REQUIRED" | "ARCHIVED";
  createdAt?: string | null;
  /** Affectation Planning réelle (MissionAssignment), null si non assignée. */
  assignment?: ImportAssignmentSummary | null;
};

export function filterIgnoredMailImports(
  imports: MissionImportPreview[],
  ignoredPreviewKeys: ReadonlySet<string>,
) {
  return imports.filter((item) => !ignoredPreviewKeys.has(item.id));
}

export function markExistingMailImports(
  imports: MissionImportPreview[],
  existingMissions: ExistingMissionImportIdentity[],
) {
  const existingByReference = new Map(
    existingMissions.map((mission) => [mission.reference, mission]),
  );
  const existingBySourceEmailId = new Map(
    existingMissions
      .filter((mission) => mission.sourceEmailId)
      .map((mission) => [mission.sourceEmailId as string, mission]),
  );
  const existingByClientReference = new Map(
    existingMissions
      .filter((mission) => mission.clientReference)
      .map((mission) => [mission.clientReference as string, mission]),
  );

  return imports.map((item) => {
    const match =
      existingBySourceEmailId.get(item.sourceEmailId) ||
      (item.clientReference
        ? existingByClientReference.get(item.clientReference)
        : undefined) ||
      (item.referenceSource && item.referenceSource !== "subject"
        ? existingByReference.get(item.reference)
        : undefined);
    const duplicateMatchReason = existingBySourceEmailId.get(item.sourceEmailId)
      ? "sourceEmailId" as const
      : item.clientReference && existingByClientReference.get(item.clientReference)
        ? "clientReference" as const
        : match ? "reference" as const : undefined;

    return {
      ...item,
      alreadyCreated: Boolean(match),
      createdMissionId: match?.id,
      duplicateMatchReason,
      existingMissionStatus: match?.status,
      existingMissionReference: match?.reference,
      existingMissionVisibility: match?.visibility,
      missionId: match?.id ?? null,
      missionReference: match?.reference ?? null,
      missionCreatedAt: match?.createdAt ?? null,
      assignment: match?.assignment ?? null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Pipeline : Nouveau → En attente → Créé → Assigné                    */
/* ------------------------------------------------------------------ */

const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** Champs dont l'absence bloque réellement le travail du dispatcher. */
const BLOCKING_MISSING_FIELDS = new Set([
  "reference",
  "clientName",
  "pickupCity",
  "deliveryCity",
  "pickupDate",
  "deliveryDate",
]);

export type ImportStateInput = {
  hasMission: boolean;
  hasAssignment: boolean;
  missingFields?: string[];
  confidence?: number;
  referenceSource?: MissionImportPreview["referenceSource"];
  duplicateMatchReason?: MissionImportPreview["duplicateMatchReason"];
  /** Correction utilisateur commencée, ou mission repoussée volontairement. */
  isEdited?: boolean;
};

/**
 * Liste les raisons pour lesquelles un import réclame une intervention.
 * Vide => l'import est directement exploitable (Nouveau).
 */
export function getImportAttentionReasons(
  input: ImportStateInput,
): ImportAttentionReason[] {
  const reasons: ImportAttentionReason[] = [];

  const blocking = (input.missingFields ?? []).filter((field) =>
    BLOCKING_MISSING_FIELDS.has(field),
  );
  if (blocking.length > 0) reasons.push("missingFields");

  if (
    typeof input.confidence === "number" &&
    input.confidence > 0 &&
    normalizeConfidenceRatio(input.confidence) < LOW_CONFIDENCE_THRESHOLD
  ) {
    reasons.push("lowConfidence");
  }

  // Une référence dérivée du sujet ou générée n'est pas une référence client
  // fiable : elle doit être confirmée avant création.
  if (input.referenceSource === "subject" || input.referenceSource === "generated") {
    reasons.push("referenceToVerify");
  }

  if (input.duplicateMatchReason) reasons.push("possibleDuplicate");

  if (input.isEdited) reasons.push("edited");

  return reasons;
}

/** Ramène une confiance exprimée en % ou en ratio vers un ratio 0..1. */
export function normalizeConfidenceRatio(confidence: number) {
  return confidence > 1 ? confidence / 100 : confidence;
}

/**
 * État réel de l'import. `CREATED` et `ASSIGNED` ne dépendent que de
 * l'existence d'une Mission et d'un MissionAssignment : ils ne peuvent jamais
 * être forcés depuis l'interface.
 */
export function resolveImportState(input: ImportStateInput): ImportState {
  if (input.hasMission && input.hasAssignment) return "ASSIGNED";
  if (input.hasMission) return "CREATED";
  return getImportAttentionReasons(input).length > 0 ? "PENDING" : "NEW";
}

/** Marque les imports mis de côté au lieu de les retirer de la réponse. */
export function markIgnoredMailImports(
  imports: MissionImportPreview[],
  ignoredPreviewKeys: ReadonlyMap<string, string | null>,
): MissionImportPreview[] {
  return imports.map((item) =>
    ignoredPreviewKeys.has(item.id)
      ? { ...item, ignored: true, ignoredAt: ignoredPreviewKeys.get(item.id) ?? null }
      : { ...item, ignored: false },
  );
}

/** Recalcule l'état d'une liste déjà enrichie côté serveur. */
export function applyImportStates(
  imports: MissionImportPreview[],
): MissionImportPreview[] {
  return imports.map((item) => {
    const input: ImportStateInput = {
      hasMission: Boolean(item.missionId ?? item.createdMissionId),
      hasAssignment: Boolean(item.assignment),
      missingFields: item.missingFields,
      confidence: item.confidence,
      referenceSource: item.referenceSource,
      duplicateMatchReason: item.duplicateMatchReason,
    };

    return {
      ...item,
      importState: resolveImportState(input),
      attentionReasons: getImportAttentionReasons(input),
    };
  });
}

export type LocalImportDraft = {
  /** Champs corrigés localement, non encore transformés en mission. */
  fields: Partial<MissionImportPreview>;
  /** Correction commencée ou report volontaire : bascule l'import en attente. */
  isEdited: boolean;
};

/**
 * Superpose les corrections locales aux imports serveur et recalcule l'état.
 *
 * Un import corrigé mais pas encore créé bascule en `PENDING` : c'est du
 * travail commencé. `CREATED` / `ASSIGNED` restent pilotés par la base et ne
 * peuvent jamais être produits par une correction locale.
 */
export function applyLocalEdits(
  items: MissionImportPreview[],
  drafts: Readonly<Record<string, LocalImportDraft>>,
): MissionImportPreview[] {
  return items.map((item) => {
    const draft = drafts[item.id];
    if (!draft) return item;

    const merged: MissionImportPreview = { ...item, ...draft.fields };
    const input: ImportStateInput = {
      hasMission: Boolean(merged.missionId ?? merged.createdMissionId),
      hasAssignment: Boolean(merged.assignment),
      missingFields: merged.missingFields,
      confidence: merged.confidence,
      referenceSource: merged.referenceSource,
      duplicateMatchReason: merged.duplicateMatchReason,
      isEdited: draft.isEdited,
    };

    return {
      ...merged,
      importState: resolveImportState(input),
      attentionReasons: getImportAttentionReasons(input),
    };
  });
}
