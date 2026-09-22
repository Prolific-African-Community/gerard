import { withTenantApiRoute } from '../../../../lib/auth/authorization'
import type { NextApiRequest, NextApiResponse } from "next";

import { requirePermission } from "../../../../lib/auth/authorization";
import { permissions } from "../../../../lib/auth/permissions";
import {
  normalizeMissionReference,
  suggestAvailableReference,
} from "../../../../lib/mail/editable-import";
import { prisma } from "../../../../lib/prisma";

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.missionsCreate))) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const reference = normalizeMissionReference(req.query.reference);
  if (!reference) {
    return res.status(400).json({ error: "La référence est obligatoire." });
  }

  const candidates = await prisma.mission.findMany({
    where: { reference: { startsWith: reference } },
    select: { id: true, reference: true },
  });
  const exact = candidates.find((candidate) => candidate.reference === reference);
  const usedReferences = new Set(candidates.map((candidate) => candidate.reference));

  return res.status(200).json({
    reference,
    available: !exact,
    existingMissionId: exact?.id ?? null,
    suggestion: exact
      ? suggestAvailableReference(reference, usedReferences)
      : reference,
  });
}

export default withTenantApiRoute(handler)
