import {
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
    },
  };
}

export default async function handler(
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

  if (req.method === "DELETE") {
    try {
      const trailer = await prisma.trailer.findUnique({
        where: {
          id: trailerId,
        },
      });

      if (!trailer) {
        return res.status(404).json({ error: "Trailer not found" });
      }

      const activeAssignmentConditions: Prisma.MissionAssignmentWhereInput[] = [
        {
          planningRow: {
            trailerId,
          },
        },
      ];

      if (trailer.truckId) {
        activeAssignmentConditions.push({
          truckId: trailer.truckId,
        });
      }

      const activeAssignment = await prisma.missionAssignment.findFirst({
        where: {
          OR: activeAssignmentConditions,
          mission: {
            status: {
              in: [
                MissionStatus.PENDING,
                MissionStatus.ASSIGNED,
                MissionStatus.IN_PROGRESS,
                MissionStatus.ISSUE,
              ],
            },
          },
        },
        select: {
          id: true,
        },
      });

      if (activeAssignment) {
        return res.status(409).json({
          error:
            "Cette remorque est liée à une mission active. Réassignez ou terminez la mission avant suppression.",
        });
      }

      const relatedMaintenanceCount = await prisma.maintenanceRequest.count({
        where: {
          trailerId,
        },
      });

      if (relatedMaintenanceCount > 0) {
        return res.status(409).json({
          error:
            "Impossible de supprimer cette remorque car elle possède des missions ou interventions liées.",
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.planningRow.updateMany({
          where: {
            trailerId,
          },
          data: {
            trailerId: null,
          },
        });
        await tx.trailer.delete({
          where: {
            id: trailerId,
          },
        });
      });

      return res.status(200).json({ success: true });
    } catch (error) {
      if (isDeleteConflictError(error)) {
        return res.status(409).json({
          error:
            "Impossible de supprimer cette remorque car elle possède des missions ou interventions liées.",
        });
      }

      console.error("Failed to delete trailer", {
        trailerId,
        error,
      });
      return res.status(500).json({ error: "Impossible de supprimer la remorque." });
    }
  }

  res.setHeader("Allow", "PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
