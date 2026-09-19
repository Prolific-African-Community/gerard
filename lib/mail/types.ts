export type MailImportProvider = "imap";

export type MailImportSource = "imap";

export type NormalizedMailMessage = {
  sourceEmailId: string;
  messageId?: string | null;
  subject: string;
  fromName?: string | null;
  fromAddress?: string | null;
  toAddresses?: string[];
  ccAddresses?: string[];
  receivedAt: string;
  bodyText: string;
  bodyHtml?: string | null;
  rawBodyText?: string | null;
  rawBodyHtml?: string | null;
  bodyPreview: string;
};

export type MissionSourceEmailPayload = {
  source: string;
  provider?: string | null;
  sourceEmailId: string;
  messageId?: string | null;
  previewKey?: string | null;
  subject?: string | null;
  fromName?: string | null;
  fromAddress?: string | null;
  toAddresses?: string[];
  ccAddresses?: string[];
  receivedAt?: string | null;
  bodyPreview?: string | null;
  cleanedBodyText?: string | null;
  rawBodyText?: string | null;
  rawBodyHtml?: string | null;
};

export type ImportMissionCreationResult = {
  mission: {
    id: string;
    reference: string;
    preparationStatus?: string;
  };
  warnings: string[];
  preparationStatus: string;
};

/**
 * État réel d'un import dans le pipeline de traitement.
 *
 * NEW      : mail parsé, exploitable tel quel, aucune mission créée.
 * PENDING  : mail nécessitant une intervention (données manquantes, confiance
 *            faible, référence à vérifier, doublon probable) ou déjà retouché
 *            par l'utilisateur — aucune mission créée.
 * CREATED  : une Mission existe réellement, sans MissionAssignment.
 * ASSIGNED : la Mission possède réellement un MissionAssignment.
 *
 * CREATED et ASSIGNED sont toujours dérivés des tables Mission /
 * MissionAssignment : ce module ne stocke jamais d'état parallèle.
 */
export type ImportState = "NEW" | "PENDING" | "CREATED" | "ASSIGNED";

/** Raison lisible pour laquelle un import attend une intervention. */
export type ImportAttentionReason =
  | "missingFields"
  | "lowConfidence"
  | "referenceToVerify"
  | "possibleDuplicate"
  | "edited";

export type ImportAssignmentSummary = {
  driverName?: string | null;
  truckPlate?: string | null;
  trailerPlate?: string | null;
  scheduledDate?: string | null;
  day?: string | null;
};

export type MissionImportPreview = {
  id: string;
  source: MailImportSource;
  provider: string;
  sourceEmailId: string;
  previewKey?: string;
  messageId?: string | null;
  sourceEmailFrom: string;
  sourceEmailFromName?: string | null;
  sourceEmailFromAddress?: string | null;
  sourceEmailToAddresses?: string[];
  sourceEmailCcAddresses?: string[];
  sourceEmailSubject: string;
  sourceEmailBodyPreview?: string | null;
  sourceEmailCleanedBodyText?: string | null;
  sourceEmailRawBodyText?: string | null;
  sourceEmailRawBodyHtml?: string | null;
  receivedAt: string;
  confidence: number;
  parserId: string;
  parserChain?: string[];
  reference: string;
  referenceSource?: "business" | "generated" | "subject";
  title?: string;
  shortLabel?: string;
  cleanedSubject?: string;
  clientReference?: string;
  cmrNumber?: string;
  deliveryNoteNumber?: string;
  clientName: string;
  pickupDate?: string;
  deliveryDate?: string;
  pickupCity: string;
  deliveryCity: string;
  pickupAddress?: string;
  deliveryAddress?: string;
  pickupContact?: string;
  pickupPhone?: string;
  pickupEmail?: string;
  deliveryContact?: string;
  deliveryPhone?: string;
  deliveryEmail?: string;
  pickupLat?: number;
  pickupLng?: number;
  deliveryLat?: number;
  deliveryLng?: number;
  estimatedKm?: number;
  routeDistanceMeters?: number;
  routeDurationSeconds?: number;
  requiredTruckType?: string;
  requiredTrailerType?: string;
  priceAmount?: number;
  priceCurrency?: string;
  paymentTerms?: string;
  preAnnouncementRequired?: boolean;
  preAnnouncementSent?: boolean;
  preAnnouncementSentAt?: string;
  requirements?: Record<string, unknown>;
  contacts?: Record<string, unknown>;
  billingInfo?: Record<string, unknown>;
  notes?: string;
  missingFields?: string[];
  optionalMissingFields?: string[];
  alreadyCreated?: boolean;
  createdMissionId?: string;
  duplicateMatchReason?: "reference" | "clientReference" | "sourceEmailId";
  existingMissionStatus?: string;
  existingMissionReference?: string;
  existingMissionVisibility?: "PLANNING" | "POOL" | "REVIEW_REQUIRED" | "ARCHIVED";

  /** Calculé côté serveur à partir de Mission / MissionAssignment. */
  importState?: ImportState;
  /** Raisons d'attente, vides si l'import est directement exploitable. */
  attentionReasons?: ImportAttentionReason[];
  /** Mission réellement persistée (identique à createdMissionId). */
  missionId?: string | null;
  missionReference?: string | null;
  missionCreatedAt?: string | null;
  /** Affectation Planning réelle, null tant que la mission n'est pas assignée. */
  assignment?: ImportAssignmentSummary | null;
  /** Import mis de côté : masqué des quatre vues principales. */
  ignored?: boolean;
  ignoredAt?: string | null;
};

export type MailImportsResponse = {
  provider: MailImportProvider;
  connected: boolean;
  imports: MissionImportPreview[];
  error?: string;
};

export type MissionSourceEmailResponse = MissionSourceEmailPayload;
