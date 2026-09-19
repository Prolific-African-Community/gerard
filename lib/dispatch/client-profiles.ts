export type ClientProfileRequirements = {
  straps?: boolean;
  strapsRequired?: boolean;
  cornerProtectors?: boolean;
  cornerProtectorsRequired?: boolean;
  emptyTrailerRequired?: boolean;
  safetyVest?: boolean;
  safetyVestRequired?: boolean;
  tailLift?: boolean;
  coveredTruckRequired?: boolean;
  adr?: boolean;
  temperatureControlled?: boolean;
  appointmentRequired?: boolean;
  notes?: string;
};

export type ClientProfileContacts = {
  pickupContactName?: string;
  pickupPhone?: string;
  pickupEmail?: string;
  deliveryContactName?: string;
  deliveryPhone?: string;
  deliveryEmail?: string;
  clientContactName?: string;
  clientPhone?: string;
  clientEmail?: string;
};

export type ClientProfileBillingInfo = {
  billingCompanyName?: string;
  companyName?: string;
  billingAddress?: string;
  address?: string;
  billingEmail?: string;
  invoiceEmail?: string;
  billingInstructions?: string;
  instructions?: string;
};

export type ClientProfileParserHints = {
  emailDomains?: string[];
  recognizedEmailAddresses?: string[];
  clientAliases?: string[];
  knownReferencePrefixes?: string[];
  subjectPatterns?: string[];
  pickupKeywords?: string[];
  deliveryKeywords?: string[];
  parserType?: string;
  truckTypeMap?: Record<string, string>;
  priceLabels?: Record<string, string>;
  ignoreCoordinates?: string[];
  multiMissionEmail?: boolean;
  referencePatterns?: string[];
  formats?: string[];
  weekPattern?: string;
  detailedTripPattern?: string;
  tonnageLinePattern?: string;
  capacityLinePattern?: string;
  defaultPickupSites?: Record<string, unknown>;
  missingDeliveryAddressAllowed?: boolean;
};

