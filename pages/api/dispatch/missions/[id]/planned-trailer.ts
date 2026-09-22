import { withTenantApiRoute } from '../../../../../lib/auth/authorization'
import { MissionEventType, MissionStatus, Prisma, TrailerCustodyState, TrailerStatus } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";

import { requirePermission } from "../../../../../lib/auth/authorization";
import { permissions } from "../../../../../lib/auth/permissions";
import { prisma } from "../../../../../lib/prisma";

function routeId(value: string | string[] | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requirePermission(req, res, permissions.dispatchAssign);
  if (!user) return;
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const missionId = routeId(req.query.id);
  const trailerId =
    req.body?.trailerId === null
      ? null
      : typeof req.body?.trailerId === "string" && req.body.trailerId.trim()
        ? req.body.trailerId.trim()
        : undefined;
  if (!missionId || typeof trailerId === "undefined") {
    return res.status(400).json({ error: "Mission ou remorque planifiée invalide." });
  }

  try {
    const assignment = await prisma.missionAssignment.findUnique({
      where: { missionId },
      include: { trailer: true },
    });
    if (!assignment) {
      return res.status(409).json({ error: "La mission doit être planifiée avant d'affecter une remorque." });
    }
    if (assignment.trailerId === trailerId) {
      return res.status(200).json({ assignment });
    }

    if (
      assignment.trailer &&
      (assignment.trailer.custodyState === TrailerCustodyState.IN_MISSION ||
        assignment.trailer.custodyState === TrailerCustodyState.RELAY_AVAILABLE)
    ) {
      return res.status(409).json({
        error: "Clôturez ou annulez le relais actif avant de remplacer cette remorque.",
      });
    }

    const nextTrailer = trailerId
      ? await prisma.trailer.findUnique({ where: { id: trailerId } })
      : null;
    if (trailerId && !nextTrailer) {
      return res.status(404).json({ error: "Remorque introuvable." });
    }
    if (
      nextTrailer &&
      ((nextTrailer.status === TrailerStatus.IN_MAINTENANCE ||
        nextTrailer.status === TrailerStatus.MAINTENANCE_EXT ||
        nextTrailer.status === TrailerStatus.OUT_OF_SERVICE) ||
        nextTrailer.custodyState === TrailerCustodyState.IMMOBILIZED)
    ) {
      return res.status(409).json({ error: "Cette remorque est indisponible." });
    }

    if (trailerId) {
      const conflict = await prisma.missionAssignment.findFirst({
        where: {
          trailerId,
          missionId: { not: missionId },
          mission: { status: { notIn: [MissionStatus.DONE, MissionStatus.CANCELLED] } },
        },
        select: { mission: { select: { reference: true } } },
      });
      if (conflict) {
        return res.status(409).json({
          error: `Cette remorque est déjà planifiée sur la mission ${conflict.mission.reference}.`,
        });
      }
    }

    const previousTransitions = Array.isArray(assignment.trailerTransitions)
      ? assignment.trailerTransitions
      : [];
    const transition = {
      type: "MANUAL_PLANNED_TRAILER_CHANGE",
      fromTrailerId: assignment.trailerId,
      toTrailerId: trailerId,
      occurredAt: new Date().toISOString(),
      actorId: user.id,
    };
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.missionAssignment.update({
        where: { missionId },
        data: {
          trailerId,
          trailerChangePlanned: assignment.trailerId !== trailerId,
          trailerTransitions: [...previousTransitions, transition] as Prisma.InputJsonValue,
        },
        include: { trailer: true },
      });
      await tx.missionEvent.create({
        data: {
          type: MissionEventType.NOTE_ADDED,
          missionId,
          actorId: user.id,
          trailerId,
          message: trailerId ? "Remorque planifiée modifiée." : "Remorque planifiée retirée.",
          metadata: transition,
        },
      });
      return result;
    });
    return res.status(200).json({ assignment: updated });
  } catch (error) {
    console.error("Unable to update planned trailer", { missionId, error });
    return res.status(500).json({ error: "Impossible de modifier la remorque planifiée." });
  }
}

export default withTenantApiRoute(handler)
