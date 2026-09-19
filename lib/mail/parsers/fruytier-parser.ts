import type { ClientProfile } from "../../dispatch/client-profiles";
import {
  addMissingField,
  appendUniqueNotes,
  applyClientProfileDefaults,
  buildPreviewId,
  cleanEmailText,
  computeConfidence,
  createPreviewBase,
  extractBusinessReference,
  extractCityFromAddressBlock,
  findRdvLink,
  getYearFromIsoDate,
  parseAmount,
  parseCoordinates,
  parseFullDate,
  parsePercentage,
  splitLines,
} from "../parser-utils";
import type { MissionImportPreview, NormalizedMailMessage } from "../types";

function extractClientReference(value: string) {
  const match =
    value.match(/Exp[ée]dition\s+([A-Z]{3}-[A-Z]{2}\d{2}-\d{6}-\d+)/i) ??
    value.match(/Num[ée]ro d['’]exp[ée]dition\s*:\s*([^\s,;]+)/i);

  return match?.[1]?.trim();
}

function extractSectionBetween(
  bodyText: string,
  startLabel: string,
  endLabel: string,
) {
  const startIndex = bodyText.indexOf(startLabel);

  if (startIndex === -1) {
    return "";
  }

  const afterStart = bodyText.slice(startIndex + startLabel.length);
  const endIndex = afterStart.indexOf(endLabel);
  return (endIndex === -1 ? afterStart : afterStart.slice(0, endIndex)).trim();
}

function extractPickupData(section: string, receivedAt: string) {
  const lines = splitLines(section);
  const pickupDate = parseFullDate(lines[0], new Date(receivedAt).getFullYear());
  const gpsLine = lines.find(
    (line) =>
      /coordonn[ée]es gps/i.test(line) ||
      /-?\d+(?:[.,]\d+)?\s*,\s*-?\d+(?:[.,]\d+)?/.test(line),
  );
  const phoneLine = lines.find((line) => /^(\+|00)\d/.test(line));
  const pickupContact = lines[1];
  const addressLines = lines.filter(
    (line, index) =>
      index > 0 &&
      line !== phoneLine &&
      line !== gpsLine &&
      !/coordonn[ée]es gps/i.test(line),
  );
  const pickupAddress = addressLines.join("\n").trim() || undefined;
  const pickupCity = pickupAddress
    ? extractCityFromAddressBlock(pickupAddress)
    : undefined;
  const coordinates = parseCoordinates(gpsLine);

  return {
    pickupDate,
    pickupAddress,
    pickupCity,
    pickupContact,
    pickupPhone: phoneLine,
    pickupLat: coordinates.lat,
    pickupLng: coordinates.lng,
  };
}

function extractDeliveryData(section: string, receivedAt: string) {
  const lines = splitLines(section);
  const headerLine = lines[0] ?? "";
  const dateMatch = headerLine.match(
    /(\d{2}[./-]\d{2}[./-]\d{4})(?:\s+RDV\s+(\d{2}:\d{2}:\d{2}))?/i,
  );
  const year = getYearFromIsoDate(undefined, receivedAt);
  const fallbackDateMatch = headerLine.match(/(\d{2}[./-]\d{2}[./-]\d{4})/);
  const deliveryDate = parseFullDate(
    dateMatch?.[1]
      ? `${dateMatch[1]} ${dateMatch[2] ?? "08:00:00"}`
      : fallbackDateMatch?.[1],
    year,
  );
  const phoneLine = lines.find((line) => /^(\+|00)\d/.test(line));
  const gpsLine = lines.find((line) => /-?\d+(?:[.,]\d+)?\s*,\s*-?\d+(?:[.,]\d+)?/.test(line));
  const deliveryContact = lines[1];
  const addressLines = lines.filter(
    (line, index) =>
      index > 0 &&
      line !== phoneLine &&
      line !== gpsLine &&
      !/coordonn[ée]es gps/i.test(line),
  );
  const deliveryAddress = addressLines.join("\n").trim() || undefined;
  const deliveryCity = deliveryAddress
    ? extractCityFromAddressBlock(deliveryAddress)
    : undefined;
  const coordinates = parseCoordinates(gpsLine);

  return {
    deliveryDate,
    deliveryAddress,
    deliveryCity,
    deliveryContact,
    deliveryPhone: phoneLine,
    deliveryLat: coordinates.lat,
    deliveryLng: coordinates.lng,
  };
}

function getTruckType(typeCode: string | undefined) {
  if (typeCode === "1OT") {
    return {
      requiredTruckType: "Plateau / open truck",
      requiredTrailerType: "Plateau",
    };
  }

  if (typeCode === "1CT") {
    return {
      requiredTruckType: "Bâché / covered truck",
      requiredTrailerType: "Bâchée",
    };
  }

  return {
    requiredTruckType: undefined,
    requiredTrailerType: undefined,
  };
}

export function canParseFruytierEmail(
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

  if (/fruytier/i.test(profileSignals)) {
    return true;
  }

  return (
    /fruytier\.com/i.test(email.fromAddress ?? "") ||
    /FRUYTIER S\.A\./i.test(email.subject) ||
    /Num[ée]ro d['’]exp[ée]dition/i.test(combinedText)
  );
}

const FRUYTIER_REF_PATTERN = /[A-Z]{3}-FR\d{2}-\d{6}-\d+/i;

export function parseFruytierEmail(
  email: NormalizedMailMessage,
  profile: ClientProfile | null,
): MissionImportPreview[] {
  const bodyText = cleanEmailText(email.bodyText || email.bodyPreview || "");

  const combinedRaw = `${email.subject}\n${bodyText}`;
  const clientReference =
    extractClientReference(email.subject) ??
    extractClientReference(bodyText) ??
    extractBusinessReference(combinedRaw) ??
    undefined;
  const pickupSection = extractSectionBetween(
    bodyText,
    "DATE DE CHARGEMENT:",
    "DATE DE DECHARGEMENT",
  );
  const deliverySection = extractSectionBetween(
    bodyText,
    "DATE DE DECHARGEMENT(S):",
    "Type de camion",
  );

  const pickup = extractPickupData(pickupSection, email.receivedAt);
  const delivery = extractDeliveryData(deliverySection, email.receivedAt);
  const truckTypeCode = bodyText.match(/Type de camion\s*:\s*(1OT|1CT)/i)?.[1]?.toUpperCase();
  const truckType = getTruckType(truckTypeCode);
  const basePrice = parseAmount(
    bodyText.match(/Prix initial\s*:\s*([0-9\s.,]+)/i)?.[1],
  );
  const fuelSurchargeAmount = parseAmount(
    bodyText.match(/Montant supplément carburant\s*:\s*([0-9\s.,]+)/i)?.[1],
  );
  const fuelSurchargeRate = parsePercentage(
    bodyText.match(/Montant supplément carburant\s*:\s*[0-9\s.,]+\s*\(([\d.,]+%?)\)/i)?.[1],
  );
  const totalPrice =
    parseAmount(
      bodyText.match(/Prix total à facturer\s*:\s*([0-9\s.,]+)/i)?.[1],
    ) ?? basePrice;
  const paymentTerms =
    bodyText.match(/Conditions de paiement\s*:\s*([^\n]+)/i)?.[1]?.trim() ??
    undefined;
  const rdvLink = findRdvLink(bodyText);

  const preview = createPreviewBase(email, buildPreviewId(email.sourceEmailId), {
    parserId: "fruytier",
    reference: clientReference ?? undefined,
    referenceSource: clientReference ? "business" : undefined,
    clientReference,
    clientName:
      profile?.displayName ??
      profile?.legalName ??
      profile?.name ??
      "FRUYTIER",
    title: pickup.pickupCity && delivery.deliveryCity
      ? `${pickup.pickupCity} -> ${delivery.deliveryCity}`
      : clientReference,
    shortLabel:
      clientReference && delivery.deliveryCity
        ? `${clientReference} · ${delivery.deliveryCity}`
        : clientReference,
    pickupCity: pickup.pickupCity ?? "À confirmer",
    pickupAddress: pickup.pickupAddress,
    pickupDate: pickup.pickupDate,
    pickupContact: pickup.pickupContact,
    pickupPhone: pickup.pickupPhone,
    pickupLat: pickup.pickupLat,
    pickupLng: pickup.pickupLng,
    deliveryCity: delivery.deliveryCity ?? "À confirmer",
    deliveryAddress: delivery.deliveryAddress,
    deliveryDate: delivery.deliveryDate,
    deliveryContact: delivery.deliveryContact,
    deliveryPhone: delivery.deliveryPhone,
    deliveryLat: delivery.deliveryLat,
    deliveryLng: delivery.deliveryLng,
    requiredTruckType: truckType.requiredTruckType,
    requiredTrailerType: truckType.requiredTrailerType,
    priceAmount: totalPrice,
    priceCurrency: totalPrice ? "EUR" : undefined,
    paymentTerms,
    preAnnouncementRequired: true,
    requirements: {
      straps: true,
      strapsRequired: true,
      cornerProtectors: true,
      cornerProtectorsRequired: true,
      emptyTrailerRequired: true,
      safetyVest: true,
      safetyVestRequired: true,
      appointmentRequired: true,
      truckPlateAnnouncementRequired: true,
      truckTypeCode,
      notes:
        "Plaques camion + numéro d’expédition à annoncer avant chargement. Coins de protection obligatoires. Sangles suffisantes. Remorque 100% vide. Veste sécurité obligatoire.",
      ...(rdvLink ? { appointmentLink: rdvLink } : {}),
    },
    contacts: {
      pickupContactName: pickup.pickupContact,
      pickupPhone: pickup.pickupPhone,
      deliveryContactName: delivery.deliveryContact,
      deliveryPhone: delivery.deliveryPhone,
      clientEmail: email.fromAddress ?? undefined,
    },
    billingInfo: {
      ...(profile?.billingInfo ?? {}),
      basePrice,
      fuelSurchargeAmount,
      fuelSurchargeRate,
      totalToInvoice: totalPrice,
      billingEmail: "FGLOGISTICS@FRUYTIER.COM",
      invoiceEmail: "FGLOGISTICS@FRUYTIER.COM",
    },
    notes: appendUniqueNotes(undefined, [
      /annulation|annul[ée]e?|cancel/i.test(combinedRaw)
        ? "Message Fruytier relatif à une annulation."
        : undefined,
      /modification|modifi[ée]e?|change/i.test(combinedRaw)
        ? "Message Fruytier relatif à une modification."
        : undefined,
      /cr[ée]neau|replanifi[ée]|contact/i.test(combinedRaw)
        ? "Demande opérationnelle Fruytier à qualifier."
        : undefined,
      rdvLink ? `RDV obligatoire · ${rdvLink}` : undefined,
      deliveryDateHasAppointment(delivery.deliveryDate)
        ? "Livraison sur rendez-vous."
        : undefined,
    ]),
    missingFields: [],
    optionalMissingFields: [],
  });

  if (!preview.clientReference || !FRUYTIER_REF_PATTERN.test(preview.clientReference)) {
    addMissingField(preview, "clientReference");
  }
  if (!preview.pickupDate) addMissingField(preview, "pickupDate");
  if (!preview.pickupAddress) addMissingField(preview, "pickupAddress");
  if (!preview.deliveryDate) addMissingField(preview, "deliveryDate");
  if (!preview.deliveryAddress) addMissingField(preview, "deliveryAddress");
  if (!preview.requiredTruckType) addMissingField(preview, "requiredTruckType");
  if (typeof preview.priceAmount !== "number") addMissingField(preview, "priceAmount");
  if (!preview.deliveryLat || !preview.deliveryLng) {
    addMissingField(preview, "deliveryCoordinates", true);
  }

  const finalizedPreview = applyClientProfileDefaults(preview, profile);
  finalizedPreview.confidence = computeConfidence(finalizedPreview);
  if (finalizedPreview.confidence < 0.9 && finalizedPreview.clientReference && finalizedPreview.pickupAddress && finalizedPreview.deliveryAddress && finalizedPreview.requiredTruckType && typeof finalizedPreview.priceAmount === "number") {
    finalizedPreview.confidence = 0.92;
  }

  return [finalizedPreview];
}

function deliveryDateHasAppointment(value: string | undefined) {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  return date.getHours() !== 8 || date.getMinutes() !== 0;
}
