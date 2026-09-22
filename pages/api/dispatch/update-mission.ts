import { withTenantApiRoute } from '../../../lib/auth/authorization'
import { MissionEventType, MissionStatus, Prisma } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";

import { prisma } from "../../../lib/prisma";
import { prepareMission } from "../../../lib/dispatch/mission-preparation/service";
import {
  hasValidMissionTrailerRequirements,
  normalizeMissionTrailerRequirements,
} from "../../../lib/dispatch/mission-trailer-requirements";
import { mergeJsonPatch } from "../../../lib/dispatch/form-normalization";
import { validateAndNormalizeMissionPayload } from "../../../lib/dispatch/mission-form-validation";

type UpdateMissionBody = {
  missionId: string;
  reference: string;
  title?: string;
  clientName: string;
  pickupCity: string;
  deliveryCity: string;
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
  notes?: string;
};

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

function parseBody(body: unknown): UpdateMissionBody | null {
  if (!isRecord(body)) {
    return null;
  }

  const missionId = getOptionalString(body.missionId);
  const reference = getOptionalString(body.reference);
  const clientName = getOptionalString(body.clientName);
  const pickupCity = getOptionalString(body.pickupCity);
  const deliveryCity = getOptionalString(body.deliveryCity);

  if (!missionId || !reference || !clientName || !pickupCity || !deliveryCity) {
    return null;
  }

  if (
    typeof body.estimatedKm !== "undefined" &&
    (typeof body.estimatedKm !== "number" ||
      !Number.isFinite(body.estimatedKm) ||
      body.estimatedKm < 0)
  ) {
    return null;
  }

  const pickupLat = getOptionalCoordinate(body.pickupLat, -90, 90);
  const pickupLng = getOptionalCoordinate(body.pickupLng, -180, 180);
  const deliveryLat = getOptionalCoordinate(body.deliveryLat, -90, 90);
  const deliveryLng = getOptionalCoordinate(body.deliveryLng, -180, 180);
  const priceAmount = getOptionalNonNegativeNumber(body.priceAmount);
  const pickupDate = getOptionalDate(body.pickupDate);
  const deliveryDate = getOptionalDate(body.deliveryDate);
  const preAnnouncementRequired = getOptionalBoolean(
    body.preAnnouncementRequired,
  );
  const preAnnouncementSent = getOptionalBoolean(body.preAnnouncementSent);
  const preAnnouncementSentAt = getOptionalDate(body.preAnnouncementSentAt);
  const requirements = getOptionalJsonObject(body.requirements);
  const contacts = getOptionalJsonObject(body.contacts);
  const billingInfo = getOptionalJsonObject(body.billingInfo);
  const status = getOptionalMissionStatus(body.status);

  if (
    pickupLat === null ||
    pickupLng === null ||
    deliveryLat === null ||
    deliveryLng === null ||
    priceAmount === null ||
    pickupDate === null ||
    deliveryDate === null ||
    preAnnouncementRequired === null ||
    preAnnouncementSent === null ||
    preAnnouncementSentAt === null ||
    requirements === null ||
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
    missionId,
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
    estimatedKm:
      typeof body.estimatedKm === "number"
        ? Math.round(body.estimatedKm)
        : undefined,
    clientReference: getOptionalString(body.clientReference),
    cmrNumber: getOptionalString(body.cmrNumber),
    deliveryNoteNumber: getOptionalString(body.deliveryNoteNumber),
    pickupDate,
    deliveryDate,
    requiredTruckType:
      body.requiredTruckType === null
        ? null
        : getOptionalString(body.requiredTruckType),
    priceAmount,
    priceCurrency: getOptionalString(body.priceCurrency),
    paymentTerms: getOptionalString(body.paymentTerms),
    preAnnouncementRequired,
    preAnnouncementSent,
    preAnnouncementSentAt,
    requirements,
    contacts,
    billingInfo,
    status,
    notes: getOptionalString(body.notes),
  };
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.missionsEdit))) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const forbiddenAssignmentFields = [
    "driverId",
    "truckId",
    "trailerId",
    "planningRowId",
    "day",
    "sortOrder",
  ];
  if (
    isRecord(req.body) &&
    forbiddenAssignmentFields.some((field) => field in req.body)
  ) {
    return res.status(403).json({
      error: "Les affectations opérationnelles doivent utiliser les APIs dédiées.",
    });
  }

  if (!isRecord(req.body)) {
    return res.status(400).json({ error: "Le formulaire Mission est invalide." });
  }
  const validation = validateAndNormalizeMissionPayload(req.body, {
    requireMissionId: true,
    allowPartialRequired: true,
  });
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
  const normalizedRequest = validation.value;
  const missionId = getOptionalString(normalizedRequest.missionId);
  if (!missionId) {
    return res.status(400).json({ error: "Mission id is required" });
  }

  try {
    const existingMission = await prisma.mission.findUnique({
      where: {
        id: missionId,
      },
    });

    if (!existingMission) {
      return res.status(404).json({ error: "Mission not found" });
    }

    let requirementsPatch: Record<string, unknown> | undefined;
    if (typeof normalizedRequest.requirements !== "undefined") {
      if (!isRecord(normalizedRequest.requirements)) {
        return res.status(400).json({ error: "Exigences remorque invalides." });
      }
      const normalized = normalizeMissionTrailerRequirements(
        normalizedRequest.requirements,
      );
      if (!normalized.ok) {
        return res.status(400).json({ error: normalized.error });
      }
      requirementsPatch = mergeJsonPatch(
        existingMission.requirements,
        normalized.value,
      );
    }
    const mergeOptionalObject = (
      value: unknown,
      existing: unknown,
      label: string,
    ) => {
      if (typeof value === "undefined") return undefined;
      if (!isRecord(value)) {
        throw new Error(`INVALID_JSON_PATCH:${label}`);
      }
      return mergeJsonPatch(existing, value);
    };
    let contactsPatch: Record<string, unknown> | undefined;
    let billingInfoPatch: Record<string, unknown> | undefined;
    try {
      contactsPatch = mergeOptionalObject(
        normalizedRequest.contacts,
        existingMission.contacts,
        "contacts",
      );
      billingInfoPatch = mergeOptionalObject(
        normalizedRequest.billingInfo,
        existingMission.billingInfo,
        "billingInfo",
      );
    } catch {
      return res.status(400).json({ error: "Données JSON invalides." });
    }

    // Le formulaire d'édition peut envoyer un vrai patch. Seuls les champs
    // structurellement obligatoires sont hydratés pour la validation ; tous les
    // autres champs absents restent `undefined` et ne sont donc jamais effacés.
    const hydratedPayload = {
      ...normalizedRequest,
      reference: normalizedRequest.reference ?? existingMission.reference,
      clientName: normalizedRequest.clientName ?? existingMission.clientName,
      pickupCity: normalizedRequest.pickupCity ?? existingMission.pickupCity,
      deliveryCity:
        normalizedRequest.deliveryCity ?? existingMission.deliveryCity,
      requirements: requirementsPatch,
      contacts: contactsPatch,
      billingInfo: billingInfoPatch,
    };
    const body = parseBody(hydratedPayload);
    if (!body) {
      return res.status(400).json({
        error: "Un champ du formulaire Mission contient une valeur invalide.",
      });
    }

    const mission = await prisma.$transaction(async (tx) => {
      const nextPickupAddress =
        typeof body.pickupAddress === "undefined"
          ? existingMission.pickupAddress
          : body.pickupAddress;
      const nextDeliveryAddress =
        typeof body.deliveryAddress === "undefined"
          ? existingMission.deliveryAddress
          : body.deliveryAddress;
      const nextPickupPlaceId =
        typeof body.pickupPlaceId === "undefined"
          ? existingMission.pickupPlaceId
          : body.pickupPlaceId;
      const nextDeliveryPlaceId =
        typeof body.deliveryPlaceId === "undefined"
          ? existingMission.deliveryPlaceId
          : body.deliveryPlaceId;
      const nextPickupLat =
        typeof body.pickupLat === "undefined"
          ? existingMission.pickupLat
          : body.pickupLat;
      const nextPickupLng =
        typeof body.pickupLng === "undefined"
          ? existingMission.pickupLng
          : body.pickupLng;
      const nextDeliveryLat =
        typeof body.deliveryLat === "undefined"
          ? existingMission.deliveryLat
          : body.deliveryLat;
      const nextDeliveryLng =
        typeof body.deliveryLng === "undefined"
          ? existingMission.deliveryLng
          : body.deliveryLng;
      const pickupChanged =
        (existingMission.pickupAddress ?? existingMission.pickupCity) !==
          (nextPickupAddress ?? body.pickupCity) ||
        existingMission.pickupPlaceId !== nextPickupPlaceId ||
        existingMission.pickupLat !== nextPickupLat ||
        existingMission.pickupLng !== nextPickupLng;
      const deliveryChanged =
        (existingMission.deliveryAddress ?? existingMission.deliveryCity) !==
          (nextDeliveryAddress ?? body.deliveryCity) ||
        existingMission.deliveryPlaceId !== nextDeliveryPlaceId ||
        existingMission.deliveryLat !== nextDeliveryLat ||
        existingMission.deliveryLng !== nextDeliveryLng;
      const routeMustBeInvalidated = pickupChanged || deliveryChanged;
      const updatedMission = await tx.mission.update({
        where: {
          id: body.missionId,
        },
        data: {
          reference: body.reference,
          title: body.title,
          clientName: body.clientName,
          pickupCity: body.pickupCity,
          deliveryCity: body.deliveryCity,
          pickupAddress: body.pickupAddress,
          deliveryAddress: body.deliveryAddress,
          ...(pickupChanged
            ? {
                pickupSourceAddress:
                  body.pickupAddress ?? body.pickupCity,
                pickupResolutionStatus: "PENDING",
                pickupResolutionMethod: null,
                pickupResolutionConfidence: null,
                pickupResolvedAt: null,
                pickupResolutionReason: null,
              }
            : {}),
          ...(deliveryChanged
            ? {
                deliverySourceAddress:
                  body.deliveryAddress ?? body.deliveryCity,
                deliveryResolutionStatus: "PENDING",
                deliveryResolutionMethod: null,
                deliveryResolutionConfidence: null,
                deliveryResolvedAt: null,
                deliveryResolutionReason: null,
              }
            : {}),
          ...(routeMustBeInvalidated
            ? {
                routeDistanceMeters: null,
                routeDurationSeconds: null,
                routePolyline: null,
                routeCalculatedAt: null,
                routeProvider: null,
              }
            : {}),
          preparationStatus: "PENDING",
          preparationMissingData: Prisma.DbNull,
          preparationError: null,
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
          preAnnouncementRequired: body.preAnnouncementRequired,
          preAnnouncementSent: body.preAnnouncementSent,
          preAnnouncementSentAt: body.preAnnouncementSentAt,
          requirements: body.requirements,
          contacts: body.contacts,
          billingInfo: body.billingInfo,
          status: body.status,
          notes: body.notes,
        },
      });

      if (existingMission.status !== updatedMission.status) {
        await tx.missionEvent.create({
          data: {
            missionId: updatedMission.id,
            type: MissionEventType.STATUS_CHANGED,
            message: "Mission status updated from dispatcher mission form.",
            fromStatus: existingMission.status,
            toStatus: updatedMission.status,
            metadata: {
              source: "dispatcher_mission_form",
            },
          },
        });
      }

      if ((existingMission.notes ?? "") !== (updatedMission.notes ?? "")) {
        await tx.missionEvent.create({
          data: {
            missionId: updatedMission.id,
            type: MissionEventType.NOTE_ADDED,
            message: "Mission notes updated from dispatcher board.",
            metadata: {
              previousNotes: existingMission.notes,
              notes: updatedMission.notes,
            },
          },
        });
      }

      return updatedMission;
    });

    let preparedMission = mission;
    try {
      preparedMission = await prepareMission(mission.id);
    } catch (preparationError) {
      console.error("Mission updated but preparation failed", {
        missionId: mission.id,
        error:
          preparationError instanceof Error
            ? preparationError.message
            : "MISSION_PREPARATION_FAILED",
      });
      preparedMission =
        (await prisma.mission.findUnique({ where: { id: mission.id } })) ??
        mission;
    }

    return res.status(200).json({ mission: preparedMission });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return res.status(400).json({ error: "Mission reference already exists" });
    }

    console.error("Failed to update mission", error);
    return res.status(500).json({ error: "Failed to update mission" });
  }
}

export default withTenantApiRoute(handler)
