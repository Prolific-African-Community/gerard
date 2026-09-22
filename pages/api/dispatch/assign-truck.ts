import { withTenantApiRoute } from '../../../lib/auth/authorization'
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

  if (
    !isRecord(req.body) ||
    typeof req.body.truckId !== "string" ||
    !(typeof req.body.driverId === "string" || req.body.driverId === null)
  ) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const truckId = req.body.truckId;
  const driverId = req.body.driverId;

  try {
    const [truck, driver] = await Promise.all([
      prisma.truck.findUnique({ where: { id: truckId } }),
      driverId
        ? prisma.driver.findUnique({ where: { id: driverId } })
        : Promise.resolve(null),
    ]);

    if (!truck) {
      return res.status(404).json({ error: "Truck not found" });
    }

    if (driverId && !driver) {
      return res.status(404).json({ error: "Driver not found" });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (driverId === null) {
        const updatedTruck = await tx.truck.update({
          where: {
            id: truckId,
          },
          data: {
            driverId: null,
          },
        });

        return {
          updatedTruck,
          previousTruck: null,
          driver: null,
        };
      }

      const previousTruck = await tx.truck.findFirst({
        where: {
          driverId,
          id: {
            not: truckId,
          },
        },
      });

      if (previousTruck) {
        await tx.truck.update({
          where: {
            id: previousTruck.id,
          },
          data: {
            driverId: null,
          },
        });
      }

      const updatedTruck = await tx.truck.update({
        where: {
          id: truckId,
        },
        data: {
          driverId,
        },
      });

      const updatedPreviousTruck = previousTruck
        ? {
            ...previousTruck,
            driverId: null,
          }
        : null;

      return {
        updatedTruck,
        previousTruck: updatedPreviousTruck,
        driver,
      };
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("Failed to assign truck", error);
    return res.status(500).json({ error: "Failed to assign truck" });
  }
}

export default withTenantApiRoute(handler)
