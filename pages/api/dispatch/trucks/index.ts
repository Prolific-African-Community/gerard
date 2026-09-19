import { Prisma, TruckStatus } from "@prisma/client";
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

type TruckPayload = {
  plateNumber: string;
  brand?: string;
  model?: string;
  status?: TruckStatus;
  gpsDeviceId?: string;
  technicalInspectionDate?: Date | null;
  category?: string | null;
  capacityKg?: number | null;
  couplingType?: string | null;
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

function isTruckStatus(value: unknown): value is TruckStatus {
  return Object.values(TruckStatus).some((status) => status === value);
}

type ParseResult =
  | { payload: TruckPayload }
  | { error: string };

function parsePayload(body: unknown): ParseResult {
  if (!isRecord(body)) {
    return { error: "Invalid truck payload" };
  }

  const plateNumber = getOptionalString(body.plateNumber);

  if (!plateNumber) {
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
      brand: getOptionalString(body.brand),
      model: getOptionalString(body.model),
      status: isTruckStatus(body.status) ? body.status : TruckStatus.AVAILABLE,
      gpsDeviceId: getOptionalString(body.gpsDeviceId),
      technicalInspectionDate,
      category: toPrismaValue(category),
      capacityKg: toPrismaValue(capacityKg),
      couplingType: toPrismaValue(couplingType),
    },
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const permission = req.method === "GET" ? permissions.trucksView : permissions.trucksManage;
  const sessionUser = await requirePermission(req, res, permission);

  if (!sessionUser) {
    return;
  }

  if (req.method === "GET") {
    try {
      const trucks = await prisma.truck.findMany({
        orderBy: {
          plateNumber: "asc",
        },
        include: {
          driver: true,
        },
      });

      return res.status(200).json({ trucks });
    } catch (error) {
      console.error("Failed to load trucks", error);
      return res.status(500).json({ error: "Failed to load trucks" });
    }
  }

  if (req.method === "POST") {
    const parsed = parsePayload(req.body);

    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }
    const payload = parsed.payload;

    try {
      const truck = await prisma.truck.create({
        data: {
          plateNumber: payload.plateNumber,
          brand: payload.brand,
          model: payload.model,
          status: payload.status ?? TruckStatus.AVAILABLE,
          gpsDeviceId: payload.gpsDeviceId,
          technicalInspectionDate: payload.technicalInspectionDate,
          technicalInspectionExpiresAt: getTechnicalInspectionExpiresAt(
            payload.technicalInspectionDate ?? null,
          ),
          category: payload.category ?? undefined,
          capacityKg: payload.capacityKg ?? undefined,
          couplingType: payload.couplingType ?? undefined,
        },
        include: {
          driver: true,
        },
      });

      return res.status(201).json({ truck });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return res.status(409).json({ error: "Truck plate already exists" });
      }

      console.error("Failed to create truck", error);
      return res.status(500).json({ error: "Failed to create truck" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
