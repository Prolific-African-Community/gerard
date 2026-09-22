import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import type { Prisma } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";

import { requirePermission } from "../../../../lib/auth/authorization";
import { permissions } from "../../../../lib/auth/permissions";
import {
  normalizeClientProfileName,
  normalizeEmailDomains,
  getOptionalRecord,
  getOptionalString,
  getStringArray,
} from "../../../../lib/dispatch/client-profiles";
import { prisma } from "../../../../lib/prisma";

type ClientProfilePayload = {
  name: string;
  legalName?: string;
  displayName?: string;
  emailDomains?: string[];
  contactEmails?: string[];
  contactPhones?: string[];
  billingInfo?: Prisma.InputJsonObject;
  defaultPaymentTerms?: string;
  defaultTruckType?: string;
  defaultTrailerType?: string;
  defaultPreAnnouncementRequired?: boolean;
  defaultRequirements?: Prisma.InputJsonObject;
  defaultContacts?: Prisma.InputJsonObject;
  operationalNotes?: string;
  parserHints?: Prisma.InputJsonObject;
  isActive?: boolean;
};

function normalizeStringArray(value: unknown): string[] | null | undefined {
  if (typeof value === "undefined" || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  return getStringArray(value);
}

function normalizeJsonObject(
  value: unknown,
): Prisma.InputJsonObject | null | undefined {
  if (typeof value === "undefined" || value === null) {
    return undefined;
  }

  const record = getOptionalRecord(value);
  return record ? (record as Prisma.InputJsonObject) : null;
}

function parseBody(body: unknown): ClientProfilePayload | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const payload = body as Record<string, unknown>;
  const name = getOptionalString(payload.name);

  if (!name) {
    return null;
  }

  const emailDomains = normalizeStringArray(payload.emailDomains);
  const contactEmails = normalizeStringArray(payload.contactEmails);
  const contactPhones = normalizeStringArray(payload.contactPhones);
  const billingInfo = normalizeJsonObject(payload.billingInfo);
  const defaultRequirements = normalizeJsonObject(payload.defaultRequirements);
  const defaultContacts = normalizeJsonObject(payload.defaultContacts);
  const parserHints = normalizeJsonObject(payload.parserHints);

  if (
    emailDomains === null ||
    contactEmails === null ||
    contactPhones === null ||
    billingInfo === null ||
    defaultRequirements === null ||
    defaultContacts === null ||
    parserHints === null
  ) {
    return null;
  }

  const defaultPreAnnouncementRequired =
    typeof payload.defaultPreAnnouncementRequired === "boolean"
      ? payload.defaultPreAnnouncementRequired
      : undefined;
  const isActive =
    typeof payload.isActive === "boolean" ? payload.isActive : undefined;

  return {
    name,
    legalName: getOptionalString(payload.legalName) ?? undefined,
    displayName: getOptionalString(payload.displayName) ?? undefined,
    emailDomains: normalizeEmailDomains(emailDomains ?? []),
    contactEmails: getStringArray(contactEmails ?? []),
    contactPhones: getStringArray(contactPhones ?? []),
    billingInfo,
    defaultPaymentTerms:
      getOptionalString(payload.defaultPaymentTerms) ?? undefined,
    defaultTruckType: getOptionalString(payload.defaultTruckType) ?? undefined,
    defaultTrailerType:
      getOptionalString(payload.defaultTrailerType) ?? undefined,
    defaultPreAnnouncementRequired,
    defaultRequirements,
    defaultContacts,
    operationalNotes: getOptionalString(payload.operationalNotes) ?? undefined,
    parserHints,
    isActive,
  };
}

