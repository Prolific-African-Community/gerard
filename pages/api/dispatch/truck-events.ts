import { withTenantApiRoute } from '../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from "next";
import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";

import { prisma } from "../../../lib/prisma";

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.trucksView))) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const truckId =
    typeof req.query.truckId === "string" ? req.query.truckId.trim() : "";

  if (!truckId) {
    return res.status(400).json({
      error: "truckId is required",
    });
  }

  try {
    const truck = await prisma.truck.findUnique({
      where: {
        id: truckId,
      },
    });

    if (!truck) {
      return res.status(404).json({
        error: "Truck not found",
      });
    }

    const events = await prisma.truckEvent.findMany({
      where: {
        truckId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20,
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return res.status(200).json({
      events,
    });
  } catch (error) {
    console.error("Failed to load truck events", {
      truckId,
      error,
    });

    return res.status(500).json({
      error: "Failed to load truck events",
    });
  }
}

export default withTenantApiRoute(handler)
