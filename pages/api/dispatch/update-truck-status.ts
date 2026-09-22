import { withTenantApiRoute } from '../../../lib/auth/authorization'
import { TruckStatus } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";

import { prisma } from "../../../lib/prisma";
import { synchronizeParkPresence } from "../../../lib/park/service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTruckStatus(value: unknown): value is TruckStatus {
  return (
    typeof value === "string" &&
    Object.values(TruckStatus).includes(value as TruckStatus)
  );
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.trucksManage))) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  if (
    !isRecord(req.body) ||
    typeof req.body.truckId !== "string" ||
    req.body.truckId.trim().length === 0 ||
    !isTruckStatus(req.body.status)
  ) {
    return res.status(400).json({
      error: "Invalid request body",
    });
  }

  const truckId = req.body.truckId.trim();
  const status = req.body.status;

  try {
    const truck = await prisma.truck.findUnique({
      where: {
        id: truckId,
      },
    });

    if (!truck) {
      return res.status(404).json({
        error: "Truck not found",
      });
    }

    if (truck.status === status) {
      return res.status(200).json({
        truck,
      });
    }

    const updatedTruck = await prisma.$transaction(async (tx) => {
      const nextTruck = await tx.truck.update({
        where: {
          id: truckId,
        },
        data: {
          status,
          statusUpdatedAt: new Date(),
        },
      });

      await tx.truckEvent.create({
        data: {
          truckId,
          fromStatus: truck.status,
          toStatus: status,
          message: `Statut camion modifié de ${truck.status} vers ${status}.`,
          metadata: {
            source: "dispatch_map",
          },
        },
      });

      return nextTruck;
    });

    await synchronizeParkPresence();

    return res.status(200).json({
      truck: updatedTruck,
    });
  } catch (error) {
    console.error("Failed to update truck status", {
      truckId,
      status,
      error,
    });

    return res.status(500).json({
      error: "failed_to_update_truck_status",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export default withTenantApiRoute(handler)
