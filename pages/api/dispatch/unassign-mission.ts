import { withTenantApiRoute } from '../../../lib/auth/authorization'
import { MissionEventType, MissionStatus } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";

import { prisma } from "../../../lib/prisma";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.dispatchAssign))) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isRecord(req.body) || typeof req.body.missionId !== "string") {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const missionId = req.body.missionId;

  try {
    const mission = await prisma.mission.findUnique({
      where: { id: missionId },
      include: { assignment: true },
    });

    if (!mission) {
      return res.status(404).json({ error: "Mission not found" });
    }
    if (!mission.assignment && mission.status === MissionStatus.PENDING) {
      return res.status(200).json({ mission });
    }

    const updatedMission = await prisma.$transaction(async (tx) => {
      if (mission.assignment) {
        await tx.missionAssignment.delete({
          where: {
            missionId,
          },
        });
        const remainingAssignments = await tx.missionAssignment.findMany({
          where: {
            planningRowId: mission.assignment.planningRowId,
            day: mission.assignment.day,
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true },
        });
        for (
          let index = 0;
          index < remainingAssignments.length;
          index += 1
        ) {
          const assignment = remainingAssignments[index];
          await tx.missionAssignment.update({
            where: { id: assignment.id },
            data: { sortOrder: index },
          });
        }
      }

      const nextMission = await tx.mission.update({
        where: {
          id: missionId,
        },
        data: {
          status: MissionStatus.PENDING,
        },
        include: {
          assignment: true,
        },
      });

      await tx.missionEvent.create({
        data: {
          missionId,
          driverId: mission.assignment?.driverId,
          truckId: mission.assignment?.truckId,
          type: MissionEventType.UNASSIGNED,
          message: "Mission removed from dispatcher planning.",
          fromStatus: mission.status,
          toStatus: MissionStatus.PENDING,
          metadata: {
            previousAssignment: mission.assignment,
          },
        },
      });

      return nextMission;
    }, { isolationLevel: "Serializable" });

    return res.status(200).json({ mission: updatedMission });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "P2034"
    ) {
      return res.status(409).json({
        error: "Le planning a Ã©tÃ© modifiÃ© simultanÃ©ment. RÃ©essayez.",
      });
    }
    console.error("Failed to unassign mission", error);
    return res.status(500).json({ error: "Failed to unassign mission" });
  }
}

export default withTenantApiRoute(handler)
