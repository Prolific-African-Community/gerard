import type { ClientProfile } from "../../dispatch/client-profiles";
import { getClientProfileDisplayName } from "../../dispatch/client-profiles";
import {
  applyClientProfileDefaults,
  buildStableMailReference,
  cleanEmailText,
  createPreviewBase,
} from "../parser-utils";
import type { MissionImportPreview, NormalizedMailMessage } from "../types";

export function parseMinimalEmailPreview(
  email: NormalizedMailMessage,
  profile: ClientProfile | null,
): MissionImportPreview[] {
  const reference = buildStableMailReference(email);
  const senderName =
    email.fromName?.trim() ||
    email.fromAddress?.split("@")[0]?.replace(/[._-]+/g, " ").trim() ||
    "Expéditeur inconnu";
  const cleanedBody = cleanEmailText(email.bodyText || email.bodyPreview || "");

  const preview = createPreviewBase(email, email.sourceEmailId, {
    parserId: "minimal",
    parserChain: ["minimal"],
    reference,
    referenceSource: "generated",
    title: email.subject || "Email sans objet",
    clientName: profile ? getClientProfileDisplayName(profile) : senderName,
    pickupCity: "À confirmer",
    deliveryCity: "À confirmer",
    notes: cleanedBody ? `Email à qualifier · ${cleanedBody.slice(0, 320)}` : undefined,
    contacts: {
      clientEmail: email.fromAddress ?? undefined,
    },
    missingFields: [
      "clientReference",
      "pickupCity",
      "pickupDate",
      "pickupAddress",
      "deliveryCity",
      "deliveryDate",
      "deliveryAddress",
    ],
    optionalMissingFields: ["priceAmount", "requiredTruckType"],
    confidence: 0.15,
  });

  return [applyClientProfileDefaults(preview, profile)];
}
