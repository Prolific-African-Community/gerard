import { withTenantApiRoute } from '../../../../../lib/auth/authorization'
import { MissionStatus } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";

import { requirePermission } from "../../../../../lib/auth/authorization";
import { permissions } from "../../../../../lib/auth/permissions";
import { prisma } from "../../../../../lib/prisma";

function getMissionId(queryValue: string | string[] | undefined) {
  return typeof queryValue === "string" && queryValue.trim().length > 0
    ? queryValue.trim()
    : null;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const sessionUser = await requirePermission(req, res, permissions.missionsDelete);

  if (!sessionUser) {
    return;
  }

  const missionId = getMissionId(req.query.id);

  if (!missionId) {
    return res.status(400).json({ error: "Mission id is required" });
  }

  if (req.method !== "DELETE") {
    res.setHeader("Allow", "DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const mission = await prisma.mission.findUnique({
      where: { id: missionId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!mission) {
      return res.status(404).json({ error: "Mission not found" });
    }

    if (mission.status === MissionStatus.IN_PROGRESS) {
      return res.status(409).json({
        error:
          "Cette mission est en cours. Terminez-la ou annulez-la avant suppression.",
      });
    }

    await prisma.$transaction([
      prisma.missionSourceEmail.deleteMany({ where: { missionId } }),
      prisma.missionEvent.deleteMany({ where: { missionId } }),
      prisma.missionAssignment.deleteMany({ where: { missionId } }),
      prisma.mission.delete({ where: { id: missionId } }),
    ]);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Failed to delete mission", {
      missionId,
      error,
    });

    return res.status(500).json({ error: "Impossible de supprimer la mission." });
  }
}

export default withTenantApiRoute(handler)
