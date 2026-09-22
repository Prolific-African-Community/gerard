import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import { MaintenanceRequestStatus } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";

import { requirePermission } from "../../../../lib/auth/authorization";
import { permissions } from "../../../../lib/auth/permissions";
import {
  getIdFromQuery,
  getOptionalString,
  isRecord,
  loadMaintenanceRequestWithRelations,
  parseMaintenanceRequestUpdatePayload,
  sendQuoteDecisionToSlAutomotive,
  sendMaintenanceRequestToSlAutomotive,
  MaintenanceRequestTransmissionError,
  validateMaintenanceVehicleLink,
} from "../../../../lib/dispatch/maintenance-requests";
import { prisma } from "../../../../lib/prisma";

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const permission = req.method === "GET" ? permissions.maintenanceView : permissions.maintenanceManage;
  const sessionUser = await requirePermission(req, res, permission);

  if (!sessionUser) {
    return;
  }

  const maintenanceRequestId = getIdFromQuery(req.query.id);

  if (!maintenanceRequestId) {
    return res
      .status(400)
      .json({ error: "Maintenance request id is required" });
  }

  if (req.method === "GET") {
    try {
      const maintenanceRequest = await loadMaintenanceRequestWithRelations(
        maintenanceRequestId
      );

      if (!maintenanceRequest) {
        return res.status(404).json({ error: "Maintenance request not found" });
      }

      return res.status(200).json({ maintenanceRequest });
    } catch (error) {
      console.error("Failed to load maintenance request", {
        maintenanceRequestId,
        error,
      });
      return res
        .status(500)
        .json({ error: "Failed to load maintenance request" });
    }
  }

  if (req.method === "PATCH") {
    const action = isRecord(req.body)
      ? getOptionalString(req.body.action)
      : undefined;

    if (action === "send_to_sl") {
      try {
        const transmission = await sendMaintenanceRequestToSlAutomotive(
          maintenanceRequestId
        );

        return res.status(200).json({
          maintenanceRequest: transmission.maintenanceRequest,
          alreadySent: transmission.alreadySent,
          idempotent: transmission.idempotent,
          externalRequestId: transmission.externalRequestId,
          providerRequestId: transmission.providerRequestId,
        });
      } catch (error) {
        if (error instanceof MaintenanceRequestTransmissionError) {
          return res.status(error.statusCode).json({
            error: error.message,
          });
        }

        console.error("Failed to send maintenance request to SL Automotive", {
          maintenanceRequestId,
          error,
        });

        return res.status(500).json({
          error: "Impossible de transmettre la demande à SL Automotive.",
        });
      }
    }

    if (action === "quote_decision") {
      const decision = isRecord(req.body)
        ? getOptionalString(req.body.decision)
        : undefined;
      const comment = isRecord(req.body)
        ? getOptionalString(req.body.comment) ?? null
        : null;

      if (decision !== "approve" && decision !== "reject") {
        return res.status(400).json({ error: "Invalid fees decision." });
      }

      try {
        const existingRequest = await prisma.maintenanceRequest.findUnique({
          where: { id: maintenanceRequestId },
        });

        if (!existingRequest) {
          return res
            .status(404)
            .json({ error: "Maintenance request not found" });
        }

        const targetStatus =
          decision === "approve"
            ? MaintenanceRequestStatus.QUOTE_APPROVED
            : MaintenanceRequestStatus.QUOTE_REJECTED;

        if (existingRequest.status === targetStatus) {
          return res.status(200).json({
            maintenanceRequest: await loadMaintenanceRequestWithRelations(
              maintenanceRequestId
            ),
            idempotent: true,
          });
        }

        if (
          existingRequest.status !== MaintenanceRequestStatus.QUOTE_RECEIVED
        ) {
          return res.status(409).json({
            error: "Fees decision requires status QUOTE_RECEIVED.",
          });
        }

        if (!existingRequest.providerRequestId) {
          return res.status(409).json({
            error: "SL Automotive request id is missing.",
          });
        }

        await sendQuoteDecisionToSlAutomotive({
          externalRequestId: existingRequest.id,
          providerRequestId: existingRequest.providerRequestId,
          decision,
          comment,
        });

        const synchronizedRequest = await prisma.maintenanceRequest.findUnique({
          where: { id: existingRequest.id },
        });

        if (!synchronizedRequest) {
          return res.status(404).json({
            error: "Maintenance request not found after fees decision",
          });
        }

        if (synchronizedRequest.status === targetStatus) {
          return res.status(200).json({
            maintenanceRequest: await loadMaintenanceRequestWithRelations(
              maintenanceRequestId
            ),
            idempotent: false,
          });
        }

        await prisma.$transaction(async (tx) => {
          await tx.maintenanceRequest.update({
            where: { id: existingRequest.id },
            data: { status: targetStatus },
          });
          await tx.maintenanceStatusHistory.create({
            data: {
              maintenanceRequestId: existingRequest.id,
              oldStatus: synchronizedRequest.status,
              newStatus: targetStatus,
              comment:
                comment ??
                (decision === "approve" ? "Frais acceptés" : "Frais refusés"),
            },
          });
        });

        return res.status(200).json({
          maintenanceRequest: await loadMaintenanceRequestWithRelations(
            maintenanceRequestId
          ),
          idempotent: false,
        });
      } catch (error) {
        if (error instanceof MaintenanceRequestTransmissionError) {
          return res.status(error.statusCode).json({ error: error.message });
        }
        console.error("Failed to record fees decision", {
          maintenanceRequestId,
          error,
        });
        return res
          .status(500)
          .json({ error: "Failed to record fees decision" });
      }
    }

    if (typeof action !== "undefined") {
      return res.status(400).json({
        error: "Invalid maintenance request action.",
      });
    }

    const payload = parseMaintenanceRequestUpdatePayload(req.body);

    if (!payload) {
      return res
        .status(400)
        .json({ error: "Invalid maintenance request payload" });
    }

    try {
      const existingRequest = await prisma.maintenanceRequest.findUnique({
        where: {
          id: maintenanceRequestId,
        },
      });

      if (!existingRequest) {
        return res.status(404).json({ error: "Maintenance request not found" });
      }

      const targetVehicleType =
        payload.vehicleType ?? existingRequest.vehicleType;
      const targetTruckId =
        typeof payload.truckId === "undefined"
          ? existingRequest.truckId
          : payload.truckId;
      const targetTrailerId =
        typeof payload.trailerId === "undefined"
          ? existingRequest.trailerId
          : payload.trailerId;
      const targetPlateNumber =
        payload.plateNumber ?? existingRequest.plateNumber;

      const vehicleValidation = await validateMaintenanceVehicleLink({
        vehicleType: targetVehicleType,
        truckId: targetTruckId,
        trailerId: targetTrailerId,
        plateNumber: targetPlateNumber,
      });

      if (!vehicleValidation.ok) {
        return res.status(400).json({ error: vehicleValidation.error });
      }

      const nextStatus = payload.status ?? existingRequest.status;
      const statusChanged = nextStatus !== existingRequest.status;
      const statusComment =
        payload.comment ??
        (statusChanged ? "Maintenance status updated" : null);

      const maintenanceRequest = await prisma.$transaction(async (tx) => {
        const updatedRequest = await tx.maintenanceRequest.update({
          where: {
            id: maintenanceRequestId,
          },
          data: {
            vehicleType: targetVehicleType,
            truckId: targetTruckId,
            trailerId: targetTrailerId,
            plateNumber: targetPlateNumber,
            interventionType: payload.interventionType,
            urgency: payload.urgency,
            status: nextStatus,
            mileage:
              typeof payload.mileage === "undefined"
                ? undefined
                : payload.mileage,
            immobilizationRequired: payload.immobilizationRequired,
            preferredDate:
              typeof payload.preferredDate === "undefined"
                ? undefined
                : payload.preferredDate,
            issueDescription: payload.issueDescription,
            internalNotes:
              typeof payload.internalNotes === "undefined"
                ? undefined
                : payload.internalNotes,
            externalProvider:
              typeof payload.externalProvider === "undefined"
                ? undefined
                : payload.externalProvider,
            externalRequestId:
              typeof payload.externalRequestId === "undefined"
                ? undefined
                : payload.externalRequestId,
            quoteAmount:
              typeof payload.quoteAmount === "undefined"
                ? undefined
                : payload.quoteAmount,
            invoiceAmount:
              typeof payload.invoiceAmount === "undefined"
                ? undefined
                : payload.invoiceAmount,
            quotePdfUrl:
              typeof payload.quotePdfUrl === "undefined"
                ? undefined
                : payload.quotePdfUrl,
            invoicePdfUrl:
              typeof payload.invoicePdfUrl === "undefined"
                ? undefined
                : payload.invoicePdfUrl,
          },
        });

        if (statusChanged) {
          await tx.maintenanceStatusHistory.create({
            data: {
              maintenanceRequestId,
              oldStatus: existingRequest.status,
              newStatus: nextStatus as MaintenanceRequestStatus,
              comment: statusComment,
            },
          });
        }

        return tx.maintenanceRequest.findUnique({
          where: {
            id: updatedRequest.id,
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
                truckId: true,
                loadStatus: true,
                cargoType: true,
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

      return res.status(200).json({ maintenanceRequest });
    } catch (error) {
      console.error("Failed to update maintenance request", {
        maintenanceRequestId,
        error,
      });
      return res
        .status(500)
        .json({ error: "Failed to update maintenance request" });
    }
  }

  res.setHeader("Allow", "GET, PATCH");
  return res.status(405).json({ error: "Method not allowed" });
}

export default withTenantApiRoute(handler)
