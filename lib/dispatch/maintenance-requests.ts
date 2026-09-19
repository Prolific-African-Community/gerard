import {
  MaintenanceInterventionType,
  MaintenanceRequestStatus,
  MaintenanceUrgency,
  MaintenanceVehicleType,
} from "@prisma/client";

import { prisma } from "../prisma";

type RecordValue = Record<string, unknown>;
const SL_AUTOMOTIVE_PROVIDER = "SL_AUTOMOTIVE";
const SL_AUTOMOTIVE_SOURCE_COMPANY = "NOVOTRALUX";
const SL_AUTOMOTIVE_SOURCE_SYSTEM = "NOVOTRALUX_MAINTENANCE";

type SlAutomotivePayload = {
  sourceCompany: string;
  sourceSystem: string;
  externalRequestId: string;
  externalVehicleId: string;
  vehicleType: MaintenanceVehicleType;
  plateNumber: string;
  interventionType: MaintenanceInterventionType;
  urgency: MaintenanceUrgency;
  mileage: number | null;
  immobilizationRequired: boolean;
  preferredDate: string | null;
  issueDescription: string;
  internalNotes: string | null;
};

export class MaintenanceRequestTransmissionError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "MaintenanceRequestTransmissionError";
    this.statusCode = statusCode;
  }
}

type SendMaintenanceRequestResult = {
  alreadySent: boolean;
  idempotent: boolean;
  externalRequestId: string;
  providerRequestId: string;
  maintenanceRequest: NonNullable<
    Awaited<ReturnType<typeof loadMaintenanceRequestWithRelations>>
  >;
  payload: SlAutomotivePayload;
};

type QuoteDecision = "approve" | "reject";

export type MaintenanceRequestCreatePayload = {
  vehicleType: MaintenanceVehicleType;
  truckId: string | null;
  trailerId: string | null;
  plateNumber: string;
  interventionType: MaintenanceInterventionType;
  urgency: MaintenanceUrgency;
  mileage?: number | null;
  immobilizationRequired: boolean;
  preferredDate?: Date | null;
  issueDescription: string;
  internalNotes?: string | null;
  externalProvider?: string | null;
  externalRequestId?: string | null;
  quoteAmount?: number | null;
  invoiceAmount?: number | null;
  quotePdfUrl?: string | null;
  invoicePdfUrl?: string | null;
};

export type MaintenanceRequestUpdatePayload = {
  vehicleType?: MaintenanceVehicleType;
  truckId?: string | null;
  trailerId?: string | null;
  plateNumber?: string;
  interventionType?: MaintenanceInterventionType;
  urgency?: MaintenanceUrgency;
  status?: MaintenanceRequestStatus;
  mileage?: number | null;
  immobilizationRequired?: boolean;
  preferredDate?: Date | null;
  issueDescription?: string;
  internalNotes?: string | null;
  externalProvider?: string | null;
  externalRequestId?: string | null;
  quoteAmount?: number | null;
  invoiceAmount?: number | null;
  quotePdfUrl?: string | null;
  invoicePdfUrl?: string | null;
  comment?: string | null;
};

export function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}

