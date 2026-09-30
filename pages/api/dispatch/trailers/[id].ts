import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import {
  MaintenanceRequestStatus,
  MissionStatus,
  Prisma,
  TrailerCargoType,
  TrailerLoadStatus,
  TrailerStatus,
  TrailerType,
} from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";

import { requirePermission } from "../../../../lib/auth/authorization";
import { permissions } from "../../../../lib/auth/permissions";
import {
  getTechnicalInspectionExpiresAt,
  parseTechnicalInspectionDateInput,
} from "../../../../lib/dispatch/technical-inspection";
import {
  parseCapacityKg,
  parseCompatibleCargoTypes,
  parseCouplingType,
  toPrismaValue,
} from "../../../../lib/dispatch/technical-attributes";
import {
  normalizeCompatibleCargoTypes,
  normalizeCouplingType,
  normalizeTrailerCargoType,
  normalizeTrailerType,
} from "../../../../lib/dispatch/form-normalization";
import { prisma } from "../../../../lib/prisma";
import { synchronizeParkPresence } from "../../../../lib/park/service";
import { getWeekStartDate } from "../../../../lib/dispatch/date-utils";
import { decideTrailerRemoval, hardDeleteTrailer } from "../../../../lib/dispatch/trailer-lifecycle";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getTrailerId(queryValue: string | string[] | undefined) {
  return typeof queryValue === "string" && queryValue.trim().length > 0
    ? queryValue.trim()
    : null;
}

function getOptionalString(value: unknown): string | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : null;
}

function isTrailerType(value: unknown): value is TrailerType {
  return Object.values(TrailerType).some((type) => type === value);
}

function isTrailerStatus(value: unknown): value is TrailerStatus {
  return Object.values(TrailerStatus).some((status) => status === value);
}

function isTrailerLoadStatus(value: unknown): value is TrailerLoadStatus {
  return Object.values(TrailerLoadStatus).some((status) => status === value);
}

function isTrailerCargoType(value: unknown): value is TrailerCargoType {
  return Object.values(TrailerCargoType).some((type) => type === value);
}

function isDeleteConflictError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2003" || error.code === "P2014")
  );
}

type ParseResult =
  | {
      payload: {
        plateNumber: string | null | undefined;
        notes: string | null | undefined;
        type: TrailerType | undefined;
        status: TrailerStatus | undefined;
        loadStatus: TrailerLoadStatus | undefined;
        cargoType: TrailerCargoType | null | undefined;
        compatibleCargoTypes: TrailerCargoType[] | null | undefined;
        cargoDescription: string | null | undefined;
        technicalInspectionDate: Date | null | undefined;
        capacityKg: number | null | undefined;
        couplingType: string | null | undefined;
        currentLocationAddress: string | null | undefined;
        currentLocationPlaceId: string | null | undefined;
        currentLocationLat: number | null | undefined;
        currentLocationLng: number | null | undefined;
        currentLocationUpdatedAt: Date | null | undefined;
      };
    }
  | { error: string };

