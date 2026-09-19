import type { MissionSourceEmailResponse, MissionSourceEmailPayload } from "./types";

import type { Prisma, PrismaClient } from "@prisma/client";

type MissionSourceEmailRecord = {
  source: string;
  provider: string | null;
  sourceEmailId: string;
  messageId: string | null;
  previewKey: string | null;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  toAddresses: Prisma.JsonValue | null;
  ccAddresses: Prisma.JsonValue | null;
  receivedAt: Date | null;
  bodyPreview: string | null;
  cleanedBodyText: string | null;
  rawBodyText: string | null;
  rawBodyHtml: string | null;
};

type PrismaLikeClient = PrismaClient | Prisma.TransactionClient;

function normalizeString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringArray(values: string[] | null | undefined) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => normalizeString(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

export function hasMissionSourceEmailPayload(
  payload: Partial<MissionSourceEmailPayload> | null | undefined,
) {
  return Boolean(
    normalizeString(payload?.sourceEmailId) ||
      normalizeString(payload?.messageId) ||
      normalizeString(payload?.subject) ||
      normalizeString(payload?.cleanedBodyText) ||
      normalizeString(payload?.rawBodyText),
  );
}

export async function upsertMissionSourceEmail(
  client: PrismaLikeClient,
  missionId: string,
  payload: MissionSourceEmailPayload,
) {
  const normalizedPayload = {
    source: normalizeString(payload.source) ?? "IMPORTED_EMAIL",
    provider: normalizeString(payload.provider),
    sourceEmailId: normalizeString(payload.sourceEmailId) ?? missionId,
    messageId: normalizeString(payload.messageId),
    previewKey: normalizeString(payload.previewKey),
    subject: normalizeString(payload.subject),
    fromName: normalizeString(payload.fromName),
    fromAddress: normalizeString(payload.fromAddress),
    toAddresses: normalizeStringArray(payload.toAddresses) as unknown as Prisma.InputJsonValue,
    ccAddresses: normalizeStringArray(payload.ccAddresses) as unknown as Prisma.InputJsonValue,
    receivedAt: normalizeString(payload.receivedAt)
      ? new Date(payload.receivedAt as string)
      : null,
    bodyPreview: normalizeString(payload.bodyPreview),
    cleanedBodyText: normalizeString(payload.cleanedBodyText),
    rawBodyText: normalizeString(payload.rawBodyText),
    rawBodyHtml: normalizeString(payload.rawBodyHtml),
  };

  return client.missionSourceEmail.upsert({
    where: {
      missionId,
    },
    create: {
      missionId,
      ...normalizedPayload,
    },
    update: normalizedPayload,
  });
}

function getStringArray(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function toMissionSourceEmailResponse(
  record: MissionSourceEmailRecord,
): MissionSourceEmailResponse {
  return {
    source: record.source,
    provider: record.provider,
    sourceEmailId: record.sourceEmailId,
    messageId: record.messageId,
    previewKey: record.previewKey,
    subject: record.subject,
    fromName: record.fromName,
    fromAddress: record.fromAddress,
    toAddresses: getStringArray(record.toAddresses),
    ccAddresses: getStringArray(record.ccAddresses),
    receivedAt: record.receivedAt?.toISOString() ?? null,
    bodyPreview: record.bodyPreview,
    cleanedBodyText: record.cleanedBodyText,
    rawBodyText: record.rawBodyText,
    rawBodyHtml: record.rawBodyHtml,
  };
}
