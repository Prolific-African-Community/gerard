import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import { MissionStatus, Prisma, TrailerStatus, TruckStatus } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";

import { requirePermission } from "../../../../lib/auth/authorization";
import { permissions } from "../../../../lib/auth/permissions";
import {
  getTechnicalInspectionExpiresAt,
  parseTechnicalInspectionDateInput,
} from "../../../../lib/dispatch/technical-inspection";
import {
  parseCapacityKg,
  parseCouplingType,
  parseTruckCategory,
  toPrismaValue,
} from "../../../../lib/dispatch/technical-attributes";
import { prisma } from "../../../../lib/prisma";
import { synchronizeParkPresence } from "../../../../lib/park/service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getTruckId(queryValue: string | string[] | undefined) {
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

function isTruckStatus(value: unknown): value is TruckStatus {
  return Object.values(TruckStatus).some((status) => status === value);
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
        brand: string | null | undefined;
        model: string | null | undefined;
        gpsDeviceId: string | null | undefined;
        status: TruckStatus | undefined;
        technicalInspectionDate: Date | null | undefined;
        category: string | null | undefined;
        capacityKg: number | null | undefined;
        couplingType: string | null | undefined;
      };
    }
  | { error: string };

function parsePayload(body: unknown): ParseResult {
  if (!isRecord(body)) {
    return { error: "Invalid truck payload" };
  }

  const plateNumber = getOptionalString(body.plateNumber);
  const brand = getOptionalString(body.brand);
  const model = getOptionalString(body.model);
  const gpsDeviceId = getOptionalString(body.gpsDeviceId);

  if (typeof body.plateNumber !== "undefined" && !plateNumber) {
    return { error: "Invalid truck payload" };
  }

  if (typeof body.status !== "undefined" && !isTruckStatus(body.status)) {
    return { error: "Invalid truck payload" };
  }

  const technicalInspectionDate = parseTechnicalInspectionDateInput(
    body.technicalInspectionDate,
  );

  if (
    typeof body.technicalInspectionDate !== "undefined" &&
    typeof technicalInspectionDate === "undefined"
  ) {
    return { error: "Invalid truck payload" };
  }

  const category = parseTruckCategory(body.category);
  if (category.status === "INVALID") return { error: category.message };
  const capacityKg = parseCapacityKg(body.capacityKg);
  if (capacityKg.status === "INVALID") return { error: capacityKg.message };
  const couplingType = parseCouplingType(body.couplingType);
  if (couplingType.status === "INVALID") return { error: couplingType.message };

  return {
    payload: {
      plateNumber,
      brand,
      model,
      gpsDeviceId,
      status: isTruckStatus(body.status) ? body.status : undefined,
      technicalInspectionDate,
      category: toPrismaValue(category),
      capacityKg: toPrismaValue(capacityKg),
      couplingType: toPrismaValue(couplingType),
    },
  };
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const permission = req.method === "DELETE" ? permissions.trucksDelete : permissions.trucksManage;
  const sessionUser = await requirePermission(req, res, permission);

  if (!sessionUser) {
    return;
  }

  const truckId = getTruckId(req.query.id);

  if (!truckId) {
    return res.status(400).json({ error: "Truck id is required" });
  }

  if (req.method === "PATCH") {
    const parsed = parsePayload(req.body);

    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }
    const payload = parsed.payload;

    try {
      const existingTruck = await prisma.truck.findUnique({
        where: {
          id: truckId,
        },
      });

      if (!existingTruck) {
        return res.status(404).json({ error: "Truck not found" });
      }

      const truck = await prisma.truck.update({
        where: {
          id: truckId,
        },
        data: {
          plateNumber: payload.plateNumber ?? undefined,
          brand: payload.brand,
          model: payload.model,
          gpsDeviceId: payload.gpsDeviceId,
          status: payload.status,
          technicalInspectionDate: payload.technicalInspectionDate,
          technicalInspectionExpiresAt:
            typeof payload.technicalInspectionDate === "undefined"
              ? undefined
              : getTechnicalInspectionExpiresAt(
                  payload.technicalInspectionDate,
                ),
          category: payload.category,
          capacityKg: payload.capacityKg,
          couplingType: payload.couplingType,
          statusUpdatedAt:
            payload.status && payload.status !== existingTruck.status
              ? new Date()
              : undefined,
        },
        include: {
          driver: true,
        },
      });

      await synchronizeParkPresence();

      return res.status(200).json({ truck });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return res.status(409).json({ error: "Truck plate already exists" });
      }

      console.error("Failed to update truck", {
        truckId,
        error,
      });
      return res.status(500).json({ error: "Failed to update truck" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const existingTruck = await prisma.truck.findUnique({
        where: {
          id: truckId,
        },
      });

      if (!existingTruck) {
        return res.status(404).json({ error: "Truck not found" });
      }

      const activeAssignment = await prisma.missionAssignment.findFirst({
        where: {
          truckId,
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
            "Ce camion est lié à une mission active. Réassignez ou terminez la mission avant suppression.",
        });
      }

      const relatedMaintenanceCount = await prisma.maintenanceRequest.count({
        where: {
          truckId,
        },
      });

      if (relatedMaintenanceCount > 0) {
        return res.status(409).json({
          error:
            "Impossible de supprimer ce camion car il possède des missions ou interventions liées.",
        });
      }

      await prisma.$transaction(async (tx) => {
        const rowTrailerIds = (
          await tx.planningRow.findMany({
            where: { truckId },
            select: { trailerId: true },
          })
        )
          .map((row) => row.trailerId)
          .filter((trailerId): trailerId is string => Boolean(trailerId));

        await tx.planningRow.updateMany({
          where: { truckId },
          data: { truckId: null },
        });
        await tx.missionAssignment.updateMany({
          where: { truckId },
          data: { truckId: null },
        });
        await tx.trailer.updateMany({
          where: {
            truckId,
            id: {
              notIn: rowTrailerIds,
            },
          },
          data: { truckId: null, status: TrailerStatus.AVAILABLE },
        });
        await tx.trailer.updateMany({
          where: {
            id: {
              in: rowTrailerIds,
            },
          },
          data: { truckId: null },
        });
        await tx.driverPosition.deleteMany({
          where: { truckId },
        });
        await tx.truckPosition.deleteMany({
          where: { truckId },
        });
        await tx.truckEvent.deleteMany({
          where: { truckId },
        });
        await tx.truck.delete({
          where: { id: truckId },
        });
      });

      return res.status(200).json({ success: true });
    } catch (error) {
      if (isDeleteConflictError(error)) {
        return res.status(409).json({
          error:
            "Impossible de supprimer ce camion car il possède des missions ou interventions liées.",
        });
      }

      console.error("Failed to delete truck", {
        truckId,
        error,
      });
      return res.status(500).json({ error: "Impossible de supprimer le camion." });
    }
  }

  res.setHeader("Allow", "PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}

export default withTenantApiRoute(handler)