export function parsePayload(body: unknown): ParseResult {
  if (!isRecord(body)) {
    return { error: "Invalid trailer payload" };
  }

  const plateNumber = getOptionalString(body.plateNumber);
  const notes = getOptionalString(body.notes);
  const cargoDescription = getOptionalString(body.cargoDescription);

  if (typeof body.plateNumber !== "undefined" && !plateNumber) {
    return { error: "Invalid trailer payload" };
  }

  const normalizedType = normalizeTrailerType(body.type);
  if (
    typeof body.type !== "undefined" &&
    typeof normalizedType === "undefined"
  ) {
    return { error: "Invalid trailer payload" };
  }

  if (typeof body.status !== "undefined" && !isTrailerStatus(body.status)) {
    return { error: "Invalid trailer payload" };
  }

  if (
    typeof body.loadStatus !== "undefined" &&
    !isTrailerLoadStatus(body.loadStatus)
  ) {
    return { error: "Invalid trailer payload" };
  }

  if (
    typeof body.cargoType !== "undefined" &&
    body.cargoType !== null &&
    body.cargoType !== "" &&
    typeof normalizeTrailerCargoType(body.cargoType) === "undefined"
  ) {
    return { error: "Invalid trailer payload" };
  }

  const technicalInspectionDate = parseTechnicalInspectionDateInput(
    body.technicalInspectionDate,
  );

  if (
    typeof body.technicalInspectionDate !== "undefined" &&
    typeof technicalInspectionDate === "undefined"
  ) {
    return { error: "Invalid trailer payload" };
  }

  const normalizedCouplingType = normalizeCouplingType(body.couplingType);
  if (
    typeof body.couplingType !== "undefined" &&
    typeof normalizedCouplingType === "undefined"
  ) {
    return { error: "Type d’attelage invalide." };
  }
  const normalizedCompatibleCargoTypes = normalizeCompatibleCargoTypes(
    body.compatibleCargoTypes,
  );
  if (
    typeof body.compatibleCargoTypes !== "undefined" &&
    typeof normalizedCompatibleCargoTypes === "undefined"
  ) {
    return { error: "Types de marchandise compatibles invalides." };
  }
  const capacityKg = parseCapacityKg(body.capacityKg);
  if (capacityKg.status === "INVALID") return { error: capacityKg.message };
  const couplingType = parseCouplingType(normalizedCouplingType);
  if (couplingType.status === "INVALID") return { error: couplingType.message };
  const compatibleCargoTypes = parseCompatibleCargoTypes(
    normalizedCompatibleCargoTypes,
  );
  if (compatibleCargoTypes.status === "INVALID") {
    return { error: compatibleCargoTypes.message };
  }

  const loadStatus = isTrailerLoadStatus(body.loadStatus)
    ? body.loadStatus
    : undefined;
  const normalizedCargoType = normalizeTrailerCargoType(body.cargoType);
  const cargoType =
    loadStatus === TrailerLoadStatus.EMPTY
      ? null
      : normalizedCargoType
        ? normalizedCargoType
        : body.cargoType === null || body.cargoType === ""
          ? null
          : undefined;
  const locationProvided = ["currentLocationAddress", "currentLocationPlaceId", "currentLocationLat", "currentLocationLng"].some((key) => Object.prototype.hasOwnProperty.call(body, key));
  const latitude = body.currentLocationLat === null || body.currentLocationLat === "" ? null : body.currentLocationLat === undefined ? undefined : Number(body.currentLocationLat);
  const longitude = body.currentLocationLng === null || body.currentLocationLng === "" ? null : body.currentLocationLng === undefined ? undefined : Number(body.currentLocationLng);
  if (locationProvided && ((latitude === null) !== (longitude === null) || (typeof latitude === "number" && (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude! < -180 || longitude! > 180)))) return { error: "Localisation actuelle invalide." };

  return {
    payload: {
      plateNumber,
      notes,
      type: normalizedType ?? undefined,
      status: isTrailerStatus(body.status) ? body.status : undefined,
      loadStatus,
      cargoType,
      compatibleCargoTypes:
        compatibleCargoTypes.status === "VALID"
          ? compatibleCargoTypes.value
          : compatibleCargoTypes.status === "CLEARED"
            ? null
            : undefined,
      cargoDescription,
      technicalInspectionDate,
      capacityKg: toPrismaValue(capacityKg),
      couplingType: toPrismaValue(couplingType),
      currentLocationAddress: getOptionalString(body.currentLocationAddress),
      currentLocationPlaceId: getOptionalString(body.currentLocationPlaceId),
      currentLocationLat: latitude,
      currentLocationLng: longitude,
      currentLocationUpdatedAt: locationProvided ? latitude === null ? null : new Date() : undefined,
    },
  };
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const permission = req.method === "DELETE" ? permissions.trailersDelete : permissions.trailersManage;
  const sessionUser = await requirePermission(req, res, permission);

  if (!sessionUser) {
    return;
  }

  const trailerId = getTrailerId(req.query.id);

  if (!trailerId) {
    return res.status(400).json({ error: "Trailer id is required" });
  }

  if (req.method === "PATCH") {
    const parsed = parsePayload(req.body);

    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }
    const payload = parsed.payload;

    try {
      const existingTrailer = await prisma.trailer.findUnique({
        where: {
          id: trailerId,
        },
      });

      if (!existingTrailer) {
        return res.status(404).json({ error: "Trailer not found" });
      }

      // NB : truckId n'est jamais modifié ici (aucune recomposition de couple).
      const trailer = await prisma.trailer.update({
        where: {
          id: trailerId,
        },
        data: {
          plateNumber: payload.plateNumber ?? undefined,
          type: payload.type,
          status: payload.status,
          loadStatus: payload.loadStatus,
          cargoType: payload.cargoType,
          compatibleCargoTypes:
            payload.compatibleCargoTypes === null
              ? Prisma.DbNull
              : payload.compatibleCargoTypes,
          cargoDescription: payload.cargoDescription,
          technicalInspectionDate: payload.technicalInspectionDate,
          technicalInspectionExpiresAt:
            typeof payload.technicalInspectionDate === "undefined"
              ? undefined
              : getTechnicalInspectionExpiresAt(
                  payload.technicalInspectionDate,
                ),
          notes: payload.notes,
          capacityKg: payload.capacityKg,
          couplingType: payload.couplingType,
          currentLocationAddress: payload.currentLocationAddress,
          currentLocationPlaceId: payload.currentLocationPlaceId,
          currentLocationLat: payload.currentLocationLat,
          currentLocationLng: payload.currentLocationLng,
          currentLocationUpdatedAt: payload.currentLocationUpdatedAt,
        },
        include: {
          truck: true,
        },
      });

      await synchronizeParkPresence();

      return res.status(200).json({ trailer });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return res.status(409).json({ error: "Trailer plate already exists" });
      }

      console.error("Failed to update trailer", {
        trailerId,
        error,
      });
      return res.status(500).json({ error: "Failed to update trailer" });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const trailer = await prisma.trailer.findUnique({
        where: {
          id: trailerId,
        },
        include: { truck: { select: { plateNumber: true } } },
      })

      if (!trailer) {
        return res.status(404).json({ error: 'Trailer not found' })
      }

      const activeStatuses = [
        MissionStatus.PENDING,
        MissionStatus.ASSIGNED,
        MissionStatus.IN_PROGRESS,
        MissionStatus.ISSUE,
      ]
      const activeMaintenanceStatuses = [
        MaintenanceRequestStatus.SUBMITTED,
        MaintenanceRequestStatus.RECEIVED,
        MaintenanceRequestStatus.UNDER_REVIEW,
        MaintenanceRequestStatus.QUOTE_RECEIVED,
        MaintenanceRequestStatus.QUOTE_APPROVED,
        MaintenanceRequestStatus.SCHEDULED,
        MaintenanceRequestStatus.IN_PROGRESS,
      ]
      const currentWeek = getWeekStartDate()
      const [
        activeAssignments,
        activePlanningCount,
        activeMaintenanceCount,
        historicalAssignmentCount,
        custodyEventCount,
        maintenanceCount,
        inspectionCount,
        movementCount,
        missionEventCount,
        planningCount,
      ] = await Promise.all([
        prisma.missionAssignment.findMany({
          where: { trailerId, mission: { status: { in: activeStatuses } } },
          select: { mission: { select: { reference: true } } },
        }),
        prisma.planningRow.count({
          where: { trailerId, weekStartDate: { gte: currentWeek } },
        }),
        prisma.maintenanceRequest.count({
          where: { trailerId, status: { in: activeMaintenanceStatuses } },
        }),
        prisma.missionAssignment.count({ where: { trailerId } }),
        prisma.trailerCustodyEvent.count({ where: { trailerId } }),
        prisma.maintenanceRequest.count({ where: { trailerId } }),
        prisma.parkInspection.count({ where: { trailerId } }),
        prisma.parkMovement.count({ where: { trailerId } }),
        prisma.missionEvent.count({ where: { trailerId } }),
        prisma.planningRow.count({ where: { trailerId } }),
      ])
      const decision = decideTrailerRemoval({
        attachedTruckPlate: trailer.truck?.plateNumber ?? null,
        activeMissionReferences: activeAssignments.map(
          (item) => item.mission.reference
        ),
        activeMaintenanceCount,
        activePlanningCount,
        historicalAssignmentCount,
        custodyEventCount,
        maintenanceCount,
        inspectionCount,
        movementCount,
        missionEventCount,
        historicalPlanningCount: Math.max(
          0,
          planningCount - activePlanningCount
        ),
      })

      if (decision.action === 'BLOCK') {
        return res
          .status(409)
          .json({ error: decision.reason, disposition: 'BLOCKED' })
      }

      await prisma.$transaction(async (tx) => {
        await hardDeleteTrailer(tx, trailerId)
      })

      return res.status(200).json({ success: true, disposition: 'DELETED' })
    } catch (error) {
      if (isDeleteConflictError(error)) {
        return res.status(409).json({
          error: 'Impossible de supprimer : une dépendance active de cette remorque doit d’abord être libérée.',
        })
      }

      console.error('Failed to delete trailer', {
        trailerId,
        error,
      })
      return res
        .status(500)
        .json({ error: 'Impossible de supprimer la remorque.' })
    }
  }

  res.setHeader("Allow", "PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}

export default withTenantApiRoute(handler)
