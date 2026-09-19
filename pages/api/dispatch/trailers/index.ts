import {
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

type TrailerPayload = {
  plateNumber: string;
  type: TrailerType;
  status: TrailerStatus;
  loadStatus: TrailerLoadStatus;
  cargoType?: TrailerCargoType | null;
  compatibleCargoTypes?: TrailerCargoType[] | null;
  cargoDescription?: string | null;
  notes?: string | null;
  technicalInspectionDate?: Date | null;
  capacityKg?: number | null;
  couplingType?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

type ParseResult = { payload: TrailerPayload } | { error: string };

function parsePayload(body: unknown): ParseResult {
  if (!isRecord(body)) {
    return { error: "Invalid trailer payload" };
  }

  const plateNumber = getOptionalString(body.plateNumber);

  if (!plateNumber) {
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
    : TrailerLoadStatus.EMPTY;
  const normalizedCargoType = normalizeTrailerCargoType(body.cargoType);
  const cargoType =
    loadStatus === TrailerLoadStatus.LOADED && normalizedCargoType
      ? normalizedCargoType
      : null;

  return {
    payload: {
      plateNumber,
      type: normalizedType ?? TrailerType.OTHER,
      status: isTrailerStatus(body.status)
        ? body.status
        : TrailerStatus.AVAILABLE,
      loadStatus,
      cargoType,
      compatibleCargoTypes:
        compatibleCargoTypes.status === "VALID"
          ? compatibleCargoTypes.value
          : compatibleCargoTypes.status === "CLEARED"
            ? null
            : undefined,
      cargoDescription: getOptionalString(body.cargoDescription),
      notes: getOptionalString(body.notes),
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
  const permission = req.method === "GET" ? permissions.trailersView : permissions.trailersManage;
  const sessionUser = await requirePermission(req, res, permission);

  if (!sessionUser) {
    return;
  }

  if (req.method === "GET") {
    try {
      const trailers = await prisma.trailer.findMany({
        orderBy: {
          plateNumber: "asc",
        },
        include: {
          truck: true,
        },
      });

      return res.status(200).json({ trailers });
    } catch (error) {
      console.error("Failed to load trailers", error);
      return res.status(500).json({ error: "Failed to load trailers" });
    }
  }

  if (req.method === "POST") {
    const parsed = parsePayload(req.body);

    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }
    const payload = parsed.payload;

    try {
      const trailer = await prisma.trailer.create({
        data: {
          ...payload,
          capacityKg: payload.capacityKg ?? undefined,
          couplingType: payload.couplingType ?? undefined,
          compatibleCargoTypes: payload.compatibleCargoTypes ?? undefined,
          technicalInspectionExpiresAt: getTechnicalInspectionExpiresAt(
            payload.technicalInspectionDate ?? null,
          ),
        },
        include: {
          truck: true,
        },
      });

      return res.status(201).json({ trailer });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return res.status(409).json({ error: "Trailer plate already exists" });
      }

      console.error("Failed to create trailer", error);
      return res.status(500).json({ error: "Failed to create trailer" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
