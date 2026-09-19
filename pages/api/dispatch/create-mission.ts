import {
  MissionEventType,
  MissionPreparationStatus,
  MissionStatus,
  Prisma,
} from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";

import { prisma } from "../../../lib/prisma";
import { prepareMission } from "../../../lib/dispatch/mission-preparation/service";
import {
  hasValidMissionTrailerRequirements,
  normalizeMissionTrailerRequirements,
} from "../../../lib/dispatch/mission-trailer-requirements";
import { validateAndNormalizeMissionPayload } from "../../../lib/dispatch/mission-form-validation";
import {
  hasMissionSourceEmailPayload,
  upsertMissionSourceEmail,
} from "../../../lib/mail/mission-source-email";
import type { MissionSourceEmailPayload } from "../../../lib/mail/types";
import {
  collectImportMissionWarnings,
  mergeRequiredTrailerType,
  normalizeMissionReference,
  suggestAvailableReference,
} from "../../../lib/mail/editable-import";
import { buildStableMailReference } from "../../../lib/mail/parser-utils";

type CreateMissionBody = {
  reference: string;
  title?: string;
  clientName?: string;
  pickupCity?: string;
  deliveryCity?: string;
  pickupAddress?: string;
  deliveryAddress?: string;
  pickupPlaceId?: string;
  deliveryPlaceId?: string;
  pickupLat?: number;
  pickupLng?: number;
  deliveryLat?: number;
  deliveryLng?: number;
  estimatedKm?: number;
  clientReference?: string;
  cmrNumber?: string;
  deliveryNoteNumber?: string;
  pickupDate?: Date;
  deliveryDate?: Date;
  requiredTruckType?: string | null;
  requiredTrailerType?: string;
  priceAmount?: number;
  priceCurrency?: string;
  paymentTerms?: string;
  preAnnouncementRequired?: boolean;
  preAnnouncementSent?: boolean;
  preAnnouncementSentAt?: Date;
  requirements?: Prisma.InputJsonValue;
  contacts?: Prisma.InputJsonValue;
  billingInfo?: Prisma.InputJsonValue;
  status?: MissionStatus;
  routeDistanceMeters?: number;
  routeDurationSeconds?: number;
  sourceEmailId?: string;
  sourceEmailFrom?: string;
  sourceEmailSubject?: string;
  sourceEmail?: MissionSourceEmailPayload;
  importMetadata?: {
    parserId?: string;
    parserChain?: string[];
    editedFields?: Record<string, unknown>;
  };
  notes?: string;
};

class DemoRequestAlreadyCreatedError extends Error {
  constructor(readonly missionId: string) {
    super("Cette demande a déjà été transformée en mission.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function getOptionalCoordinate(
  value: unknown,
  min: number,
  max: number,
): number | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value < min || value > max) {
    return null;
  }

  return value;
}

function getOptionalPositiveNumber(value: unknown): number | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

function getOptionalNonNegativeNumber(
  value: unknown,
): number | null | undefined {
  if (typeof value === "undefined") return undefined;
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null;
}

function getOptionalBoolean(value: unknown): boolean | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  return typeof value === "boolean" ? value : null;
}

function getOptionalDate(value: unknown): Date | null | undefined {
  const dateValue = getOptionalString(value);

  if (!dateValue) {
    return undefined;
  }

  const date = new Date(dateValue);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getOptionalJsonObject(
  value: unknown,
): Prisma.InputJsonObject | null | undefined {
  if (typeof value === "undefined" || value === null) {
    return undefined;
  }

  return isRecord(value) ? (value as Prisma.InputJsonObject) : null;
}

function getOptionalMissionStatus(value: unknown): MissionStatus | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim().toUpperCase();

  return Object.values(MissionStatus).includes(normalizedValue as MissionStatus)
    ? (normalizedValue as MissionStatus)
    : null;
}

