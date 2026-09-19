import type {
  ImportAttentionReason,
  ImportState,
  MissionImportPreview,
} from "./types";

/* ------------------------------------------------------------------ */
/* Vocabulaire du pipeline                                             */
/* ------------------------------------------------------------------ */

export const importStateOrder: ImportState[] = [
  "NEW",
  "PENDING",
  "CREATED",
  "ASSIGNED",
];

export const importStateLabels: Record<ImportState, string> = {
  NEW: "Nouveau",
  PENDING: "En attente",
  CREATED: "Créé",
  ASSIGNED: "Assigné",
};

/**
 * Sémantique visuelle volontairement sobre : le travail restant (Nouveau,
 * En attente) doit dominer, le travail terminé (Créé, Assigné) s'efface.
 */
export const importStateTone: Record<
  ImportState,
  { rail: string; badge: string; dot: string }
> = {
  NEW: {
    rail: "bg-[#11130f]/25",
    badge: "border-black/10 bg-white text-[#4f5549]",
    dot: "bg-[#11130f]",
  },
  PENDING: {
    rail: "bg-amber-400",
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  CREATED: {
    rail: "bg-lime-400",
    badge: "border-lime-300 bg-lime-100 text-[#49630b]",
    dot: "bg-lime-500",
  },
  ASSIGNED: {
    rail: "bg-emerald-400/70",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
};

export const attentionReasonLabels: Record<ImportAttentionReason, string> = {
  missingFields: "Informations à compléter",
  lowConfidence: "Lecture incertaine",
  referenceToVerify: "Référence à vérifier",
  possibleDuplicate: "Mission similaire détectée",
  edited: "Correction en cours",
};

const missingFieldLabels: Record<string, string> = {
  reference: "Référence",
  clientName: "Client",
  pickupCity: "Ville de chargement",
  deliveryCity: "Ville de livraison",
  pickupDate: "Date de chargement",
  deliveryDate: "Date de livraison",
  pickupAddress: "Adresse de chargement",
  deliveryAddress: "Adresse de livraison",
  priceAmount: "Prix",
  requiredTruckType: "Type de camion",
  requiredTrailerType: "Type de remorque",
};

export function getMissingFieldLabel(field: string) {
  return missingFieldLabels[field] ?? field;
}

/**
 * Résumé court de l'attente : une phrase, jamais une liste rouge.
 * Ex. « Adresse de chargement à compléter », « 3 informations à compléter ».
 */
export function summarizeAttention(item: MissionImportPreview): string | null {
  const reasons = item.attentionReasons ?? [];
  if (reasons.length === 0) return null;

  const missing = item.missingFields ?? [];

  if (reasons.includes("missingFields") && missing.length > 0) {
    if (missing.length === 1) {
      return `${getMissingFieldLabel(missing[0])} à compléter`;
    }
    return `${missing.length} informations à compléter`;
  }

  if (reasons.includes("possibleDuplicate")) return attentionReasonLabels.possibleDuplicate;
  if (reasons.includes("referenceToVerify")) return attentionReasonLabels.referenceToVerify;
  if (reasons.includes("lowConfidence")) return attentionReasonLabels.lowConfidence;
  if (reasons.includes("edited")) return attentionReasonLabels.edited;
  return null;
}

/** Ligne d'affectation, uniquement si les données existent réellement. */
export function formatAssignmentSummary(item: MissionImportPreview) {
  const assignment = item.assignment;
  if (!assignment) return null;

  const parts = [
    assignment.driverName,
    assignment.truckPlate,
    assignment.trailerPlate,
  ].filter((value): value is string => Boolean(value && value.trim()));

  return parts.length > 0 ? parts.join(" · ") : null;
}

/* ------------------------------------------------------------------ */
/* Recherche, filtres, tri                                             */
/* ------------------------------------------------------------------ */

export function getImportSearchHaystack(item: MissionImportPreview) {
  return [
    item.reference,
    item.missionReference,
    item.clientReference,
    item.deliveryNoteNumber,
    item.clientName,
    item.pickupCity,
    item.deliveryCity,
    item.sourceEmailSubject,
    item.sourceEmailFrom,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchesImportSearch(item: MissionImportPreview, query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  const haystack = getImportSearchHaystack(item);
  return trimmed.split(/\s+/).every((token) => haystack.includes(token));
}

export type ImportFilters = {
  search?: string;
  client?: string | null;
  /** Bornes ISO inclusives sur la date de réception du mail. */
  receivedFrom?: string | null;
  receivedTo?: string | null;
};

export function filterImports(
  items: MissionImportPreview[],
  filters: ImportFilters,
) {
  return items.filter((item) => {
    if (!matchesImportSearch(item, filters.search ?? "")) return false;

    if (filters.client && (item.clientName ?? "") !== filters.client) {
      return false;
    }

    if (filters.receivedFrom && item.receivedAt < filters.receivedFrom) {
      return false;
    }

    if (filters.receivedTo && item.receivedAt > filters.receivedTo) {
      return false;
    }

    return true;
  });
}

/** Les imports ignorés ne comptent dans aucune des quatre vues. */
export function selectByState(
  items: MissionImportPreview[],
  state: ImportState,
) {
  return items.filter((item) => !item.ignored && item.importState === state);
}

export function countByState(items: MissionImportPreview[]) {
  const counts: Record<ImportState, number> = {
    NEW: 0,
    PENDING: 0,
    CREATED: 0,
    ASSIGNED: 0,
  };

  items.forEach((item) => {
    if (item.ignored || !item.importState) return;
    counts[item.importState] += 1;
  });

  return counts;
}

/** Mail le plus récent en tête : la vue Nouveau se traite de haut en bas. */
export function sortByReceivedDesc(items: MissionImportPreview[]) {
  return [...items].sort((first, second) =>
    second.receivedAt.localeCompare(first.receivedAt),
  );
}

export function listClients(items: MissionImportPreview[]) {
  return Array.from(
    new Set(
      items
        .filter((item) => !item.ignored)
        .map((item) => item.clientName)
        .filter((name): name is string => Boolean(name && name.trim())),
    ),
  ).sort((first, second) => first.localeCompare(second, "fr"));
}

/** Regroupement discret par client pour la vue Nouveau. */
export function groupByClient(items: MissionImportPreview[]) {
  const groups = new Map<string, MissionImportPreview[]>();

  sortByReceivedDesc(items).forEach((item) => {
    const key = item.clientName?.trim() || "Client à qualifier";
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  });

  return Array.from(groups.entries()).map(([client, imports]) => ({
    client,
    imports,
  }));
}
