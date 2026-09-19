import type { ClientProfile } from "../dispatch/client-profiles";
import { mailParserRegistry } from "./mail-parser-registry";
import { parseMinimalEmailPreview } from "./parsers/minimal-parser";
import {
  buildPreviewId,
  buildStableMailReference,
  cleanEmailSubject,
  cleanEmailText,
  computeConfidence,
  findMatchingClientProfileForEmail,
} from "./parser-utils";
import type { MissionImportPreview, NormalizedMailMessage } from "./types";

const ENRICHABLE_FIELDS: ReadonlyArray<keyof MissionImportPreview> = [
  "clientReference",
  "deliveryNoteNumber",
  "pickupDate",
  "deliveryDate",
  "pickupCity",
  "deliveryCity",
  "pickupAddress",
  "deliveryAddress",
  "pickupContact",
  "pickupPhone",
  "pickupEmail",
  "deliveryContact",
  "deliveryPhone",
  "deliveryEmail",
  "pickupLat",
  "pickupLng",
  "deliveryLat",
  "deliveryLng",
  "estimatedKm",
  "routeDistanceMeters",
  "routeDurationSeconds",
  "requiredTruckType",
  "requiredTrailerType",
  "priceAmount",
  "priceCurrency",
  "paymentTerms",
  "preAnnouncementRequired",
  "preAnnouncementSent",
  "preAnnouncementSentAt",
  "requirements",
  "contacts",
  "billingInfo",
  "notes",
];

function mergeFallbackPreview(
  specialized: MissionImportPreview,
  fallback: MissionImportPreview,
  parserChain: string[],
) {
  const merged = { ...specialized };

  for (const field of ENRICHABLE_FIELDS) {
    const currentValue = merged[field];
    const fallbackValue = fallback[field];
    const currentIsMissing =
      currentValue === undefined ||
      currentValue === null ||
      currentValue === "" ||
      currentValue === "À confirmer";

    if (currentIsMissing && fallbackValue !== undefined && fallbackValue !== null) {
      Object.assign(merged, { [field]: fallbackValue });
    }
  }

  return {
    ...merged,
    parserChain,
    missingFields: Array.from(
      new Set([
        ...(specialized.missingFields ?? []),
        ...(fallback.missingFields ?? []),
      ]),
    ),
    optionalMissingFields: Array.from(
      new Set([
        ...(specialized.optionalMissingFields ?? []),
        ...(fallback.optionalMissingFields ?? []),
      ]),
    ),
  };
}

function finalizePreviewIds(
  email: NormalizedMailMessage,
  previews: MissionImportPreview[],
) {
  return previews.map((preview, index) => {
    const sourceEmailId = buildPreviewId(email.sourceEmailId, index);
    const hasAuthoritativeReference =
      preview.referenceSource === "business" ||
      preview.referenceSource === "generated";
    const reference = hasAuthoritativeReference
      ? preview.reference
      : buildStableMailReference(email, index);

    return {
      ...preview,
      id: sourceEmailId,
      sourceEmailId,
      previewKey: preview.previewKey || sourceEmailId,
      cleanedSubject: preview.cleanedSubject || cleanEmailSubject(email.subject),
      reference,
      referenceSource: hasAuthoritativeReference
        ? preview.referenceSource
        : ("generated" as const),
      confidence:
        preview.parserId === "minimal"
          ? Math.min(0.2, preview.confidence)
          : computeConfidence(preview),
    };
  });
}

function parseWithRegistry(
  email: NormalizedMailMessage,
  profile: ClientProfile | null,
) {
  const context = { email, profile };

  for (const parser of mailParserRegistry) {
    if (!parser.canParse(context)) continue;

    let previews: MissionImportPreview[];
    try {
      previews = parser.parse(context);
    } catch {
      previews = [];
    }
    if (previews.length === 0) continue;

    const taggedPreviews = previews.map((preview) => ({
      ...preview,
      parserId: parser.id,
      parserChain: [parser.id],
    }));

    if (parser.id === "fruytier" || parser.id === "hydro") {
      const fallbackParser = mailParserRegistry.find(
        (candidate) => candidate.id === "fallback",
      );
      const needsFallback = taggedPreviews.some(
        (preview) => (preview.missingFields?.length ?? 0) > 0,
      );

      if (fallbackParser && needsFallback) {
        let fallbackPreviews: MissionImportPreview[] = [];
        try {
          fallbackPreviews = fallbackParser.parse(context);
        } catch {
          fallbackPreviews = [];
        }
        const fallbackPreview = fallbackPreviews[0];
        if (fallbackPreview) {
          return taggedPreviews.map((preview) =>
            mergeFallbackPreview(preview, fallbackPreview, [
              parser.id,
              fallbackParser.id,
            ]),
          );
        }
      }
    }

    return taggedPreviews;
  }

  return parseMinimalEmailPreview(email, profile).map((preview) => ({
    ...preview,
    parserId: "minimal",
    parserChain: ["minimal"],
  }));
}

export function parseMissionEmail(
  email: NormalizedMailMessage,
  clientProfiles: ClientProfile[],
): MissionImportPreview[] {
  const cleanedBodyText = cleanEmailText(email.bodyText || email.bodyPreview || "");
  const normalizedEmail: NormalizedMailMessage = {
    ...email,
    bodyText: cleanedBodyText,
    bodyPreview: cleanedBodyText.slice(0, 320),
  };
  const profile = findMatchingClientProfileForEmail(
    normalizedEmail,
    clientProfiles,
  );

  return finalizePreviewIds(
    normalizedEmail,
    parseWithRegistry(normalizedEmail, profile),
  );
}

export function parseMissionEmails(
  emails: NormalizedMailMessage[],
  clientProfiles: ClientProfile[],
) {
  return emails.flatMap((email) => parseMissionEmail(email, clientProfiles));
}