export type ClientProfile = {
  id: string;
  name: string;
  legalName: string | null;
  displayName: string | null;
  emailDomains: string[];
  contactEmails: string[];
  contactPhones: string[];
  billingInfo: ClientProfileBillingInfo | null;
  defaultPaymentTerms: string | null;
  defaultTruckType: string | null;
  defaultTrailerType: string | null;
  defaultPreAnnouncementRequired: boolean;
  defaultRequirements: ClientProfileRequirements | null;
  defaultContacts: ClientProfileContacts | null;
  operationalNotes: string | null;
  parserHints: ClientProfileParserHints | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MissionProfileDefaults = {
  clientName?: string;
  paymentTerms?: string;
  requiredTruckType?: string;
  preAnnouncementRequired?: boolean;
  strapsRequired?: boolean;
  cornerProtectorsRequired?: boolean;
  emptyTrailerRequired?: boolean;
  safetyVestRequired?: boolean;
  coveredTruckRequired?: boolean;
  appointmentRequired?: boolean;
  loadingRequirementsText?: string;
  clientContactName?: string;
  clientPhone?: string;
  clientEmail?: string;
  billingCompanyName?: string;
  billingAddress?: string;
  billingEmail?: string;
  billingInstructions?: string;
  notes?: string;
};

type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getOptionalRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

export function getOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export function getOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function normalizeCommaSeparatedList(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeClientProfileName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeEmailDomains(value: string[]): string[] {
  return Array.from(
    new Set(
      value
        .map((item) => {
          const normalized = item.trim().toLowerCase().replace(/^@/, "");
          return normalizeEmailAddress(normalized)?.split("@")[1] ?? normalized;
        })
        .filter((item) => /^[^\s@]+\.[^\s@]+$/.test(item))
        .filter(Boolean),
    ),
  );
}

export function normalizeEmailAddress(value: string): string | null {
  const trimmedValue = value.trim().toLowerCase();
  const enclosedAddress = trimmedValue.match(/<([^<>]+)>/)?.[1];
  const candidate = (enclosedAddress ?? trimmedValue).replace(/^mailto:/, "").trim();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

export function normalizeEmailAddresses(value: string[]): string[] {
  return Array.from(
    new Set(
      value
        .map((item) => normalizeEmailAddress(item))
        .filter((item): item is string => Boolean(item)),
    ),
  );
}

export function getClientProfileDisplayName(profile: ClientProfile): string {
  return (
    profile.displayName ||
    profile.legalName ||
    profile.name
  );
}

export function findMatchingClientProfile(
  profiles: ClientProfile[],
  clientName?: string | null,
): ClientProfile | null {
  const normalizedClientName = clientName?.trim().toLowerCase();

  if (!normalizedClientName) {
    return null;
  }

  return (
    profiles.find((profile) => {
      return [profile.name, profile.displayName, profile.legalName]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.trim().toLowerCase() === normalizedClientName);
    }) ?? null
  );
}

export function buildMissionProfileDefaults(
  profile: ClientProfile,
): MissionProfileDefaults {
  const requirements = profile.defaultRequirements ?? {};
  const contacts = profile.defaultContacts ?? {};
  const billingInfo = profile.billingInfo ?? {};
  const operationalNote = getOptionalString(profile.operationalNotes);
  const billingInstructions =
    getOptionalString(billingInfo.billingInstructions) ??
    getOptionalString(billingInfo.instructions);

  return {
    clientName: getClientProfileDisplayName(profile),
    paymentTerms: getOptionalString(profile.defaultPaymentTerms) ?? undefined,
    // `requiredTruckType` reste le nom interne historique du formulaire.
    // La valeur provient désormais prioritairement du besoin remorque.
    requiredTruckType:
      getOptionalString(profile.defaultTrailerType) ??
      getOptionalString(profile.defaultTruckType) ??
      undefined,
    preAnnouncementRequired: profile.defaultPreAnnouncementRequired,
    strapsRequired:
      getOptionalBoolean(requirements.strapsRequired) ??
      getOptionalBoolean(requirements.straps) ??
      undefined,
    cornerProtectorsRequired:
      getOptionalBoolean(requirements.cornerProtectorsRequired) ??
      getOptionalBoolean(requirements.cornerProtectors) ??
      undefined,
    emptyTrailerRequired:
      getOptionalBoolean(requirements.emptyTrailerRequired) ?? undefined,
    safetyVestRequired:
      getOptionalBoolean(requirements.safetyVestRequired) ??
      getOptionalBoolean(requirements.safetyVest) ??
      undefined,
    coveredTruckRequired:
      getOptionalBoolean(requirements.coveredTruckRequired) ?? undefined,
    appointmentRequired:
      getOptionalBoolean(requirements.appointmentRequired) ?? undefined,
    loadingRequirementsText:
      getOptionalString(requirements.notes) ?? undefined,
    clientContactName:
      getOptionalString(contacts.clientContactName) ?? undefined,
    clientPhone: getOptionalString(contacts.clientPhone) ?? undefined,
    clientEmail: getOptionalString(contacts.clientEmail) ?? undefined,
    billingCompanyName:
      getOptionalString(billingInfo.billingCompanyName) ??
      getOptionalString(billingInfo.companyName) ??
      undefined,
    billingAddress:
      getOptionalString(billingInfo.billingAddress) ??
      getOptionalString(billingInfo.address) ??
      undefined,
    billingEmail:
      getOptionalString(billingInfo.billingEmail) ??
      getOptionalString(billingInfo.invoiceEmail) ??
      undefined,
    billingInstructions: billingInstructions ?? undefined,
    notes: operationalNote ?? undefined,
  };
}

export function normalizeClientProfile(
  profile: Record<string, unknown>,
): ClientProfile {
  return {
    id: String(profile.id),
    name: String(profile.name),
    legalName: getOptionalString(profile.legalName),
    displayName: getOptionalString(profile.displayName),
    emailDomains: getStringArray(profile.emailDomains),
    contactEmails: getStringArray(profile.contactEmails),
    contactPhones: getStringArray(profile.contactPhones),
    billingInfo: getOptionalRecord(profile.billingInfo) as ClientProfileBillingInfo | null,
    defaultPaymentTerms: getOptionalString(profile.defaultPaymentTerms),
    defaultTruckType: getOptionalString(profile.defaultTruckType),
    defaultTrailerType: getOptionalString(profile.defaultTrailerType),
    defaultPreAnnouncementRequired:
      typeof profile.defaultPreAnnouncementRequired === "boolean"
        ? profile.defaultPreAnnouncementRequired
        : false,
    defaultRequirements:
      getOptionalRecord(profile.defaultRequirements) as ClientProfileRequirements | null,
    defaultContacts:
      getOptionalRecord(profile.defaultContacts) as ClientProfileContacts | null,
    operationalNotes: getOptionalString(profile.operationalNotes),
    parserHints:
      getOptionalRecord(profile.parserHints) as ClientProfileParserHints | null,
    isActive: typeof profile.isActive === "boolean" ? profile.isActive : true,
    createdAt:
      typeof profile.createdAt === "string"
        ? profile.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof profile.updatedAt === "string"
        ? profile.updatedAt
        : new Date().toISOString(),
  };
}
