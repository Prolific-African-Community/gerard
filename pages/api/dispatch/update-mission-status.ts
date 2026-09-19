import { MissionEventType, MissionStatus } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";

import { prisma } from "../../../lib/prisma";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissionStatus(value: unknown): value is MissionStatus {
  return (
    typeof value === "string" &&
    (Object.values(MissionStatus) as string[]).includes(value)
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.missionsEdit))) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (
    !isRecord(req.body) ||
    typeof req.body.missionId !== "string" ||
    !isMissionStatus(req.body.status)
  ) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const missionId = req.body.missionId;
  const status = req.body.status;

  try {
    const mission = await prisma.mission.findUnique({
      where: { id: missionId },
    });

    if (!mission) {
      return res.status(404).json({ error: "Mission not found" });
    }

    const updatedMission = await prisma.$transaction(async (tx) => {
      const nextMission = await tx.mission.update({
        where: {
          id: missionId,
        },
        data: {
          status,
        },
        include: {
          assignment: {
            include: {
              driver: true,
              truck: true,
            },
          },
        },
      });

      await tx.missionEvent.create({
        data: {
          missionId,
          type: MissionEventType.STATUS_CHANGED,
          message: `Mission status changed to ${status}.`,
          fromStatus: mission.status,
          toStatus: status,
        },
      });

      return nextMission;
    });

    return res.status(200).json({ mission: updatedMission });
  } catch (error) {
    console.error("Failed to update mission status", error);
    return res.status(500).json({ error: "Failed to update mission status" });
  }
}