async function validateUniqueClientProfile(
  body: ClientProfilePayload,
  currentId?: string,
) {
  const activeProfiles = await prisma.clientProfile.findMany({
    where: {
      isActive: true,
      ...(currentId
        ? {
            id: {
              not: currentId,
            },
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      emailDomains: true,
    },
  });

  const normalizedName = normalizeClientProfileName(body.name);
  const conflictingNameProfile = activeProfiles.find(
    (profile) => normalizeClientProfileName(profile.name) === normalizedName,
  );

  if (conflictingNameProfile) {
    return "Un profil client avec ce nom existe déjà.";
  }

  const nextDomains = normalizeEmailDomains(body.emailDomains ?? []);

  if (nextDomains.length === 0) {
    return null;
  }

  const conflictingDomainProfile = activeProfiles.find((profile) => {
    const existingDomains = normalizeEmailDomains(getStringArray(profile.emailDomains));
    return existingDomains.some((domain) => nextDomains.includes(domain));
  });

  if (conflictingDomainProfile) {
    return "Ce domaine email est déjà utilisé par un autre profil client.";
  }

  return null;
}

function toResponse(profile: {
  id: string;
  name: string;
  legalName: string | null;
  displayName: string | null;
  emailDomains: Prisma.JsonValue | null;
  contactEmails: Prisma.JsonValue | null;
  contactPhones: Prisma.JsonValue | null;
  billingInfo: Prisma.JsonValue | null;
  defaultPaymentTerms: string | null;
  defaultTruckType: string | null;
  defaultTrailerType: string | null;
  defaultPreAnnouncementRequired: boolean;
  defaultRequirements: Prisma.JsonValue | null;
  defaultContacts: Prisma.JsonValue | null;
  operationalNotes: string | null;
  parserHints: Prisma.JsonValue | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: profile.id,
    name: profile.name,
    legalName: profile.legalName,
    displayName: profile.displayName,
    emailDomains: getStringArray(profile.emailDomains),
    contactEmails: getStringArray(profile.contactEmails),
    contactPhones: getStringArray(profile.contactPhones),
    billingInfo: getOptionalRecord(profile.billingInfo),
    defaultPaymentTerms: profile.defaultPaymentTerms,
    defaultTruckType: profile.defaultTruckType,
    defaultTrailerType: profile.defaultTrailerType,
    defaultPreAnnouncementRequired: profile.defaultPreAnnouncementRequired,
    defaultRequirements: getOptionalRecord(profile.defaultRequirements),
    defaultContacts: getOptionalRecord(profile.defaultContacts),
    operationalNotes: profile.operationalNotes,
    parserHints: getOptionalRecord(profile.parserHints),
    isActive: profile.isActive,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const permission = req.method === "GET" ? permissions.customersView : permissions.customersManage;
  if (!(await requirePermission(req, res, permission))) {
    return;
  }

  if (req.method === "GET") {
    try {
      const profiles = await prisma.clientProfile.findMany({
        where: {
          isActive: true,
        },
        orderBy: {
          name: "asc",
        },
      });

      return res.status(200).json({
        clientProfiles: profiles.map(toResponse),
      });
    } catch (error) {
      console.error("Failed to load client profiles", error);
      return res
        .status(500)
        .json({ error: "Impossible de charger les profils clients." });
    }
  }

  if (req.method === "POST") {
    const body = parseBody(req.body);

    if (!body) {
      return res.status(400).json({ error: "Invalid client profile payload" });
    }

    try {
      const uniquenessError = await validateUniqueClientProfile(body);

      if (uniquenessError) {
        return res.status(409).json({ error: uniquenessError });
      }

      const profile = await prisma.clientProfile.create({
        data: {
          name: body.name,
          legalName: body.legalName,
          displayName: body.displayName,
          emailDomains: body.emailDomains ?? undefined,
          contactEmails: body.contactEmails ?? undefined,
          contactPhones: body.contactPhones ?? undefined,
          billingInfo: body.billingInfo,
          defaultPaymentTerms: body.defaultPaymentTerms,
          defaultTruckType: body.defaultTruckType,
          defaultTrailerType: body.defaultTrailerType,
          defaultPreAnnouncementRequired:
            body.defaultPreAnnouncementRequired ?? false,
          defaultRequirements: body.defaultRequirements,
          defaultContacts: body.defaultContacts,
          operationalNotes: body.operationalNotes,
          parserHints: body.parserHints,
          isActive: body.isActive ?? true,
        },
      });

      return res.status(201).json({ clientProfile: toResponse(profile) });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        return res
          .status(409)
          .json({ error: "Un profil client avec ce nom existe déjà." });
      }

      console.error("Failed to create client profile", error);
      return res
        .status(500)
        .json({ error: "Impossible de créer le profil client." });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}

export default withTenantApiRoute(handler)
