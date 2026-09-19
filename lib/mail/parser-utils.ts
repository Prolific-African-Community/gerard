import type { ClientProfile } from "../dispatch/client-profiles";
import {
  getStringArray,
  normalizeEmailAddresses,
  normalizeEmailDomains,
} from "../dispatch/client-profiles";
import type { MissionImportPreview, NormalizedMailMessage } from "./types";

export function isTechnicalOutlookAddress(value: string): boolean {
  const upper = value.toUpperCase();
  return (
    /\b[A-Z]{2,}\d*PR\d+[A-Z]*\d*MB\d+\b/.test(upper) ||
    upper.includes("@AM0PR") ||
    upper.includes("@VI0PR") ||
    upper.includes("@DB") ||
    upper.includes("EURPRD") ||
    upper.includes("PROD.OUTLOOK.COM")
  );
}

function looksLikeEmailAddress(value: string) {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value);
}

function isReferenceNoise(value: string) {
  const normalized = normalizeWhitespace(value).toUpperCase();
  return (
    normalized.length === 0 ||
    normalized.length > 160 ||
    isTechnicalOutlookAddress(normalized) ||
    looksLikeEmailAddress(normalized) ||
    /^RE[:\s]/i.test(normalized) ||
    /^FW[:\s]/i.test(normalized) ||
    /^FWD[:\s]/i.test(normalized) ||
    /^TR[:\s]/i.test(normalized) ||
    normalized.includes("CONFIDENTIALITY NOTICE") ||
    normalized.includes("PLEASE CONSIDER THE ENVIRONMENT")
  );
}

export function formatConfidence(value: number): string {
  if (value <= 1) return Math.round(value * 100) + "%";
  return Math.round(value) + "%";
}

const weekdayIndexes: Record<string, number> = {
  dimanche: 0,
  sunday: 0,
  lundi: 1,
  monday: 1,
  mardi: 2,
  tuesday: 2,
  mercredi: 3,
  wednesday: 3,
  jeudi: 4,
  thursday: 4,
  vendredi: 5,
  friday: 5,
  samedi: 6,
  saturday: 6,
};

