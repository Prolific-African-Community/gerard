import {
  MaintenanceRequestStatus,
  MaintenanceVehicleType,
} from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";

import { requirePermission } from "../../../../lib/auth/authorization";
import { permissions } from "../../../../lib/auth/permissions";
import {
  getOptionalString,
  isMaintenanceRequestStatus,
  isMaintenanceVehicleType,
  parseMaintenanceRequestCreatePayload,
  validateMaintenanceVehicleLink,
} from "../../../../lib/dispatch/maintenance-requests";
import { prisma } from "../../../../lib/prisma";

function getFilterValue(queryValue: string | string[] | undefined) {
  return typeof queryValue === "string" && queryValue.trim().length > 0
    ? queryValue.trim()
    : undefined;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const permission = req.method === "GET" ? permissions.maintenanceView : permissions.maintenanceRequest;
  const sessionUser = await requirePermission(req, res, permission);

  if (!sessionUser) {
    return;
  }

  if (req.method === "GET") {
    const truckId = getFilterValue(req.query.truckId);
    const trailerId = getFilterValue(req.query.trailerId);
    const status = getFilterValue(req.query.status);
    const vehicleType = getFilterValue(req.query.vehicleType);

    if (status && !isMaintenanceRequestStatus(status)) {
      return res.status(400).json({ error: "Invalid maintenance status filter" });
    }

    if (vehicleType && !isMaintenanceVehicleType(vehicleType)) {
      return res.status(400).json({ error: "Invalid maintenance vehicleType filter" });
    }

    try {
      const maintenanceRequests = await prisma.maintenanceRequest.findMany({
        where: {
          truckId,
          trailerId,
          status: status as MaintenanceRequestStatus | undefined,
          vehicleType: vehicleType as MaintenanceVehicleType | undefined,
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          truck: {
            select: {
              id: true,
              plateNumber: true,
              brand: true,
              model: true,
              status: true,
            },
          },
          trailer: {
            select: {
              id: true,
              plateNumber: true,
              type: true,
              status: true,
            },
          },
          statusHistory: {
            orderBy: {
              createdAt: "desc",
            },
          },
          interventionLines: {
            orderBy: {
              createdAt: "asc",
            },
          },
          _count: {
            select: {
              statusHistory: true,
            },
          },
        },
      });

      return res.status(200).json({ maintenanceRequests });
    } catch (error) {
      console.error("Failed to load maintenance requests", error);
      return res.status(500).json({ error: "Failed to load maintenance requests" });
    }
  }

  if (req.method === "POST") {
    const payload = parseMaintenanceRequestCreatePayload(req.body);

    if (!payload) {
      return res.status(400).json({ error: "Invalid maintenance request payload" });
    }

    const vehicleValidation = await validateMaintenanceVehicleLink({
      vehicleType: payload.vehicleType,
      truckId: payload.truckId,
      trailerId: payload.trailerId,
      plateNumber: payload.plateNumber,
    });

    if (!vehicleValidation.ok) {
      return res.status(400).json({ error: vehicleValidation.error });
    }

    try {
      const maintenanceRequest = await prisma.$transaction(async (tx) => {
        const createdRequest = await tx.maintenanceRequest.create({
          data: {
            truckId: payload.truckId,
            trailerId: payload.trailerId,
            vehicleType: payload.vehicleType,
            plateNumber: payload.plateNumber,
            interventionType: payload.interventionType,
            urgency: payload.urgency,
            status: MaintenanceRequestStatus.DRAFT,
            mileage: payload.mileage,
            immobilizationRequired: payload.immobilizationRequired,
            preferredDate: payload.preferredDate,
            issueDescription: payload.issueDescription,
            internalNotes: payload.internalNotes,
            externalProvider: getOptionalString(payload.externalProvider) ?? null,
            externalRequestId: getOptionalString(payload.externalRequestId) ?? null,
            quoteAmount: payload.quoteAmount,
            invoiceAmount: payload.invoiceAmount,
            quotePdfUrl: getOptionalString(payload.quotePdfUrl) ?? null,
            invoicePdfUrl: getOptionalString(payload.invoicePdfUrl) ?? null,
          },
        });

        await tx.maintenanceStatusHistory.create({
          data: {
            maintenanceRequestId: createdRequest.id,
            oldStatus: null,
            newStatus: MaintenanceRequestStatus.DRAFT,
            comment: "Maintenance request created",
          },
        });

        return tx.maintenanceRequest.findUnique({
          where: { id: createdRequest.id },
          include: {
            truck: {
              select: {
                id: true,
                plateNumber: true,
                brand: true,
                model: true,
                status: true,
              },
            },
            trailer: {
              select: {
                id: true,
                plateNumber: true,
                type: true,
                status: true,
              },
            },
            statusHistory: {
              orderBy: {
                createdAt: "desc",
              },
            },
            interventionLines: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        });
      });

      return res.status(201).json({ maintenanceRequest });
    } catch (error) {
      console.error("Failed to create maintenance request", error);
      return res.status(500).json({ error: "Failed to create maintenance request" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
