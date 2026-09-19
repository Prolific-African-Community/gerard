import type { NextApiRequest, NextApiResponse } from "next";
import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";

import { prisma } from "../../../lib/prisma";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.missionsView))) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { missionId } = req.query;

  if (typeof missionId !== "string" || missionId.trim().length === 0) {
    return res.status(400).json({ error: "missionId is required" });
  }

  try {
    const mission = await prisma.mission.findUnique({
      where: {
        id: missionId,
      },
      select: {
        id: true,
      },
    });

    if (!mission) {
      return res.status(404).json({ error: "Mission not found" });
    }

    const events = await prisma.missionEvent.findMany({
      where: {
        missionId,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        actor: {
          select: {
            name: true,
          },
        },
        driver: {
          select: {
            name: true,
          },
        },
        truck: {
          select: {
            plateNumber: true,
          },
        },
        trailer: {
          select: {
            plateNumber: true,
          },
        },
      },
    });

    return res.status(200).json({
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        message: event.message,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        metadata: event.metadata,
        createdAt: event.createdAt,
        actorName: event.actor?.name ?? null,
        driverName: event.driver?.name ?? null,
        truckPlateNumber: event.truck?.plateNumber ?? null,
        trailerPlateNumber: event.trailer?.plateNumber ?? null,
      })),
    });
  } catch (error) {
    console.error("Failed to load mission events", error);
    return res.status(500).json({ error: "Failed to load mission events" });
  }
}