export function normalizeWhitespace(value: string) {
  return value.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

export function normalizeLine(value: string) {
  return normalizeWhitespace(value).replace(/\u00a0/g, " ");
}

export function cleanEmailSubject(subject: string) {
  return normalizeWhitespace(subject)
    .replace(/^(?:(?:RE|FW|FWD|TR)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .replace(/[|]+/g, " | ")
    .replace(/\s*-\s*$/, "")
    .trim();
}

const DISCLAIMER_TRUNCATE = [
  /^NOTICE:/im,
  /^This e-mail transmission/im,
  /^If you are not the intended recipient/im,
  /^STRICTLY PROHIBITED/im,
];

export function cleanEmailText(rawText: string): string {
  let text = rawText
    .replace(/\r/g, "")
    .replace(/\[cid:[^\]]+\]/gi, " ")
    .replace(/cid:image[^\s]+/gi, " ")
    .replace(/Photo du contact.*$/gim, " ")
    .replace(/Résumé En-têtes HTML.*$/gim, " ")
    .replace(/Résumé En-têtes Texte en clair.*$/gim, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/_{5,}/g, "\n")
    .replace(/-{5,}/g, "\n")
    .replace(/Confidentiality notice[\s\S]*$/i, " ")
    .replace(/Ce message et ses éventuelles pièces jointes[\s\S]*$/i, " ")
    .replace(/This e-mail and any attachments[\s\S]*$/i, " ")
    .replace(/Please consider the environment before printing[\s\S]*$/i, " ");

  // Truncate at disclaimer/legal block start
  for (const pattern of DISCLAIMER_TRUNCATE) {
    const match = pattern.exec(text);
    if (match?.index !== undefined) {
      text = text.slice(0, match.index);
    }
  }

  // Remove technical Outlook relay addresses
  text = text.replace(/\S+@\S*(?:AM0PR|VI0PR|EURPRD|PROD\.OUTLOOK\.COM)\S*/gi, " ");

  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => normalizeLine(line))
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

export function splitLines(value: string) {
  return cleanEmailText(value)
    .split("\n")
    .map((line) => normalizeLine(line))
    .filter(Boolean);
}

export function extractBusinessReference(
  text: string,
  client?: string | null,
): string | null {
  const cleanedText = cleanEmailText(text);
  const upperClient = client?.toUpperCase() ?? null;

  if (/FRUYTIER/i.test(upperClient ?? "") || /FRUYTIER/i.test(cleanedText)) {
    const fruytierRef = cleanedText.match(/\b([A-Z]{3}-FR\d{2}-\d{6}-\d+)\b/i)?.[1];
    return fruytierRef ?? null;
  }

  if (/HYDRO/i.test(upperClient ?? "") || /HYDRO/i.test(cleanedText)) {
    const hydroShortRef = cleanedText.match(/\b([A-Z]{2}\s?\d{2}\s?[A-Z]{2})\b/i)?.[1];
    return hydroShortRef ? hydroShortRef.replace(/\s+/g, "").toUpperCase() : null;
  }

  const genericRef =
    cleanedText.match(/\b([A-Z]{3}-FR\d{2}-\d{6}-\d+)\b/i)?.[1] ??
    cleanedText.match(/\b([A-Z]{2}\s?\d{2}\s?[A-Z]{2})\b/i)?.[1] ??
    cleanedText.match(/\br[ée]f(?:[ée]rence)?(?: client)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{4,})/i)?.[1] ??
    cleanedText.match(/\b([A-Z]{2,}-[A-Z0-9]{2,}-\d{4,}[-A-Z0-9]*)\b/)?.[1];

  if (!genericRef) {
    return null;
  }

  const normalizedRef = genericRef.replace(/\s+/g, "").trim();
  return isReferenceNoise(normalizedRef) ? null : normalizedRef;
}

export function buildStableFallbackReference(input: {
  subject: string;
  clientName?: string | null;
  receivedAt?: string | null;
}) {
  const cleanedSubject = cleanEmailSubject(input.subject);

  if (!cleanedSubject || isReferenceNoise(cleanedSubject)) {
    return null;
  }

  const subjectDate =
    extractDateFromSubject(cleanedSubject, input.receivedAt ? new Date(input.receivedAt).getFullYear() : undefined)
      ?.slice(0, 10) ??
    input.receivedAt?.slice(0, 10) ??
    null;
  const subjectWithoutDate = cleanedSubject
    .replace(/\b\d{2}[./-]\d{2}(?:[./-]\d{4})?\b/g, " ")
    .replace(/\btomorrow\b/gi, " ")
    .replace(/\bdemain\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const clientPrefix =
    input.clientName && !/^\s*(client email|expéditeur inconnu)\s*$/i.test(input.clientName)
      ? slugify(input.clientName).slice(0, 24)
      : null;
  const subjectSlug = slugify(subjectWithoutDate || cleanedSubject).slice(0, 60);

  if (!subjectSlug) {
    return null;
  }

  const parts = [clientPrefix, subjectSlug, subjectDate].filter(
    (value): value is string => Boolean(value),
  );
  const stableReference = parts.join("-");
  return isReferenceNoise(stableReference) ? null : stableReference;
}

/** Extracts only explicitly labelled delivery-note references. */
export function extractDeliveryNoteNumber(value: string) {
  const patterns = [
    /(?:bon\s+de\s+livraison|delivery\s+note(?:\s+number)?|lieferscheinnummer|lieferschein|documento\s+di\s+trasporto|\bDDT)\s*(?:n[o°.]*)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{2,})/i,
    /(?:^|\n)\s*BL\s*(?:n[o°.]*)?\s*[:#-]\s*([A-Z0-9][A-Z0-9./_-]{2,})/im,
  ]
  for (const pattern of patterns) {
    const match = value.match(pattern)?.[1]?.trim()
    if (match) return match
  }
  return undefined
}

export function buildStableMailReference(
  email: Pick<NormalizedMailMessage, "messageId" | "sourceEmailId" | "receivedAt">,
  index = 0,
) {
  const datePart = email.receivedAt.slice(0, 10).replace(/-/g, "") || "00000000";
  const stableSource = email.messageId?.trim() || email.sourceEmailId.trim();
  let hash = 0x811c9dc5;
  for (let characterIndex = 0; characterIndex < stableSource.length; characterIndex += 1) {
    hash ^= stableSource.charCodeAt(characterIndex);
    hash = Math.imul(hash, 0x01000193);
  }
  const shortHash = (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();

  return `MAIL-${datePart}-${shortHash}-${index + 1}`;
}

export function resolvePreviewReference(input: {
  businessReference?: string | null;
  generatedStableReference?: string | null;
  subject: string;
  clientName?: string | null;
  receivedAt?: string | null;
}) {
  const businessReference = input.businessReference?.trim() ?? null;
  if (businessReference && !isReferenceNoise(businessReference)) {
    return { reference: businessReference, source: "business" as const };
  }

  const generatedStableReference = input.generatedStableReference?.trim() ?? null;
  if (generatedStableReference && !isReferenceNoise(generatedStableReference)) {
    return { reference: generatedStableReference, source: "generated" as const };
  }

  const subjectFallback = buildStableFallbackReference({
    subject: input.subject,
    clientName: input.clientName,
    receivedAt: input.receivedAt,
  });
  if (subjectFallback && !isReferenceNoise(subjectFallback)) {
    return { reference: subjectFallback, source: "subject" as const };
  }

  return null;
}

export function getEmailDomain(email: string | null | undefined) {
  if (!email || !email.includes("@")) {
    return null;
  }

  return email.split("@").pop()?.trim().toLowerCase() ?? null;
}

export function getProfileParserDomains(profile: ClientProfile) {
  const parserHintDomains = getStringArray(profile.parserHints?.emailDomains);
  return normalizeEmailDomains([...profile.emailDomains, ...parserHintDomains]);
}

function getProfileRecognizedAddresses(profile: ClientProfile) {
  const contacts = profile.defaultContacts ?? {};
  const billing = profile.billingInfo ?? {};

  return normalizeEmailAddresses([
    ...profile.contactEmails,
    ...getStringArray(profile.parserHints?.recognizedEmailAddresses),
    contacts.pickupEmail ?? "",
    contacts.deliveryEmail ?? "",
    contacts.clientEmail ?? "",
    billing.billingEmail ?? "",
    billing.invoiceEmail ?? "",
  ]);
}

export function findMatchingClientProfileForEmail(
  email: NormalizedMailMessage,
  clientProfiles: ClientProfile[],
) {
  const bodyText = cleanEmailText(email.bodyText || email.bodyPreview || "");
  const subjectAndBody = `${email.subject}\n${bodyText}`.toLowerCase();
  const envelopeAddresses = normalizeEmailAddresses([
    email.fromAddress ?? "",
    ...(email.toAddresses ?? []),
    ...(email.ccAddresses ?? []),
  ]);
  const envelopeDomains = new Set(
    envelopeAddresses
      .map((address) => getEmailDomain(address))
      .filter((domain): domain is string => Boolean(domain)),
  );
  const normalizedFromName = email.fromName?.trim().toLowerCase() ?? "";

  const matches = clientProfiles.map((profile, order) => {
    const recognizedAddresses = getProfileRecognizedAddresses(profile);
    const parserDomains = getProfileParserDomains(profile);
    const aliases = [
      profile.name,
      profile.legalName,
      profile.displayName,
      ...getStringArray(profile.parserHints?.clientAliases),
    ]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    let score = 0;
    if (recognizedAddresses.some((address) => envelopeAddresses.includes(address))) {
      score = Math.max(score, 400);
    }
    if (parserDomains.some((domain) => envelopeDomains.has(domain))) {
      score = Math.max(score, 300);
    }
    if (aliases.some((alias) => normalizedFromName.includes(alias))) {
      score = Math.max(score, 200);
    }
    if (aliases.some((alias) => subjectAndBody.includes(alias))) {
      score = Math.max(score, 100);
    }

    return { profile, score, order };
  });

  return (
    matches
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || left.order - right.order)[0]
      ?.profile ?? null
  );
}

export function parseAmount(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const cleanedValue = value
    .replace(/[€$]/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (!cleanedValue) {
    return undefined;
  }

  let normalizedValue = cleanedValue;

  if (cleanedValue.includes(",") && cleanedValue.includes(".")) {
    if (cleanedValue.lastIndexOf(".") > cleanedValue.lastIndexOf(",")) {
      normalizedValue = cleanedValue.replace(/,/g, "");
    } else {
      normalizedValue = cleanedValue.replace(/\./g, "").replace(",", ".");
    }
  } else if (cleanedValue.includes(",")) {
    normalizedValue = cleanedValue.replace(",", ".");
  }

  const parsedValue = Number.parseFloat(normalizedValue);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

export function parsePercentage(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const parsedValue = Number.parseFloat(value.replace(",", ".").replace("%", "").trim());
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

export function isValidCoordinatePair(lat?: number, lng?: number) {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return false;
  }

  if (lat === 0 && lng === 0) {
    return false;
  }

  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function parseCoordinates(value: string | null | undefined) {
  if (!value) {
    return {
      lat: undefined,
      lng: undefined,
    };
  }

  const match = value.match(
    /(-?\d{1,3}(?:[.,]\d+)?)\s*,\s*(-?\d{1,3}(?:[.,]\d+)?)/,
  );

  if (!match?.[1] || !match?.[2]) {
    return {
      lat: undefined,
      lng: undefined,
    };
  }

  const lat = Number.parseFloat(match[1].replace(",", "."));
  const lng = Number.parseFloat(match[2].replace(",", "."));

  return isValidCoordinatePair(lat, lng)
    ? { lat, lng }
    : { lat: undefined, lng: undefined };
}

export function parseFullDate(
  value: string | null | undefined,
  fallbackYear?: number,
) {
  if (!value) {
    return undefined;
  }

  const match =
    value.match(/(\d{2})[./-](\d{2})[./-](\d{4})(?:\s+(\d{1,2})[:h](\d{2})(?::(\d{2}))?)?/) ??
    value.match(/(\d{2})[./-](\d{2})(?:\s+(\d{1,2})[:h](\d{2})(?::(\d{2}))?)?/);

  if (!match) {
    return undefined;
  }

  const day = match[1];
  const month = match[2];
  const hasExplicitYear = match[3] && match[3].length === 4;
  const year = hasExplicitYear ? match[3] : String(fallbackYear ?? new Date().getFullYear());
  const timeOffset = hasExplicitYear ? 4 : 3;
  const hour = match[timeOffset] ?? "08";
  const minute = match[timeOffset + 1] ?? "00";
  const second = match[timeOffset + 2] ?? "00";

  const isoValue = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}`;
  const date = new Date(isoValue);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function findFirstDate(value: string, fallbackYear?: number) {
  const match = value.match(/\d{2}[./-]\d{2}(?:[./-]\d{4})?(?:\s+\d{1,2}[:h]\d{2}(?::\d{2})?)?/);
  return parseFullDate(match?.[0], fallbackYear);
}

export function extractDateFromSubject(subject: string, fallbackYear?: number) {
  return findFirstDate(subject, fallbackYear);
}

export function getYearFromIsoDate(value: string | undefined, fallbackDate: string) {
  if (value) {
    return new Date(value).getFullYear();
  }

  return new Date(fallbackDate).getFullYear();
}

export function extractCityFromAddressBlock(block: string) {
  const lines = splitLines(block);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const postalMatch = line.match(/\b(?:[A-Z]-|F-|B-)?\d{4,5}\s+(.+)$/i);

    if (postalMatch?.[1]) {
      return normalizeLine(postalMatch[1]).replace(/\s+CEDEX$/i, "").trim();
    }
  }

  const lastLine = lines.at(-1);
  return lastLine ?? undefined;
}

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

export function uniqueStrings(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  );
}

export function appendUniqueNotes(
  existingNotes: string | undefined,
  additions: Array<string | undefined | null>,
) {
  const noteLines = uniqueStrings([existingNotes, ...additions]);
  return noteLines.length > 0 ? noteLines.join("\n\n") : undefined;
}

export function buildPreviewId(base: string, index?: number) {
  return typeof index === "number" ? `${base}#${index + 1}` : base;
}

export function createPreviewBase(
  email: NormalizedMailMessage,
  sourceEmailId: string,
  partial: Partial<MissionImportPreview>,
): MissionImportPreview {
  const cleanedSubject = cleanEmailSubject(email.subject);
  return {
    id: sourceEmailId,
    source: "imap",
    provider: "imap",
    sourceEmailId,
    previewKey: partial.previewKey ?? sourceEmailId,
    messageId: email.messageId,
    sourceEmailFrom:
      email.fromAddress || email.fromName || "Expéditeur inconnu",
    sourceEmailFromName: email.fromName ?? null,
    sourceEmailFromAddress: email.fromAddress ?? null,
    sourceEmailToAddresses: email.toAddresses ?? [],
    sourceEmailCcAddresses: email.ccAddresses ?? [],
    sourceEmailSubject: email.subject,
    sourceEmailBodyPreview: email.bodyPreview,
    sourceEmailCleanedBodyText: cleanEmailText(email.bodyText || email.bodyPreview || ""),
    sourceEmailRawBodyText: email.rawBodyText ?? email.bodyText,
    sourceEmailRawBodyHtml: email.rawBodyHtml ?? email.bodyHtml ?? null,
    cleanedSubject,
    receivedAt: email.receivedAt,
    confidence: 0.45,
    parserId: partial.parserId ?? "unknown",
    reference: partial.reference ?? cleanedSubject ?? "Mission à qualifier",
    clientName: partial.clientName ?? "Client email",
    pickupCity: partial.pickupCity ?? "À confirmer",
    deliveryCity: partial.deliveryCity ?? "À confirmer",
    ...partial,
  };
}

export function applyClientProfileDefaults(
  preview: MissionImportPreview,
  profile: ClientProfile | null,
) {
  if (!profile) {
    return preview;
  }

  const requirements = {
    ...(profile.defaultRequirements ?? {}),
    ...(preview.requirements ?? {}),
  };
  const contacts = {
    ...(profile.defaultContacts ?? {}),
    ...(preview.contacts ?? {}),
  };
  const billingInfo = {
    ...(profile.billingInfo ?? {}),
    ...(preview.billingInfo ?? {}),
  };

  return {
    ...preview,
    clientName: preview.clientName || profile.displayName || profile.name,
    requiredTruckType: preview.requiredTruckType ?? profile.defaultTruckType ?? undefined,
    requiredTrailerType:
      preview.requiredTrailerType ?? profile.defaultTrailerType ?? undefined,
    paymentTerms: preview.paymentTerms ?? profile.defaultPaymentTerms ?? undefined,
    preAnnouncementRequired:
      typeof preview.preAnnouncementRequired === "boolean"
        ? preview.preAnnouncementRequired
        : profile.defaultPreAnnouncementRequired,
    requirements: Object.keys(requirements).length > 0 ? requirements : undefined,
    contacts: Object.keys(contacts).length > 0 ? contacts : undefined,
    billingInfo:
      Object.keys(billingInfo).length > 0 ? billingInfo : undefined,
    notes:
      preview.notes && preview.notes.trim().length > 0
        ? preview.notes
        : profile.operationalNotes ?? undefined,
  };
}

export function computeConfidence(preview: MissionImportPreview) {
  let score = 0.35;

  if (preview.clientReference) score += 0.16;
  if (preview.pickupDate) score += 0.08;
  if (preview.deliveryDate) score += 0.08;
  if (preview.pickupAddress) score += 0.1;
  if (preview.deliveryAddress) score += 0.1;
  if (preview.requiredTruckType) score += 0.06;
  if (typeof preview.priceAmount === "number") score += 0.08;
  if (preview.preAnnouncementRequired) score += 0.04;
  if ((preview.missingFields?.length ?? 0) > 0) {
    score -= Math.min(0.18, (preview.missingFields?.length ?? 0) * 0.04);
  }

  return Math.max(0.1, Math.min(0.98, Number(score.toFixed(2))));
}

export function addMissingField(
  preview: MissionImportPreview,
  field: string,
  optional = false,
) {
  if (optional) {
    const nextValues = new Set(preview.optionalMissingFields ?? []);
    nextValues.add(field);
    preview.optionalMissingFields = Array.from(nextValues);
    return;
  }

  const nextValues = new Set(preview.missingFields ?? []);
  nextValues.add(field);
  preview.missingFields = Array.from(nextValues);
}

export function inferPickupDateFromDelivery(
  deliveryDateIso: string | undefined,
  pickupWeekday: string | undefined,
  deliveryWeekday: string | undefined,
) {
  if (!deliveryDateIso || !pickupWeekday || !deliveryWeekday) {
    return undefined;
  }

  const pickupIndex = weekdayIndexes[pickupWeekday.toLowerCase()];
  const deliveryIndex = weekdayIndexes[deliveryWeekday.toLowerCase()];

  if (typeof pickupIndex !== "number" || typeof deliveryIndex !== "number") {
    return undefined;
  }

  const deliveryDate = new Date(deliveryDateIso);
  const delta = deliveryIndex - pickupIndex;
  const offsetDays = delta >= 0 ? delta : delta + 7;
  deliveryDate.setDate(deliveryDate.getDate() - offsetDays);
  return deliveryDate.toISOString();
}

export function findRdvLink(value: string) {
  return value.match(/https?:\/\/[^\s)]+/i)?.[0];
}

export function safeReferenceFragment(value: string | undefined, fallback: string) {
  return slugify(value ?? fallback) || fallback;
}
