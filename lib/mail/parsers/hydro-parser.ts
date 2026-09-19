import type { ClientProfile } from "../../dispatch/client-profiles";
import {
  addMissingField,
  appendUniqueNotes,
  applyClientProfileDefaults,
  buildPreviewId,
  cleanEmailText,
  computeConfidence,
  createPreviewBase,
  extractCityFromAddressBlock,
  extractDateFromSubject,
  getYearFromIsoDate,
  inferPickupDateFromDelivery,
  parseFullDate,
  safeReferenceFragment,
  splitLines,
} from "../parser-utils";
import type { MissionImportPreview, NormalizedMailMessage } from "../types";

function normalizeHydroReference(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function getISOWeekMonday(week: number, year: number): Date {
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // treat Sunday (0) as 7
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - (dayOfWeek - 1));
  const result = new Date(week1Monday);
  result.setDate(week1Monday.getDate() + (week - 1) * 7);
  return result;
}

function resolveWeekdayDate(weekday: string, weekMonday: Date): string {
  const offsets: Record<string, number> = {
    lundi: 0, monday: 0,
    mardi: 1, tuesday: 1,
    mercredi: 2, wednesday: 2,
    jeudi: 3, thursday: 3,
    vendredi: 4, friday: 4,
    samedi: 5, saturday: 5,
    dimanche: 6, sunday: 6,
  };
  const offset = offsets[weekday.toLowerCase()] ?? 0;
  const d = new Date(weekMonday);
  d.setDate(d.getDate() + offset);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

function extractWeekFromSubject(subject: string): { week: number; year: number } | null {
  const match = subject.match(/S\.?\s*([0-9]{1,2})(?:\s*[-.]\s*(20[0-9]{2}))?/i);
  if (!match?.[1]) return null;
  return {
    week: Number.parseInt(match[1], 10),
    year: match[2] ? Number.parseInt(match[2], 10) : new Date().getFullYear(),
  };
}

function getHydroPickupAddress(profile: ClientProfile | null) {
  const parserSites = profile?.parserHints?.defaultPickupSites as
    | Record<string, { name?: string; address?: string; city?: string }>
    | undefined;
  const clervaux = parserSites?.Clervaux;

  return (
    clervaux?.address ??
    "HYDRO Aluminium Clervaux S.A., 16, Op der Sang, Z.I. de Lentzweiler, L-9779 Eselborn, Clervaux, Luxembourg"
  );
}

function getHydroPickupCity() {
  return "Clervaux / Eselborn";
}

function createHydroPreview(
  email: NormalizedMailMessage,
  profile: ClientProfile | null,
  index: number,
  partial: Partial<MissionImportPreview>,
) {
  const preview = createPreviewBase(
    email,
    buildPreviewId(email.sourceEmailId, index),
    {
      clientName: "HYDRO",
      pickupCity: partial.pickupCity ?? getHydroPickupCity(),
      pickupAddress: partial.pickupAddress ?? getHydroPickupAddress(profile),
      deliveryCity: partial.deliveryCity ?? "À confirmer",
      ...partial,
    },
  );

  const finalizedPreview = applyClientProfileDefaults(preview, profile);
  finalizedPreview.confidence = computeConfidence(finalizedPreview);
  return finalizedPreview;
}

function parseDetailedTrips(
  email: NormalizedMailMessage,
  bodyText: string,
  profile: ClientProfile | null,
): MissionImportPreview[] {
  const lines = splitLines(bodyText);
  const results: MissionImportPreview[] = [];
  let currentPickupCity: string | undefined;
  let pendingDeliveryAddress: string[] = [];
  let deliveryNotes: string[] = [];
  let collectingDeliveryAddress = false;

  lines.forEach((line) => {
    const headerMatch = line.match(/^(.+?)\s*\((.+?)\)\s*:\s*$/);

    if (headerMatch?.[2]) {
      currentPickupCity = headerMatch[2].trim();
      pendingDeliveryAddress = [];
      deliveryNotes = [];
      collectingDeliveryAddress = false;
      return;
    }

    if (/^Adresse de livraison\s*:/i.test(line)) {
      pendingDeliveryAddress = [];
      collectingDeliveryAddress = true;
      return;
    }

    if (/horaires?/i.test(line) && collectingDeliveryAddress) {
      deliveryNotes.push(line);
      return;
    }

    if (
      collectingDeliveryAddress &&
      /^([A-Z]{2,}|\d|ZI\b|Avenue\b|Rue\b|BP\b)/i.test(line) &&
      !/camion/i.test(line) &&
      !/:$/.test(line)
    ) {
      pendingDeliveryAddress.push(line);
      return;
    }

    const tripMatch = line.match(
      /1 camion\s+([a-zéû]+)\s+pour livraison\s+([a-zéû]+)\s+(\d{2}[./]\d{2})(?:\s*[:-]\s*|:\s*)([A-Z]{2}\s?\d{2}\s?[A-Z]{2})/i,
    );

    if (!tripMatch) {
      return;
    }

    const deliveryDate = parseFullDate(
      tripMatch[3],
      new Date(email.receivedAt).getFullYear(),
    );
    const pickupDate = inferPickupDateFromDelivery(
      deliveryDate,
      tripMatch[1],
      tripMatch[2],
    );
    const clientReference = normalizeHydroReference(tripMatch[4]);
    const deliveryAddress =
      pendingDeliveryAddress.length > 0 ? pendingDeliveryAddress.join("\n") : undefined;
    const deliveryCity =
      (deliveryAddress ? extractCityFromAddressBlock(deliveryAddress) : undefined) ??
      (currentPickupCity && /ch[âa]teauroux/i.test(currentPickupCity)
        ? currentPickupCity
        : "À confirmer");
    const preview = createHydroPreview(email, profile, results.length, {
      reference: clientReference,
      referenceSource: "business",
      clientReference,
      title: `${email.subject} · ${clientReference}`,
      shortLabel: clientReference,
      pickupCity: currentPickupCity ?? getHydroPickupCity(),
      pickupDate,
      deliveryCity,
      deliveryAddress,
      deliveryDate,
      notes: appendUniqueNotes(undefined, [
        deliveryAddress ? "Adresse de livraison extraite du message." : "Adresse de livraison non précisée.",
        ...deliveryNotes,
      ]),
      missingFields: [],
      optionalMissingFields: [],
    });

    if (!preview.deliveryAddress) addMissingField(preview, "deliveryAddress");
    if (typeof preview.priceAmount !== "number") addMissingField(preview, "priceAmount");
    if (preview.deliveryCity === "À confirmer") {
      addMissingField(preview, "deliveryCity", true);
    }
    preview.confidence = Math.max(
      0.68,
      preview.deliveryAddress ? 0.8 : preview.confidence,
    );
    results.push(preview);
    pendingDeliveryAddress = [];
    deliveryNotes = [];
    collectingDeliveryAddress = false;
  });

  return results;
}

function parseWeeklyTonnage(
  email: NormalizedMailMessage,
  bodyText: string,
  profile: ClientProfile | null,
): MissionImportPreview[] {
  const subjectWeekMatch =
    email.subject.match(/S\.?\s*([0-9]{1,2})\s*-?\s*(20[0-9]{2})/i) ??
    bodyText.match(/S\.?\s*([0-9]{1,2})\s*-?\s*(20[0-9]{2})/i);

  if (!subjectWeekMatch?.[1] || !subjectWeekMatch?.[2]) {
    return [];
  }

  const week = subjectWeekMatch[1];
  const year = subjectWeekMatch[2];

  return splitLines(bodyText)
    .map((line) => line.match(/([0-9]+)\s*-?\s*t\s+(.+)/i))
    .filter((match): match is RegExpMatchArray => Boolean(match?.[1] && match?.[2]))
    .map((match, index) => {
      const tonnage = match[1];
      const destination = match[2].trim();
      const clientReference = `HYDRO-S${week}-${year}-${safeReferenceFragment(destination, "DEST")}-${tonnage}T`;
      const preview = createHydroPreview(email, profile, index, {
        reference: clientReference,
        referenceSource: "generated",
        clientReference,
        title: `HYDRO S${week} · ${destination} ${tonnage}T`,
        shortLabel: clientReference,
        deliveryCity: destination,
        requirements: {
          tonnage,
        },
        notes: `Mission prévisionnelle à compléter. Tonnage indiqué : ${tonnage} t.`,
        missingFields: [],
        optionalMissingFields: [],
      });

      addMissingField(preview, "pickupDate");
      addMissingField(preview, "deliveryAddress");
      addMissingField(preview, "priceAmount");
      addMissingField(preview, "deliveryDate");
      preview.confidence = Math.max(0.6, preview.confidence);
      return preview;
    });
}

function parseCapacityRequests(
  email: NormalizedMailMessage,
  bodyText: string,
  profile: ClientProfile | null,
): MissionImportPreview[] {
  const pickupDate = extractDateFromSubject(
    email.subject,
    new Date(email.receivedAt).getFullYear(),
  );

  return splitLines(bodyText).flatMap((line) => {
    const match = line.match(/([0-9]+)x\s+(.+)/i);

    if (!match?.[1] || !match?.[2]) {
      return [];
    }

    const count = Number.parseInt(match[1], 10);
    const destination = match[2].trim();

    if (!Number.isFinite(count) || count <= 0) {
      return [];
    }

    return Array.from({ length: count }, (_, itemIndex) => {
      const referenceDate =
        pickupDate?.slice(0, 10) ?? email.receivedAt.slice(0, 10);
      const clientReference = `HYDRO-${referenceDate}-${safeReferenceFragment(destination, "DEST")}-${String(
        itemIndex + 1,
      ).padStart(2, "0")}`;
      const preview = createHydroPreview(
        email,
        profile,
        itemIndex + count,
        {
          reference: clientReference,
          referenceSource: "generated",
          clientReference,
          title: `HYDRO ${referenceDate} · ${destination} ${String(
            itemIndex + 1,
          ).padStart(2, "0")}`,
          shortLabel: clientReference,
          pickupDate,
          deliveryCity: destination,
          notes:
            "Demande de capacité Hydro sans référence client explicite. Mission à compléter.",
          missingFields: [],
          optionalMissingFields: [],
        },
      );

      addMissingField(preview, "deliveryAddress");
      addMissingField(preview, "priceAmount");
      addMissingField(preview, "deliveryDate");
      addMissingField(preview, "officialClientReference");
      preview.confidence = Math.max(0.58, preview.confidence);
      return preview;
    });
  });
}

function parseShortFormat(
  email: NormalizedMailMessage,
  bodyText: string,
  profile: ClientProfile | null,
): MissionImportPreview[] {
  const lines = splitLines(bodyText);
  const results: MissionImportPreview[] = [];
  const weekInfo = extractWeekFromSubject(email.subject);
  const year = weekInfo?.year ?? new Date(email.receivedAt).getFullYear();
  const weekMonday = weekInfo ? getISOWeekMonday(weekInfo.week, year) : null;

  for (const line of lines) {
    // "1 camion lundi - PU 68 NO" (no "pour livraison")
    const match = line.match(
      /1 camion\s+([a-zéûà]+)\s*[-–]\s*([A-Z]{2}\s?\d{2}\s?[A-Z]{2})/i,
    );
    if (!match?.[1] || !match?.[2]) continue;

    const pickupWeekday = match[1].toLowerCase();
    const clientReference = normalizeHydroReference(match[2]);
    const pickupDate = weekMonday ? resolveWeekdayDate(pickupWeekday, weekMonday) : undefined;
    const weekLabel = weekInfo ? `S${weekInfo.week}` : "";
    const title = weekLabel
      ? `${email.subject.split(/\s+S\d/i)[0].trim()} ${weekLabel} · ${clientReference}`.trim()
      : `${email.subject} · ${clientReference}`;

    const preview = createHydroPreview(email, profile, results.length, {
      reference: clientReference,
      referenceSource: "business",
      clientReference,
      title,
      shortLabel: clientReference,
      pickupDate,
      deliveryCity: "À confirmer",
      notes: "Email Hydro à compléter : livraison/adresse/prix non précisés.",
      missingFields: [],
      optionalMissingFields: [],
    });

    addMissingField(preview, "deliveryDate");
    addMissingField(preview, "deliveryAddress");
    addMissingField(preview, "priceAmount");
    preview.confidence = 0.62;
    results.push(preview);
  }

  return results;
}

export function canParseHydroEmail(
  email: NormalizedMailMessage,
  profile: ClientProfile | null,
) {
  const bodyText = cleanEmailText(email.bodyText || email.bodyPreview || "");
  const combinedText = `${email.subject}\n${bodyText}`;

  const profileSignals = [
    profile?.parserHints?.parserType,
    ...(profile?.emailDomains ?? []),
    ...(profile?.contactEmails ?? []),
    profile?.name,
    profile?.legalName,
    profile?.displayName,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");

  if (/hydro/i.test(profileSignals)) {
    return true;
  }

  return (
    /hydro\.com/i.test(email.fromAddress ?? "") ||
    /HYDRO Aluminium Clervaux S\.A\./i.test(combinedText) ||
    /Chargements S/i.test(email.subject) ||
    /Possible to load/i.test(email.subject)
  );
}

export function parseHydroEmail(
  email: NormalizedMailMessage,
  profile: ClientProfile | null,
): MissionImportPreview[] {
  const bodyText = cleanEmailText(email.bodyText || email.bodyPreview || "");
  const detailedTrips = parseDetailedTrips(email, bodyText, profile);

  if (detailedTrips.length > 0) {
    return detailedTrips;
  }

  const capacityRequests = parseCapacityRequests(email, bodyText, profile);

  if (capacityRequests.length > 0) {
    return capacityRequests;
  }

  const weeklyTonnage = parseWeeklyTonnage(email, bodyText, profile);

  if (weeklyTonnage.length > 0) {
    return weeklyTonnage;
  }

  const shortFormat = parseShortFormat(email, bodyText, profile);

  if (shortFormat.length > 0) {
    return shortFormat;
  }

  return [];
}
