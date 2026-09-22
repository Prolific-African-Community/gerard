import { withTenantApiRoute } from '../../../lib/auth/authorization'
import {
  MissionEventType,
  MissionStatus,
  PlanningDay,
  Prisma,
  TrailerCustodyState,
  TrailerCustodyTransitionStatus,
  TrailerLoadStatus,
  TrailerStatus,
} from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";

import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";
import {
  appendRelayTransition,
  getTrailerRelayEligibility,
} from "../../../lib/dispatch/trailer-relay";
import { prisma } from "../../../lib/prisma";

const dayOffset: Record<PlanningDay, number> = {
  MONDAY: 0,
  TUESDAY: 1,
  WEDNESDAY: 2,
  THURSDAY: 3,
  FRIDAY: 4,
  SATURDAY: 5,
  SUNDAY: 6,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isPlanningDay(value: unknown): value is PlanningDay {
  return (
    typeof value === "string" &&
    Object.values(PlanningDay).includes(value as PlanningDay)
  );
}

function scheduledDateFor(weekStartDate: Date, day: PlanningDay) {
  const result = new Date(weekStartDate);
  result.setUTCDate(result.getUTCDate() + dayOffset[day]);
  return result;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const user = await requirePermission(
    req,
    res,
    permissions.dispatchDragDrop,
  );
  if (!user) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!isRecord(req.body)) {
    return res.status(400).json({ error: "Payload de relais invalide." });
  }

  const action = getString(req.body.action);
  const missionId = getString(req.body.missionId);
  const trailerId = getString(req.body.trailerId);
  const note = getString(req.body.note);
  const location = getString(req.body.location) ?? "Base";

  if (!action || !missionId || !trailerId) {
    return res.status(400).json({
      error: "Mission, remorque et action de relais sont obligatoires.",
    });
  }

  try {
    if (action === "MARK_RELAY_AVAILABLE") {
      const result = await prisma.$transaction(async (tx) => {
        const assignment = await tx.missionAssignment.findUnique({
          where: { missionId },
        });
        const trailer = await tx.trailer.findUnique({
          where: { id: trailerId },
        });
        if (!assignment || assignment.trailerId !== trailerId || !trailer) {
          throw new RelayError(
            409,
            "La remorque n’est pas affectée à cette mission.",
          );
        }
        if (trailer.loadStatus !== TrailerLoadStatus.LOADED) {
          throw new RelayError(409, "La remorque doit être chargée.");
        }

        const updated = await tx.trailer.update({
          where: { id: trailerId },
          data: {
            status: TrailerStatus.AT_BASE,
            custodyState: TrailerCustodyState.RELAY_AVAILABLE,
            custodyVersion: { increment: 1 },
          },
        });
        const event = await tx.trailerCustodyEvent.create({
          data: {
            trailerId,
            missionId,
            planningRowId: assignment.planningRowId,
            fromDriverId: assignment.driverId,
            fromState: trailer.custodyState,
            toState: TrailerCustodyState.RELAY_AVAILABLE,
            status: TrailerCustodyTransitionStatus.COMPLETED,
            location,
            note,
            actorId: user.id,
          },
        });
        return { trailer: updated, event };
      });
      return res.status(200).json(result);
    }

    if (action === "CANCEL_RELAY") {
      const result = await prisma.$transaction(async (tx) => {
        const [assignment, trailer] = await Promise.all([
          tx.missionAssignment.findUnique({ where: { missionId } }),
          tx.trailer.findUnique({ where: { id: trailerId } }),
        ]);
        if (!assignment || !trailer) {
          throw new RelayError(404, "Mission ou remorque introuvable.");
        }
        if (
          assignment.trailerId !== trailerId ||
          trailer.custodyState !== TrailerCustodyState.RELAY_AVAILABLE
        ) {
          throw new RelayError(409, "Aucun relais actif ne peut être annulé.");
        }
        const updated = await tx.trailer.update({
          where: { id: trailerId },
          data: {
            custodyState: TrailerCustodyState.AT_BASE,
            custodyVersion: { increment: 1 },
          },
        });
        const event = await tx.trailerCustodyEvent.create({
          data: {
            trailerId,
            missionId,
            planningRowId: assignment.planningRowId,
            fromDriverId: assignment.driverId,
            fromState: TrailerCustodyState.RELAY_AVAILABLE,
            toState: TrailerCustodyState.AT_BASE,
            status: TrailerCustodyTransitionStatus.CANCELLED,
            location,
            note,
            actorId: user.id,
          },
        });
        return { trailer: updated, event };
      });
      return res.status(200).json(result);
    }

    if (action !== "TAKE_OVER") {
      return res.status(400).json({ error: "Action de relais inconnue." });
    }

    const targetPlanningRowId = getString(req.body.targetPlanningRowId);
    const targetDay = req.body.targetDay;
    const expectedCustodyVersion = req.body.expectedCustodyVersion;
    if (
      !targetPlanningRowId ||
      !isPlanningDay(targetDay) ||
      typeof expectedCustodyVersion !== "number"
    ) {
      return res.status(400).json({
        error: "La ligne, le jour et la version de garde sont obligatoires.",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const [assignment, trailer, targetRow] = await Promise.all([
        tx.missionAssignment.findUnique({ where: { missionId } }),
        tx.trailer.findUnique({ where: { id: trailerId } }),
        tx.planningRow.findUnique({ where: { id: targetPlanningRowId } }),
      ]);
      if (!assignment || !trailer || !targetRow?.driverId) {
        throw new RelayError(404, "Mission, remorque ou chauffeur introuvable.");
      }
      if (assignment.trailerId !== trailerId) {
        throw new RelayError(
          409,
          "Cette remorque n’est plus rattachée à la mission.",
        );
      }
      const eligibility = getTrailerRelayEligibility(trailer);
      if (!eligibility.eligible) {
        throw new RelayError(409, eligibility.reason);
      }
      if (trailer.custodyVersion !== expectedCustodyVersion) {
        throw new RelayError(
          409,
          "La garde de la remorque a été modifiée. Actualisez le Dispatch.",
        );
      }

      const conflictingAssignment = await tx.missionAssignment.findFirst({
        where: {
          trailerId,
          missionId: { not: missionId },
          mission: {
            status: {
              notIn: [MissionStatus.DONE, MissionStatus.CANCELLED],
            },
          },
        },
        select: { missionId: true },
      });
      if (conflictingAssignment) {
        throw new RelayError(
          409,
          "La remorque est déjà en garde active sur une autre mission.",
        );
      }

      const updateTrailer = await tx.trailer.updateMany({
        where: {
          id: trailerId,
          custodyVersion: expectedCustodyVersion,
          custodyState: TrailerCustodyState.RELAY_AVAILABLE,
        },
        data: {
          custodyState: TrailerCustodyState.IN_MISSION,
          custodyVersion: { increment: 1 },
          status: TrailerStatus.ASSIGNED,
        },
      });
      if (updateTrailer.count !== 1) {
        throw new RelayError(409, "Conflit simultané sur la garde remorque.");
      }

      const occurredAt = new Date();
      const transition = {
        type: "TRAILER_RELAY_TAKEOVER",
        occurredAt: occurredAt.toISOString(),
        trailerId,
        fromDriverId: assignment.driverId,
        toDriverId: targetRow.driverId,
        targetPlanningRowId,
        targetDay,
      };
      const updatedAssignment = await tx.missionAssignment.update({
        where: { id: assignment.id },
        data: {
          planningRowId: targetRow.id,
          driverId: targetRow.driverId,
          truckId: targetRow.truckId,
          day: targetDay,
          scheduledDate: scheduledDateFor(targetRow.weekStartDate, targetDay),
          trailerChangePlanned: true,
          trailerTransitions: appendRelayTransition(
            assignment.trailerTransitions,
            transition,
          ) as Prisma.InputJsonValue,
        },
      });
      const event = await tx.trailerCustodyEvent.create({
        data: {
          trailerId,
          missionId,
          planningRowId: targetRow.id,
          fromDriverId: assignment.driverId,
          toDriverId: targetRow.driverId,
          fromState: TrailerCustodyState.RELAY_AVAILABLE,
          toState: TrailerCustodyState.IN_MISSION,
          status: TrailerCustodyTransitionStatus.COMPLETED,
          location,
          note,
          occurredAt,
          actorId: user.id,
        },
      });
      await tx.missionEvent.create({
        data: {
          missionId,
          type: MissionEventType.DRIVER_CHANGED,
          message: "Reprise de relais remorque confirmée.",
          actorId: user.id,
          driverId: targetRow.driverId,
          truckId: targetRow.truckId,
          trailerId,
          metadata: transition as Prisma.InputJsonValue,
        },
      });
      return { assignment: updatedAssignment, event };
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof RelayError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Trailer relay failed", error);
    return res.status(500).json({ error: "Impossible d’enregistrer le relais." });
  }
}

class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export default withTenantApiRoute(handler)
