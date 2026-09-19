import { TrailerStatus } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";

import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";
import { prisma } from "../../../lib/prisma";
import { synchronizeParkPresence } from "../../../lib/park/service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const sessionUser = await requirePermission(req, res, permissions.dispatchAssign);

  if (!sessionUser) {
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (
    !isRecord(req.body) ||
    typeof req.body.trailerId !== "string" ||
    !(typeof req.body.truckId === "string" || req.body.truckId === null)
  ) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const trailerId = req.body.trailerId;
  const truckId = req.body.truckId;

  try {
    const [trailer, truck] = await Promise.all([
      prisma.trailer.findUnique({ where: { id: trailerId } }),
      truckId
        ? prisma.truck.findUnique({ where: { id: truckId } })
        : Promise.resolve(null),
    ]);

    if (!trailer) {
      return res.status(404).json({ error: "Trailer not found" });
    }

    if (truckId && !truck) {
      return res.status(404).json({ error: "Truck not found" });
    }

    if (
      truckId &&
      (trailer.status === TrailerStatus.IN_MAINTENANCE ||
        trailer.status === TrailerStatus.MAINTENANCE_EXT ||
        trailer.status === TrailerStatus.OUT_OF_SERVICE)
    ) {
      return res.status(400).json({
        error: "Trailer cannot be assigned while unavailable",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (truckId === null) {
        await tx.planningRow.updateMany({
          where: {
            trailerId,
          },
          data: {
            trailerId: null,
          },
        });

        const updatedTrailer = await tx.trailer.update({
          where: { id: trailerId },
          data: {
            truckId: null,
            status: TrailerStatus.AVAILABLE,
          },
          include: {
            truck: true,
          },
        });

        return {
          trailer: updatedTrailer,
          detachedTrailer: null,
        };
      }

      const oldTrailer = await tx.trailer.findFirst({
        where: {
          truckId,
          id: {
            not: trailerId,
          },
        },
      });

      let detachedTrailer = null;

      if (oldTrailer) {
        await tx.planningRow.updateMany({
          where: {
            trailerId: oldTrailer.id,
          },
          data: {
            trailerId: null,
          },
        });

        detachedTrailer = await tx.trailer.update({
          where: { id: oldTrailer.id },
          data: {
            truckId: null,
            status: TrailerStatus.AVAILABLE,
          },
          include: {
            truck: true,
          },
        });
      }

      const updatedTrailer = await tx.trailer.update({
        where: { id: trailerId },
        data: {
          truckId,
          status: TrailerStatus.ASSIGNED,
        },
        include: {
          truck: true,
        },
      });

      const truckRow = await tx.planningRow.findFirst({
        where: {
          truckId,
        },
        orderBy: {
          sortOrder: "asc",
        },
      });

      if (truckRow) {
        await tx.planningRow.updateMany({
          where: {
            trailerId,
            id: {
              not: truckRow.id,
            },
          },
          data: {
            trailerId: null,
          },
        });
        await tx.planningRow.update({
          where: {
            id: truckRow.id,
          },
          data: {
            trailerId,
          },
        });
      }

      return {
        trailer: updatedTrailer,
        detachedTrailer,
      };
    });

    await synchronizeParkPresence();

    return res.status(200).json(result);
  } catch (error) {
    console.error("Failed to assign trailer", {
      trailerId,
      truckId,
      error,
    });
    return res.status(500).json({ error: "Failed to assign trailer" });
  }
}