export async function loadMaintenanceRequestWithRelations(id: string) {
  return prisma.maintenanceRequest.findUnique({
    where: {
      id,
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
}

export function getIdFromQuery(queryValue: string | string[] | undefined) {
  return typeof queryValue === "string" && queryValue.trim().length > 0
    ? queryValue.trim()
    : null;
}

export function getOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function getSlAutomotiveConfig() {
  const baseUrl = getOptionalString(process.env.SL_AUTOMOTIVE_API_BASE_URL);
  const apiKey = getOptionalString(process.env.SL_AUTOMOTIVE_API_KEY);

  if (!baseUrl || !apiKey) {
    throw new MaintenanceRequestTransmissionError(
      "Configuration SL Automotive incomplète.",
      500
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
  };
}

export async function sendQuoteDecisionToSlAutomotive(input: {
  externalRequestId: string;
  providerRequestId: string;
  decision: QuoteDecision;
  comment?: string | null;
}) {
  const { baseUrl, apiKey } = getSlAutomotiveConfig();

  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}/api/garage/external-maintenance/quote-decision`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          sourceCompany: SL_AUTOMOTIVE_SOURCE_COMPANY,
          ...input,
        }),
      }
    );
  } catch {
    throw new MaintenanceRequestTransmissionError(
      "SL Automotive est injoignable; la décision n'a pas été enregistrée.",
      502
    );
  }

  const rawResponseText = await response.text();
  const parsedResponse = rawResponseText
    ? (() => {
        try {
          return JSON.parse(rawResponseText) as unknown;
        } catch {
          return rawResponseText;
        }
      })()
    : null;

  if (!response.ok) {
    throw new MaintenanceRequestTransmissionError(
      getSlErrorMessage(
        response.status,
        parsedResponse,
        "Décision sur les frais refusée par SL Automotive"
      ),
      response.status >= 500 ? 502 : response.status
    );
  }

  return parsedResponse;
}

function assertMaintenanceVehicleConsistency(request: {
  id: string;
  vehicleType: MaintenanceVehicleType;
  truckId: string | null;
  trailerId: string | null;
}) {
  if (request.truckId && request.trailerId) {
    throw new MaintenanceRequestTransmissionError(
      "La demande de maintenance est liée à plusieurs véhicules.",
      400
    );
  }

  if (!request.truckId && !request.trailerId) {
    throw new MaintenanceRequestTransmissionError(
      "La demande de maintenance n'est liée à aucun véhicule.",
      400
    );
  }

  if (
    request.vehicleType === MaintenanceVehicleType.TRUCK &&
    !request.truckId
  ) {
    throw new MaintenanceRequestTransmissionError(
      "vehicleType TRUCK requiert un truckId.",
      400
    );
  }

  if (
    request.vehicleType === MaintenanceVehicleType.TRAILER &&
    !request.trailerId
  ) {
    throw new MaintenanceRequestTransmissionError(
      "vehicleType TRAILER requiert un trailerId.",
      400
    );
  }
}

function buildSlAutomotivePayload(request: {
  id: string;
  vehicleType: MaintenanceVehicleType;
  truckId: string | null;
  trailerId: string | null;
  plateNumber: string;
  interventionType: MaintenanceInterventionType;
  urgency: MaintenanceUrgency;
  mileage: number | null;
  immobilizationRequired: boolean;
  preferredDate: Date | null;
  issueDescription: string;
  internalNotes: string | null;
}): SlAutomotivePayload {
  assertMaintenanceVehicleConsistency(request);

  return {
    sourceCompany: SL_AUTOMOTIVE_SOURCE_COMPANY,
    sourceSystem: SL_AUTOMOTIVE_SOURCE_SYSTEM,
    externalRequestId: request.id,
    externalVehicleId: request.truckId ?? request.trailerId ?? "",
    vehicleType: request.vehicleType,
    plateNumber: request.plateNumber,
    interventionType: request.interventionType,
    urgency: request.urgency,
    mileage: request.mileage,
    immobilizationRequired: request.immobilizationRequired,
    preferredDate: request.preferredDate?.toISOString() ?? null,
    issueDescription: request.issueDescription,
    internalNotes: request.internalNotes,
  };
}

function getProviderRequestId(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const directId = getOptionalString(payload.id);
  if (directId) {
    return directId;
  }

  if (isRecord(payload.request)) {
    const requestId = getOptionalString(payload.request.id);
    if (requestId) {
      return requestId;
    }
  }

  if (isRecord(payload.maintenanceRequest)) {
    const maintenanceRequestId = getOptionalString(
      payload.maintenanceRequest.id
    );
    if (maintenanceRequestId) {
      return maintenanceRequestId;
    }
  }

  return null;
}

function getSlErrorMessage(
  status: number,
  payload: unknown,
  fallbackText: string
) {
  if (isRecord(payload)) {
    const errorMessage =
      getOptionalString(payload.error) ??
      getOptionalString(payload.message) ??
      getOptionalString(payload.details);

    if (errorMessage) {
      return errorMessage;
    }
  }

  return `${fallbackText} (${status})`;
}

export async function sendMaintenanceRequestToSlAutomotive(
  requestId: string
): Promise<SendMaintenanceRequestResult> {
  const maintenanceRequest = await prisma.maintenanceRequest.findUnique({
    where: {
      id: requestId,
    },
  });

  if (!maintenanceRequest) {
    throw new MaintenanceRequestTransmissionError(
      "Maintenance request not found.",
      404
    );
  }

  assertMaintenanceVehicleConsistency(maintenanceRequest);

  const payload = buildSlAutomotivePayload(maintenanceRequest);

  if (
    maintenanceRequest.externalProvider === SL_AUTOMOTIVE_PROVIDER &&
    getOptionalString(maintenanceRequest.providerRequestId)
  ) {
    if (maintenanceRequest.externalRequestId !== maintenanceRequest.id) {
      await prisma.maintenanceRequest.update({
        where: {
          id: maintenanceRequest.id,
        },
        data: {
          externalRequestId: maintenanceRequest.id,
        },
      });
    }

    const hydratedMaintenanceRequest =
      await loadMaintenanceRequestWithRelations(maintenanceRequest.id);

    if (!hydratedMaintenanceRequest) {
      throw new MaintenanceRequestTransmissionError(
        "Maintenance request not found after local SL Automotive lookup.",
        404
      );
    }

    return {
      alreadySent: true,
      idempotent: true,
      externalRequestId: maintenanceRequest.id,
      providerRequestId: maintenanceRequest.providerRequestId as string,
      maintenanceRequest: hydratedMaintenanceRequest,
      payload,
    };
  }

  const { baseUrl, apiKey } = getSlAutomotiveConfig();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/garage/external-maintenance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new MaintenanceRequestTransmissionError(
      "SL Automotive est injoignable pour le moment.",
      502
    );
  }

  const rawResponseText = await response.text();
  const parsedResponse =
    rawResponseText.trim().length > 0
      ? (() => {
          try {
            return JSON.parse(rawResponseText) as unknown;
          } catch {
            return rawResponseText;
          }
        })()
      : null;

  if (!response.ok) {
    throw new MaintenanceRequestTransmissionError(
      getSlErrorMessage(
        response.status,
        parsedResponse,
        "Transmission vers SL Automotive impossible"
      ),
      response.status >= 500 ? 502 : response.status
    );
  }

  const providerRequestId = getProviderRequestId(parsedResponse);

  if (!providerRequestId) {
    throw new MaintenanceRequestTransmissionError(
      "Réponse SL Automotive invalide: identifiant de demande manquant.",
      502
    );
  }

  const idempotent =
    isRecord(parsedResponse) && typeof parsedResponse.idempotent === "boolean"
      ? parsedResponse.idempotent
      : response.status === 200;

  const updatedMaintenanceRequest = await prisma.$transaction(async (tx) => {
    await tx.maintenanceRequest.update({
      where: {
        id: maintenanceRequest.id,
      },
      data: {
        externalProvider: SL_AUTOMOTIVE_PROVIDER,
        externalRequestId: maintenanceRequest.id,
        providerRequestId,
        status:
          maintenanceRequest.status === MaintenanceRequestStatus.SUBMITTED
            ? undefined
            : MaintenanceRequestStatus.SUBMITTED,
      },
    });

    if (maintenanceRequest.status !== MaintenanceRequestStatus.SUBMITTED) {
      await tx.maintenanceStatusHistory.create({
        data: {
          maintenanceRequestId: maintenanceRequest.id,
          oldStatus: maintenanceRequest.status,
          newStatus: MaintenanceRequestStatus.SUBMITTED,
          comment: "Demande transmise à SL Automotive",
        },
      });
    }

    return tx.maintenanceRequest.findUnique({
      where: {
        id: maintenanceRequest.id,
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

  if (!updatedMaintenanceRequest) {
    throw new MaintenanceRequestTransmissionError(
      "Maintenance request not found after SL Automotive transmission.",
      404
    );
  }

  return {
    alreadySent: false,
    idempotent,
    externalRequestId: maintenanceRequest.id,
    providerRequestId,
    maintenanceRequest: updatedMaintenanceRequest,
    payload,
  };
}

export function getNullableString(value: unknown): string | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return getOptionalString(value);
}

export function getOptionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export function getOptionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsedValue = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsedValue) ? parsedValue : undefined;
  }

  return undefined;
}

export function getNullableInt(value: unknown): number | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  return getOptionalInt(value);
}

export function getOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsedValue = Number.parseFloat(value.trim());
    return Number.isFinite(parsedValue) ? parsedValue : undefined;
  }

  return undefined;
}

export function getNullableNumber(value: unknown): number | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  return getOptionalNumber(value);
}

export function getOptionalDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate;
}

export function getNullableDate(value: unknown): Date | null | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  return getOptionalDate(value);
}

export function isMaintenanceVehicleType(
  value: unknown
): value is MaintenanceVehicleType {
  return Object.values(MaintenanceVehicleType).some(
    (vehicleType) => vehicleType === value
  );
}

export function isMaintenanceInterventionType(
  value: unknown
): value is MaintenanceInterventionType {
  return Object.values(MaintenanceInterventionType).some(
    (interventionType) => interventionType === value
  );
}

export function isMaintenanceUrgency(
  value: unknown
): value is MaintenanceUrgency {
  return Object.values(MaintenanceUrgency).some((urgency) => urgency === value);
}

export function isMaintenanceRequestStatus(
  value: unknown
): value is MaintenanceRequestStatus {
  return Object.values(MaintenanceRequestStatus).some(
    (status) => status === value
  );
}

export function parseMaintenanceRequestCreatePayload(
  body: unknown
): MaintenanceRequestCreatePayload | null {
  if (!isRecord(body)) {
    return null;
  }

  const vehicleType = isMaintenanceVehicleType(body.vehicleType)
    ? body.vehicleType
    : null;
  const interventionType = isMaintenanceInterventionType(body.interventionType)
    ? body.interventionType
    : null;
  const urgency = isMaintenanceUrgency(body.urgency) ? body.urgency : null;
  const issueDescription = getOptionalString(body.issueDescription);
  const plateNumber = getOptionalString(body.plateNumber);
  const truckId = getNullableString(body.truckId);
  const trailerId = getNullableString(body.trailerId);
  const mileage = getNullableInt(body.mileage);
  const preferredDate = getNullableDate(body.preferredDate);
  const quoteAmount = getNullableNumber(body.quoteAmount);
  const invoiceAmount = getNullableNumber(body.invoiceAmount);
  const internalNotes = getNullableString(body.internalNotes);
  const externalProvider = getNullableString(body.externalProvider);
  const externalRequestId = getNullableString(body.externalRequestId);
  const quotePdfUrl = getNullableString(body.quotePdfUrl);
  const invoicePdfUrl = getNullableString(body.invoicePdfUrl);

  if (
    !vehicleType ||
    !interventionType ||
    !urgency ||
    !issueDescription ||
    !plateNumber ||
    typeof truckId === "undefined" ||
    typeof trailerId === "undefined" ||
    (typeof body.mileage !== "undefined" && typeof mileage === "undefined") ||
    (typeof body.preferredDate !== "undefined" &&
      typeof preferredDate === "undefined") ||
    (typeof body.quoteAmount !== "undefined" &&
      typeof quoteAmount === "undefined") ||
    (typeof body.invoiceAmount !== "undefined" &&
      typeof invoiceAmount === "undefined") ||
    (typeof body.internalNotes !== "undefined" &&
      typeof internalNotes === "undefined") ||
    (typeof body.externalProvider !== "undefined" &&
      typeof externalProvider === "undefined") ||
    (typeof body.externalRequestId !== "undefined" &&
      typeof externalRequestId === "undefined") ||
    (typeof body.quotePdfUrl !== "undefined" &&
      typeof quotePdfUrl === "undefined") ||
    (typeof body.invoicePdfUrl !== "undefined" &&
      typeof invoicePdfUrl === "undefined")
  ) {
    return null;
  }

  return {
    vehicleType,
    interventionType,
    urgency,
    issueDescription,
    plateNumber,
    truckId,
    trailerId,
    mileage,
    immobilizationRequired:
      getOptionalBoolean(body.immobilizationRequired) ?? false,
    preferredDate,
    internalNotes,
    externalProvider,
    externalRequestId,
    quoteAmount,
    invoiceAmount,
    quotePdfUrl,
    invoicePdfUrl,
  };
}

export function parseMaintenanceRequestUpdatePayload(
  body: unknown
): MaintenanceRequestUpdatePayload | null {
  if (!isRecord(body)) {
    return null;
  }

  if (
    typeof body.vehicleType !== "undefined" &&
    !isMaintenanceVehicleType(body.vehicleType)
  ) {
    return null;
  }

  if (
    typeof body.interventionType !== "undefined" &&
    !isMaintenanceInterventionType(body.interventionType)
  ) {
    return null;
  }

  if (
    typeof body.urgency !== "undefined" &&
    !isMaintenanceUrgency(body.urgency)
  ) {
    return null;
  }

  if (
    typeof body.status !== "undefined" &&
    !isMaintenanceRequestStatus(body.status)
  ) {
    return null;
  }

  const plateNumber = getOptionalString(body.plateNumber);
  const issueDescription = getOptionalString(body.issueDescription);
  const truckId = getNullableString(body.truckId);
  const trailerId = getNullableString(body.trailerId);
  const mileage = getNullableInt(body.mileage);
  const preferredDate = getNullableDate(body.preferredDate);
  const quoteAmount = getNullableNumber(body.quoteAmount);
  const invoiceAmount = getNullableNumber(body.invoiceAmount);
  const internalNotes = getNullableString(body.internalNotes);
  const externalProvider = getNullableString(body.externalProvider);
  const externalRequestId = getNullableString(body.externalRequestId);
  const quotePdfUrl = getNullableString(body.quotePdfUrl);
  const invoicePdfUrl = getNullableString(body.invoicePdfUrl);
  const comment = getNullableString(body.comment);

  if (
    (typeof body.plateNumber !== "undefined" && !plateNumber) ||
    (typeof body.issueDescription !== "undefined" && !issueDescription) ||
    (typeof body.truckId !== "undefined" && typeof truckId === "undefined") ||
    (typeof body.trailerId !== "undefined" &&
      typeof trailerId === "undefined") ||
    (typeof body.mileage !== "undefined" && typeof mileage === "undefined") ||
    (typeof body.preferredDate !== "undefined" &&
      typeof preferredDate === "undefined") ||
    (typeof body.quoteAmount !== "undefined" &&
      typeof quoteAmount === "undefined") ||
    (typeof body.invoiceAmount !== "undefined" &&
      typeof invoiceAmount === "undefined") ||
    (typeof body.internalNotes !== "undefined" &&
      typeof internalNotes === "undefined") ||
    (typeof body.externalProvider !== "undefined" &&
      typeof externalProvider === "undefined") ||
    (typeof body.externalRequestId !== "undefined" &&
      typeof externalRequestId === "undefined") ||
    (typeof body.quotePdfUrl !== "undefined" &&
      typeof quotePdfUrl === "undefined") ||
    (typeof body.invoicePdfUrl !== "undefined" &&
      typeof invoicePdfUrl === "undefined") ||
    (typeof body.comment !== "undefined" && typeof comment === "undefined")
  ) {
    return null;
  }

  return {
    vehicleType: isMaintenanceVehicleType(body.vehicleType)
      ? body.vehicleType
      : undefined,
    interventionType: isMaintenanceInterventionType(body.interventionType)
      ? body.interventionType
      : undefined,
    urgency: isMaintenanceUrgency(body.urgency) ? body.urgency : undefined,
    status: isMaintenanceRequestStatus(body.status) ? body.status : undefined,
    plateNumber,
    issueDescription,
    truckId,
    trailerId,
    mileage,
    immobilizationRequired: getOptionalBoolean(body.immobilizationRequired),
    preferredDate,
    internalNotes,
    externalProvider,
    externalRequestId,
    quoteAmount,
    invoiceAmount,
    quotePdfUrl,
    invoicePdfUrl,
    comment,
  };
}

type MaintenanceVehicleValidationInput = {
  vehicleType: MaintenanceVehicleType;
  truckId: string | null;
  trailerId: string | null;
  plateNumber: string;
};

type MaintenanceVehicleValidationResult =
  | {
      ok: true;
      truck: {
        id: string;
        plateNumber: string;
      } | null;
      trailer: {
        id: string;
        plateNumber: string;
      } | null;
    }
  | {
      ok: false;
      error: string;
    };

export async function validateMaintenanceVehicleLink(
  input: MaintenanceVehicleValidationInput
): Promise<MaintenanceVehicleValidationResult> {
  const normalizedPlateNumber = input.plateNumber.trim();

  if (input.truckId && input.trailerId) {
    return {
      ok: false,
      error:
        "A maintenance request cannot be linked to both a truck and a trailer.",
    };
  }

  if (input.vehicleType === MaintenanceVehicleType.TRUCK) {
    if (!input.truckId || input.trailerId) {
      return {
        ok: false,
        error: "vehicleType TRUCK requires truckId and no trailerId.",
      };
    }

    const truck = await prisma.truck.findUnique({
      where: { id: input.truckId },
      select: { id: true, plateNumber: true },
    });

    if (!truck) {
      return {
        ok: false,
        error: "Truck not found for this maintenance request.",
      };
    }

    if (truck.plateNumber !== normalizedPlateNumber) {
      return {
        ok: false,
        error: "plateNumber must match the selected truck plate.",
      };
    }

    return {
      ok: true,
      truck,
      trailer: null,
    };
  }

  if (!input.trailerId || input.truckId) {
    return {
      ok: false,
      error: "vehicleType TRAILER requires trailerId and no truckId.",
    };
  }

  const trailer = await prisma.trailer.findUnique({
    where: { id: input.trailerId },
    select: { id: true, plateNumber: true },
  });

  if (!trailer) {
    return {
      ok: false,
      error: "Trailer not found for this maintenance request.",
    };
  }

  if (trailer.plateNumber !== normalizedPlateNumber) {
    return {
      ok: false,
      error: "plateNumber must match the selected trailer plate.",
    };
  }

  return {
    ok: true,
    truck: null,
    trailer,
  };
}