function parseBody(body: unknown): CreateMissionBody | null {
  if (!isRecord(body)) {
    return null;
  }

  const reference = getOptionalString(body.reference);
  const clientName = getOptionalString(body.clientName);
  const pickupCity = getOptionalString(body.pickupCity);
  const deliveryCity = getOptionalString(body.deliveryCity);

  if (!reference) {
    return null;
  }

  const estimatedKm =
    typeof body.estimatedKm === "number" && Number.isFinite(body.estimatedKm)
      ? Math.max(0, Math.round(body.estimatedKm))
      : undefined;
  const pickupLat = getOptionalCoordinate(body.pickupLat, -90, 90);
  const pickupLng = getOptionalCoordinate(body.pickupLng, -180, 180);
  const deliveryLat = getOptionalCoordinate(body.deliveryLat, -90, 90);
  const deliveryLng = getOptionalCoordinate(body.deliveryLng, -180, 180);
  const priceAmount = getOptionalNonNegativeNumber(body.priceAmount);
  const routeDistanceMeters = getOptionalPositiveNumber(
    body.routeDistanceMeters,
  );
  const routeDurationSeconds = getOptionalPositiveNumber(
    body.routeDurationSeconds,
  );
  const pickupDate = getOptionalDate(body.pickupDate);
  const deliveryDate = getOptionalDate(body.deliveryDate);
  const preAnnouncementRequired = getOptionalBoolean(
    body.preAnnouncementRequired,
  );
  const preAnnouncementSent = getOptionalBoolean(body.preAnnouncementSent);
  const preAnnouncementSentAt = getOptionalDate(body.preAnnouncementSentAt);
  const requiredTrailerType = getOptionalString(body.requiredTrailerType);
  const rawRequirementsValue = getOptionalJsonObject(body.requirements);
  const rawRequirements =
    rawRequirementsValue && rawRequirementsValue !== null
      ? (mergeRequiredTrailerType(
          rawRequirementsValue as Record<string, unknown>,
          requiredTrailerType,
        ) as Prisma.InputJsonObject)
      : requiredTrailerType
        ? (mergeRequiredTrailerType(
            undefined,
            requiredTrailerType,
          ) as Prisma.InputJsonObject)
        : rawRequirementsValue;
  const normalizedRequirements =
    rawRequirements && rawRequirements !== null
      ? normalizeMissionTrailerRequirements(
          rawRequirements as Record<string, unknown>,
        )
      : null;
  const requirements =
    normalizedRequirements?.ok ? normalizedRequirements.value : rawRequirements;
  const contacts = getOptionalJsonObject(body.contacts);
  const billingInfo = getOptionalJsonObject(body.billingInfo);
  const status = getOptionalMissionStatus(body.status);

  if (
    pickupLat === null ||
    pickupLng === null ||
    deliveryLat === null ||
    deliveryLng === null ||
    priceAmount === null ||
    routeDistanceMeters === null ||
    routeDurationSeconds === null ||
    pickupDate === null ||
    deliveryDate === null ||
    preAnnouncementRequired === null ||
    preAnnouncementSent === null ||
    preAnnouncementSentAt === null ||
    requirements === null ||
    normalizedRequirements?.ok === false ||
    !hasValidMissionTrailerRequirements(
      requirements as Record<string, unknown> | undefined,
    ) ||
    contacts === null ||
    billingInfo === null ||
    status === null
  ) {
    return null;
  }

  const hasInvalidPickupCoordinates = pickupLat === 0 && pickupLng === 0;
  const hasInvalidDeliveryCoordinates = deliveryLat === 0 && deliveryLng === 0;

  return {
    reference,
    title: getOptionalString(body.title),
    clientName,
    pickupCity,
    deliveryCity,
    pickupAddress: getOptionalString(body.pickupAddress),
    deliveryAddress: getOptionalString(body.deliveryAddress),
    pickupPlaceId: getOptionalString(body.pickupPlaceId),
    deliveryPlaceId: getOptionalString(body.deliveryPlaceId),
    pickupLat: hasInvalidPickupCoordinates ? undefined : pickupLat,
    pickupLng: hasInvalidPickupCoordinates ? undefined : pickupLng,
    deliveryLat: hasInvalidDeliveryCoordinates ? undefined : deliveryLat,
    deliveryLng: hasInvalidDeliveryCoordinates ? undefined : deliveryLng,
    estimatedKm,
    clientReference: getOptionalString(body.clientReference),
    cmrNumber: getOptionalString(body.cmrNumber),
    deliveryNoteNumber: getOptionalString(body.deliveryNoteNumber),
    pickupDate,
    deliveryDate,
    requiredTruckType:
      body.requiredTruckType === null
        ? null
        : getOptionalString(body.requiredTruckType),
    requiredTrailerType,
    priceAmount,
    priceCurrency: getOptionalString(body.priceCurrency),
    paymentTerms: getOptionalString(body.paymentTerms),
    preAnnouncementRequired,
    preAnnouncementSent,
    preAnnouncementSentAt,
    requirements: requirements as Prisma.InputJsonValue | undefined,
    contacts,
    billingInfo,
    status,
    routeDistanceMeters:
      typeof routeDistanceMeters === "number"
        ? Math.round(routeDistanceMeters)
        : undefined,
    routeDurationSeconds:
      typeof routeDurationSeconds === "number"
        ? Math.round(routeDurationSeconds)
        : undefined,
    sourceEmailId: getOptionalString(body.sourceEmailId),
    sourceEmailFrom: getOptionalString(body.sourceEmailFrom),
    sourceEmailSubject: getOptionalString(body.sourceEmailSubject),
    sourceEmail: isRecord(body.sourceEmail)
      ? {
          source:
            getOptionalString(body.sourceEmail.source) ??
            "IMPORTED_EMAIL",
          provider: getOptionalString(body.sourceEmail.provider),
          sourceEmailId:
            getOptionalString(body.sourceEmail.sourceEmailId) ??
            getOptionalString(body.sourceEmailId) ??
            reference,
          messageId: getOptionalString(body.sourceEmail.messageId),
          previewKey: getOptionalString(body.sourceEmail.previewKey),
          subject:
            getOptionalString(body.sourceEmail.subject) ??
            getOptionalString(body.sourceEmailSubject),
          fromName: getOptionalString(body.sourceEmail.fromName),
          fromAddress:
            getOptionalString(body.sourceEmail.fromAddress) ??
            getOptionalString(body.sourceEmailFrom),
          toAddresses: Array.isArray(body.sourceEmail.toAddresses)
            ? body.sourceEmail.toAddresses.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          ccAddresses: Array.isArray(body.sourceEmail.ccAddresses)
            ? body.sourceEmail.ccAddresses.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          receivedAt: getOptionalString(body.sourceEmail.receivedAt),
          bodyPreview: getOptionalString(body.sourceEmail.bodyPreview),
          cleanedBodyText: getOptionalString(body.sourceEmail.cleanedBodyText),
          rawBodyText: getOptionalString(body.sourceEmail.rawBodyText),
          rawBodyHtml: getOptionalString(body.sourceEmail.rawBodyHtml),
        }
      : undefined,
    importMetadata: isRecord(body.importMetadata)
      ? {
          parserId: getOptionalString(body.importMetadata.parserId),
          parserChain: Array.isArray(body.importMetadata.parserChain)
            ? body.importMetadata.parserChain.filter(
                (value): value is string => typeof value === "string",
              )
            : undefined,
          editedFields: isRecord(body.importMetadata.editedFields)
            ? body.importMetadata.editedFields
            : undefined,
        }
      : undefined,
    notes: getOptionalString(body.notes),
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.missionsCreate))) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isRecord(req.body)) {
    return res.status(400).json({ error: "Le formulaire Mission est invalide." });
  }

  const isImportedMission =
    isRecord(req.body.sourceEmail) || isRecord(req.body.importMetadata);
  const sourceEmail = isRecord(req.body.sourceEmail) ? req.body.sourceEmail : null;
  const normalizedReference = normalizeMissionReference(req.body.reference);
  const sourceEmailId = sourceEmail
    ? getOptionalString(sourceEmail.sourceEmailId)
    : undefined;
  const isDemoRequest =
    isRecord(req.body.importMetadata) &&
    req.body.importMetadata.parserId === "gerard-demo" &&
    /^demo-mail-\d{2}$/.test(sourceEmailId ?? "");
  const sourceReceivedAt = sourceEmail
    ? getOptionalString(sourceEmail.receivedAt)
    : undefined;
  const fallbackReference = isImportedMission
    ? buildStableMailReference({
        sourceEmailId:
          sourceEmailId ??
          getOptionalString(req.body.sourceEmailId) ??
          getOptionalString(sourceEmail?.messageId) ??
          "mail-import-without-source",
        messageId: sourceEmail
          ? getOptionalString(sourceEmail.messageId)
          : undefined,
        receivedAt: sourceReceivedAt ?? "1970-01-01T00:00:00.000Z",
      })
    : "";
  const reference = normalizedReference || fallbackReference;

  if (!reference) {
    return res.status(400).json({
      code: "REFERENCE_REQUIRED",
      error: "La référence finale est obligatoire.",
    });
  }

  const warnings = isImportedMission
    ? collectImportMissionWarnings(req.body)
    : [];
  const validationInput = {
    ...req.body,
    reference,
    ...(isImportedMission
      ? {
          clientName: getOptionalString(req.body.clientName),
          pickupCity: getOptionalString(req.body.pickupCity),
          deliveryCity: getOptionalString(req.body.deliveryCity),
        }
      : {}),
  };
  const validation = validateAndNormalizeMissionPayload(validationInput);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
  const body = parseBody(validation.value);

  if (!body) {
    return res.status(400).json({
      error: "Un champ du formulaire Mission contient une valeur invalide.",
    });
  }

  try {
    if (isDemoRequest && sourceEmailId) {
      const existing = await prisma.mission.findFirst({
        where: { sourceEmailId },
        select: { id: true },
      });
      if (existing) {
        return res.status(409).json({
          code: "DEMO_REQUEST_ALREADY_CREATED",
          error: "Cette demande a déjà été transformée en mission.",
          existingMissionId: existing.id,
        });
      }
    }
    const requestedReference = body.reference;
    const similarReferences = await prisma.mission.findMany({
      where: { reference: { startsWith: requestedReference } },
      select: { reference: true },
    });
    const resolvedReference = suggestAvailableReference(
      requestedReference,
      new Set(similarReferences.map((mission) => mission.reference)),
    );
    if (resolvedReference !== requestedReference && isDemoRequest) {
      return res.status(409).json({
        code: "DEMO_REQUEST_ALREADY_CREATED",
        error: "Cette demande a déjà été transformée en mission.",
      });
    }
    if (resolvedReference !== requestedReference) {
      body.reference = resolvedReference;
      body.clientReference = body.clientReference ?? requestedReference;
      warnings.push(
        `Référence déjà utilisée : créée sous ${resolvedReference}.`,
      );
    }
    const existingReference = await prisma.mission.findUnique({
      where: { reference: body.reference },
      select: { id: true },
    });
    if (existingReference) {
      const similarReferences = await prisma.mission.findMany({
        where: { reference: { startsWith: body.reference } },
        select: { reference: true },
      });
      return res.status(409).json({
        code: "REFERENCE_ALREADY_USED",
        error: "Cette référence est déjà utilisée.",
        existingMissionId: existingReference.id,
        suggestion: suggestAvailableReference(
          body.reference,
          new Set(similarReferences.map((mission) => mission.reference)),
        ),
      });
    }

    const mission = await prisma.$transaction(async (tx) => {
      if (isDemoRequest && sourceEmailId) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${sourceEmailId}))`;
        const existing = await tx.mission.findFirst({
          where: { sourceEmailId },
          select: { id: true },
        });
        if (existing) throw new DemoRequestAlreadyCreatedError(existing.id);
      }
      const createdMission = await tx.mission.create({
        data: {
          reference: body.reference,
          title: body.title,
          clientName: body.clientName,
          pickupCity: body.pickupCity,
          deliveryCity: body.deliveryCity,
          pickupAddress: body.pickupAddress,
          deliveryAddress: body.deliveryAddress,
          pickupSourceAddress:
            body.pickupAddress ?? body.pickupCity,
          deliverySourceAddress:
            body.deliveryAddress ?? body.deliveryCity,
          pickupPlaceId: body.pickupPlaceId,
          deliveryPlaceId: body.deliveryPlaceId,
          pickupLat: body.pickupLat,
          pickupLng: body.pickupLng,
          deliveryLat: body.deliveryLat,
          deliveryLng: body.deliveryLng,
          estimatedKm: body.estimatedKm,
          clientReference: body.clientReference,
          cmrNumber: body.cmrNumber,
          deliveryNoteNumber: body.deliveryNoteNumber,
          pickupDate: body.pickupDate,
          deliveryDate: body.deliveryDate,
          requiredTruckType: body.requiredTruckType,
          priceAmount: body.priceAmount,
          priceCurrency: body.priceCurrency,
          paymentTerms: body.paymentTerms,
          preAnnouncementRequired: body.preAnnouncementRequired ?? false,
          preAnnouncementSent: body.preAnnouncementSent ?? false,
          preAnnouncementSentAt: body.preAnnouncementSentAt,
          requirements: body.requirements,
          contacts: body.contacts,
          billingInfo: body.billingInfo,
          routeDistanceMeters: body.routeDistanceMeters,
          routeDurationSeconds: body.routeDurationSeconds,
          sourceEmailId: body.sourceEmailId,
          sourceEmailFrom: body.sourceEmailFrom,
          sourceEmailSubject: body.sourceEmailSubject,
          notes: body.notes,
          status: body.status ?? MissionStatus.PENDING,
        },
      });

      await tx.missionEvent.create({
        data: {
          missionId: createdMission.id,
          type: MissionEventType.CREATED,
          message: "Mission created manually from dispatcher board.",
          toStatus: createdMission.status,
          metadata: JSON.parse(
            JSON.stringify({
              reference: createdMission.reference,
              source: isImportedMission ? "mail_import" : "manual_dispatch",
              ...(body.importMetadata ?? {}),
            }),
          ) as Prisma.InputJsonValue,
        },
      });

      if (hasMissionSourceEmailPayload(body.sourceEmail)) {
        await upsertMissionSourceEmail(tx, createdMission.id, body.sourceEmail!);
      }

      return createdMission;
    });

    let preparedMission = mission;
    try {
      preparedMission = await prepareMission(mission.id);
      if (
        isImportedMission &&
        preparedMission.preparationStatus !== MissionPreparationStatus.READY
      ) {
        preparedMission = await prisma.mission.update({
          where: { id: mission.id },
          data: {
            preparationStatus: MissionPreparationStatus.REVIEW_REQUIRED,
          },
        });
      }
    } catch (preparationError) {
      console.error("Mission saved but preparation failed", {
        missionId: mission.id,
        error:
          preparationError instanceof Error
            ? preparationError.message
            : "MISSION_PREPARATION_FAILED",
      });
      preparedMission = await prisma.mission.update({
        where: { id: mission.id },
        data: {
          preparationStatus: isImportedMission
            ? MissionPreparationStatus.REVIEW_REQUIRED
            : MissionPreparationStatus.FAILED,
        },
      });
    }

    return res.status(201).json({
      mission: preparedMission,
      displayLocation:
        preparedMission.preparationStatus === MissionPreparationStatus.REVIEW_REQUIRED
          ? "REVIEW"
          : "INCOMPLETE_POOL",
      warnings,
      preparationStatus: preparedMission.preparationStatus,
    });
  } catch (error) {
    if (error instanceof DemoRequestAlreadyCreatedError) {
      return res.status(409).json({
        code: "DEMO_REQUEST_ALREADY_CREATED",
        error: error.message,
        existingMissionId: error.missionId,
      });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existingMission = await prisma.mission.findUnique({
        where: { reference: body.reference },
        select: { id: true },
      });
      const similarReferences = await prisma.mission.findMany({
        where: { reference: { startsWith: body.reference } },
        select: { reference: true },
      });
      return res.status(409).json({
        code: "REFERENCE_ALREADY_USED",
        error: "Cette référence est déjà utilisée.",
        existingMissionId: existingMission?.id ?? null,
        suggestion: suggestAvailableReference(
          body.reference,
          new Set(similarReferences.map((mission) => mission.reference)),
        ),
      });
    }

    console.error("Failed to create mission", error);
    return res.status(500).json({ error: "Failed to create mission" });
  }
}
