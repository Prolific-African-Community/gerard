import type { ClientProfile } from "../../dispatch/client-profiles";
import {
  addMissingField,
  applyClientProfileDefaults,
  buildStableFallbackReference,
  cleanEmailText,
  computeConfidence,
  createPreviewBase,
  extractBusinessReference,
  extractDateFromSubject,
  extractDeliveryNoteNumber,
  parseAmount,
  parseFullDate,
  splitLines,
} from "../parser-utils";
import type { MissionImportPreview, NormalizedMailMessage } from "../types";

const fallbackCities = [
  "Luxembourg",
  "Sedan",
  "La Roche-en-Brenil",
  "Honfleur",
  "Bruxelles",
  "Metz",
  "Lyon",
  "Reims",
  "Strasbourg",
  "Paris",
  "Charleroi",
  "Ham",
  "Baillargues",
  "St-Aubin",
  "Toulouse",
  "Puget-sur-Argens",
  "Châteauroux",
  "Marche-en-Famenne",
  "Came",
] as const;

const truckTypeKeywords: Array<[RegExp, string]> = [
  [/\btautliner\b|\bb[âa]ch[ée]\b|\bcovered truck\b/i, "Camion bâché"],
  [/\bplateau\b|\bflatbed\b|\bopen truck\b/i, "Plateau"],
  [/\bfrigo\b|\bfrigorifique\b|\brefrigerated\b/i, "Frigorifique"],
  [/\bcontainer\b/i, "Container"],
];

function looksLikeTransportEmail(value: string) {
  const signals = [
    /\btransport\b/i,
    /\bchargement\b/i,
    /\blivraison\b/i,
    /\bcamion\b/i,
    /\bremorque\b/i,
    /\benl[èe]vement\b/i,
    /\bpickup\b/i,
    /\bdelivery\b/i,
    /\bprix\b/i,
    /\bordre de transport\b/i,
    /\bdestination\b/i,
    /\bplanning\b/i,
  ];

  return signals.filter((pattern) => pattern.test(value)).length >= 2;
}

function findRouteCities(value: string) {
  const routeMatch =
    value.match(/([A-Za-zÀ-ÿ' -]+)\s*(?:->|→|vers|to)\s*([A-Za-zÀ-ÿ' -]+)/i) ??
    value.match(/\bde\s+([A-Za-zÀ-ÿ' -]+)\s+[àa]\s+([A-Za-zÀ-ÿ' -]+)/i);

  if (!routeMatch?.[1] || !routeMatch?.[2]) {
    return {
      pickupCity: undefined,
      deliveryCity: undefined,
    };
  }

  return {
    pickupCity: routeMatch[1].trim(),
    deliveryCity: routeMatch[2].trim(),
  };
}

function extractLabeledValue(
  lines: string[],
  patterns: RegExp[],
) {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
  }

  return undefined;
}

function findCity(value: string) {
  return fallbackCities.find((city) =>
    new RegExp(`\\b${city.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i").test(value),
  );
}

export function parseFallbackTransportEmail(
  email: NormalizedMailMessage,
  profile: ClientProfile | null,
): MissionImportPreview[] {
  const bodyText = cleanEmailText(email.bodyText || email.bodyPreview || "");
  const combinedText = `${email.subject}\n${bodyText}`;
  const lines = splitLines(bodyText);

  if (!looksLikeTransportEmail(combinedText)) {
    return [];
  }

  const routeCities = findRouteCities(combinedText);
  const labeledPickupCity = extractLabeledValue(lines, [
    /^(?:chargement|enl[èe]vement|pickup|loading)\s*[:\-]?\s*(.+)$/i,
  ]);
  const labeledDeliveryCity = extractLabeledValue(lines, [
    /^(?:livraison|d[ée]chargement|delivery|destination)\s*[:\-]?\s*(.+)$/i,
  ]);
  const pickupCity =
    routeCities.pickupCity ??
    labeledPickupCity ??
    findCity(bodyText) ??
    "À confirmer";
  const deliveryCity =
    routeCities.deliveryCity ??
    labeledDeliveryCity ??
    lines
      .map((line) => findCity(line))
      .find((city) => city && city !== pickupCity) ??
    "À confirmer";
  const businessReference = extractBusinessReference(combinedText, profile?.name);
  const reference =
    businessReference ??
    buildStableFallbackReference({
      subject: email.subject,
      clientName: profile?.displayName ?? profile?.name,
      receivedAt: email.receivedAt,
    }) ??
    "Mission à qualifier";
  const priceAmount = parseAmount(
    bodyText.match(/([0-9\s.,]+)\s*(?:EUR|€)/i)?.[1],
  );
  const deliveryNoteNumber = extractDeliveryNoteNumber(combinedText);
  const requiredTruckType = truckTypeKeywords.find(([pattern]) => pattern.test(bodyText))?.[1];
  const pickupDate =
    parseFullDate(
      bodyText.match(
        /(?:date de chargement|chargement le|date d['’]enl[èe]vement|pickup date|loading date)\s*[:\-]?\s*([^\n]+)/i,
      )?.[1],
      new Date(email.receivedAt).getFullYear(),
    ) ?? extractDateFromSubject(email.subject, new Date(email.receivedAt).getFullYear());
  const deliveryDate = parseFullDate(
    bodyText.match(
      /(?:date de livraison|livraison le|date de d[ée]chargement|delivery date|d[ée]chargement le)\s*[:\-]?\s*([^\n]+)/i,
    )?.[1],
    new Date(email.receivedAt).getFullYear(),
  );

  const preview = createPreviewBase(email, email.sourceEmailId, {
    reference,
    referenceSource: businessReference
      ? "business"
      : reference !== "Mission à qualifier"
        ? "subject"
        : undefined,
    clientReference: businessReference ?? undefined,
    deliveryNoteNumber,
    clientName:
      profile?.displayName ??
      profile?.name ??
      email.fromName ??
      email.fromAddress?.split("@")[0]?.replace(/[._-]+/g, " ") ??
      "Client email",
    title: `${pickupCity} -> ${deliveryCity}`,
    pickupCity,
    deliveryCity,
    pickupDate,
    deliveryDate,
    requiredTruckType,
    priceAmount,
    priceCurrency: typeof priceAmount === "number" ? "EUR" : undefined,
    contacts: {
      clientEmail: email.fromAddress ?? undefined,
    },
    notes: bodyText ? `Email transport à confirmer · ${bodyText.slice(0, 320)}` : undefined,
    missingFields: [],
    optionalMissingFields: [],
  });

  if (pickupCity === "À confirmer") addMissingField(preview, "pickupCity");
  if (deliveryCity === "À confirmer") addMissingField(preview, "deliveryCity");
  if (!pickupDate) addMissingField(preview, "pickupDate", true);
  if (!deliveryDate) addMissingField(preview, "deliveryDate", true);
  if (typeof priceAmount !== "number") addMissingField(preview, "priceAmount", true);

  const finalizedPreview = applyClientProfileDefaults(preview, profile);
  finalizedPreview.confidence = Math.max(0.42, computeConfidence(finalizedPreview) - 0.08);

  return [finalizedPreview];
}
