import { MissionEventType } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";

import { prisma } from "../../../lib/prisma";
import { computeGoogleRoute } from "../../../lib/dispatch/maps/google";

type RouteResponse = {
  missionId: string;
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number;
  durationLabel: string;
  polyline: string;
  cached: boolean;
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

function isRequestBody(value: unknown): value is {
  missionId: string;
  forceRefresh?: boolean;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Record<string, unknown>;

  return (
    typeof body.missionId === "string" &&
    body.missionId.trim().length > 0 &&
    (typeof body.forceRefresh === "undefined" ||
      typeof body.forceRefresh === "boolean")
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

function buildRouteResponse({
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
}): RouteResponse {
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.missionsEdit))) return;
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

  const missionId = req.body.missionId.trim();
  const forceRefresh = req.body.forceRefresh === true;

  try {
    const mission = await prisma.mission.findUnique({
      where: {
        id: missionId,
      },
    });

    if (!mission) {
      return res.status(404).json({
        error: "Mission not found",
      });
    }

    if (
      typeof mission.pickupLat !== "number" ||
      typeof mission.pickupLng !== "number" ||
      typeof mission.deliveryLat !== "number" ||
      typeof mission.deliveryLng !== "number"
    ) {
      return res.status(400).json({
        error: "Mission pickup and delivery coordinates are required",
      });
    }

    if (
      !forceRefresh &&
      typeof mission.routeDistanceMeters === "number" &&
      typeof mission.routeDurationSeconds === "number" &&
      typeof mission.routePolyline === "string" &&
      mission.routePolyline.length > 0
    ) {
      return res.status(200).json(
        buildRouteResponse({
          missionId: mission.id,
          distanceMeters: mission.routeDistanceMeters,
          durationSeconds: mission.routeDurationSeconds,
          polyline: mission.routePolyline,
          cached: true,
        }),
      );
    }

    const route = await computeGoogleRoute({
      origin: {
        latitude: mission.pickupLat,
        longitude: mission.pickupLng,
      },
      destination: {
        latitude: mission.deliveryLat,
        longitude: mission.deliveryLng,
      },
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

    return res.status(200).json(
      buildRouteResponse({
        missionId: mission.id,
        distanceMeters,
        durationSeconds,
        polyline,
        cached: false,
      }),
    );
  } catch (error) {
    console.error("Failed to compute mission route", error);

    return res.status(500).json({
      error: "Failed to compute mission route",
    });
  }
}
