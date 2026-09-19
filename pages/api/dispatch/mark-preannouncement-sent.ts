import type { NextApiRequest, NextApiResponse } from "next";
import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";

import { prisma } from "../../../lib/prisma";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getMissionId(body: unknown) {
  if (!isRecord(body) || typeof body.missionId !== "string") {
    return null;
  }

  const missionId = body.missionId.trim();

  return missionId.length > 0 ? missionId : null;
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

  const missionId = getMissionId(req.body);

  if (!missionId) {
    return res.status(400).json({ error: "missionId is required" });
  }

  try {
    const existingMission = await prisma.mission.findUnique({
      where: {
        id: missionId,
      },
    });

    if (!existingMission) {
      return res.status(404).json({ error: "Mission not found" });
    }

    const mission = await prisma.mission.update({
      where: {
        id: missionId,
      },
      data: {
        preAnnouncementSent: true,
        preAnnouncementSentAt: new Date(),
      },
    });

    return res.status(200).json({ mission });
  } catch (error) {
    console.error("Failed to mark preannouncement sent", {
      missionId,
      error,
    });

    return res.status(500).json({
      error: "Failed to mark preannouncement sent",
    });
  }
}
