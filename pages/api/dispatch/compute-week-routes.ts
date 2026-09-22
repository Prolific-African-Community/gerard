import { withTenantApiRoute } from '../../../lib/auth/authorization'
import { MissionEventType } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";

import {
  getWeekEndDate,
  parseWeekStartParam,
} from "../../../lib/dispatch/date-utils";
import { prisma } from "../../../lib/prisma";
import { computeGoogleRoute } from "../../../lib/dispatch/maps/google";

const maxRoutesPerBatch = 10;

type ComputedRoute = {
  missionId: string;
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number;
  durationLabel: string;
  polyline: string;
  cached: boolean;
};

type SkippedRoute = {
  missionId: string;
  reason: string;
};

type FailedRoute = {
  missionId: string;
  error: string;
};

type GoogleRoute = {
  duration?: string;
  distanceMeters?: number;
  polyline?: {
    encodedPolyline?: string;
  };
};

type GoogleRoutesResponse = {
  routes?: GoogleRoute[];
};

type RouteMission = {
  id: string;
  pickupLat: number | null;
  pickupLng: number | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  routeDistanceMeters: number | null;
  routeDurationSeconds: number | null;
  routePolyline: string | null;
};

function isRequestBody(value: unknown): value is {
  weekStart: string;
  forceRefresh?: boolean;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Record<string, unknown>;

  return (
    typeof body.weekStart === "string" &&
    (typeof body.forceRefresh === "undefined" ||
      typeof body.forceRefresh === "boolean")
  );
}

function hasCoordinates(mission: RouteMission) {
  return (
    typeof mission.pickupLat === "number" &&
    typeof mission.pickupLng === "number" &&
    typeof mission.deliveryLat === "number" &&
    typeof mission.deliveryLng === "number"
  );
}

function hasRouteCache(mission: RouteMission) {
  return (
    typeof mission.routeDistanceMeters === "number" &&
    typeof mission.routeDurationSeconds === "number" &&
    typeof mission.routePolyline === "string" &&
    mission.routePolyline.length > 0
  );
}

function parseGoogleDuration(duration: string | undefined) {
  if (!duration) {
    return null;
  }

  const seconds = Math.round(Number.parseFloat(duration.replace("s", "")));

  return Number.isFinite(seconds) ? seconds : null;
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  if (hours <= 0) {
    return `${minutes} min`;
  }

  return `${hours} h ${String(minutes).padStart(2, "0")}`;
}

function buildComputedRoute({
  missionId,
  distanceMeters,
  durationSeconds,
  polyline,
  cached,
}: {
  missionId: string;
  distanceMeters: number;
  durationSeconds: number;
  polyline: string;
  cached: boolean;
}): ComputedRoute {
  return {
    missionId,
    distanceMeters,
    distanceKm: Math.round(distanceMeters / 1000),
    durationSeconds,
    durationLabel: formatDuration(durationSeconds),
    polyline,
    cached,
  };
}

async function computeAndPersistMissionRoute(mission: RouteMission) {
  const route = await computeGoogleRoute({
    origin: { latitude: mission.pickupLat!, longitude: mission.pickupLng! },
    destination: { latitude: mission.deliveryLat!, longitude: mission.deliveryLng! },
  });
  const { distanceMeters, durationSeconds, polyline } = route;

  await prisma.mission.update({
    where: {
      id: mission.id,
    },
    data: {
      routeDistanceMeters: distanceMeters,
      routeDurationSeconds: durationSeconds,
      routePolyline: polyline,
      routeCalculatedAt: new Date(),
      routeProvider: "GOOGLE_ROUTES",
    },
  });

  await prisma.missionEvent.create({
    data: {
      missionId: mission.id,
      type: MissionEventType.NOTE_ADDED,
      message: "Itinéraire principal calculé via Google Routes.",
    },
  });

  return buildComputedRoute({
    missionId: mission.id,
    distanceMeters,
    durationSeconds,
    polyline,
    cached: false,
  });
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.dispatchAssign))) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  if (!isRequestBody(req.body)) {
    return res.status(400).json({
      error: "Invalid request body",
    });
  }

  const weekStartDate = parseWeekStartParam(req.body.weekStart);

  if (!weekStartDate) {
    return res.status(400).json({
      error: "Invalid weekStart",
    });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GOOGLE_MAPS_API_KEY is missing",
    });
  }

  const weekEndDate = getWeekEndDate(weekStartDate);
  const forceRefresh = req.body.forceRefresh === true;
  const computed: ComputedRoute[] = [];
  const skipped: SkippedRoute[] = [];
  const failed: FailedRoute[] = [];

  try {
    const assignments = await prisma.missionAssignment.findMany({
      where: {
        scheduledDate: {
          gte: weekStartDate,
          lte: weekEndDate,
        },
      },
      orderBy: [
        {
          scheduledDate: "asc",
        },
        {
          sortOrder: "asc",
        },
      ],
      include: {
        mission: true,
      },
    });

    const visibleMissions = Array.from(
      assignments
        .reduce((missionsById, assignment) => {
          missionsById.set(assignment.mission.id, assignment.mission);
          return missionsById;
        }, new Map<string, RouteMission>())
        .values(),
    );

    const eligibleMissions = visibleMissions.filter((mission) => {
      if (!hasCoordinates(mission)) {
        skipped.push({
          missionId: mission.id,
          reason: "missing_coordinates",
        });
        return false;
      }

      if (!forceRefresh && hasRouteCache(mission)) {
        skipped.push({
          missionId: mission.id,
          reason: "cached",
        });
        return false;
      }

      return true;
    });

    const missionsToCompute = eligibleMissions.slice(0, maxRoutesPerBatch);
    const remainingCount = Math.max(
      0,
      eligibleMissions.length - missionsToCompute.length,
    );

    for (const mission of missionsToCompute) {
      try {
        computed.push(await computeAndPersistMissionRoute(mission));
      } catch (error) {
        console.error("Failed to compute route for mission", mission.id, error);
        failed.push({
          missionId: mission.id,
          error:
            error instanceof Error
              ? error.message
              : "Failed to compute route",
        });
      }
    }

    return res.status(200).json({
      computed,
      skipped,
      failed,
      remainingCount,
    });
  } catch (error) {
    console.error("Failed to compute week routes", error);

    return res.status(500).json({
      error: "Failed to compute week routes",
    });
  }
}

export default withTenantApiRoute(handler)
