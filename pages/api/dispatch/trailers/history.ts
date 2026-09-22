import { withTenantApiRoute } from '../../../../lib/auth/authorization'
/**
 * Derniers mouvements d'une remorque, en lecture seule.
 *
 * Réutilise `TrailerCustodyEvent` : aucune seconde architecture d'historique.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePermission } from '../../../../lib/auth/authorization'
import { permissions } from '../../../../lib/auth/permissions'
import { prisma } from '../../../../lib/prisma'
import type { TrailerCustodyMovement } from '../../../../lib/dispatch/trailer-rotation'

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.dispatchView))) return
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const trailerId =
    typeof req.query.trailerId === 'string' ? req.query.trailerId : null
  if (!trailerId) {
    return res.status(400).json({ error: 'trailerId est requis.' })
  }

  const events = await prisma.trailerCustodyEvent.findMany({
    where: { trailerId },
    orderBy: { occurredAt: 'desc' },
    take: 5,
    select: {
      id: true,
      occurredAt: true,
      note: true,
      location: true,
      fromDriver: { select: { name: true } },
      toDriver: { select: { name: true } },
      mission: {
        select: {
          reference: true,
          assignment: { select: { truck: { select: { plateNumber: true } } } },
        },
      },
    },
  })

  const movements: TrailerCustodyMovement[] = events.map((event) => ({
    id: event.id,
    occurredAt: event.occurredAt.toISOString(),
    note: event.note,
    location: event.location,
    fromDriverName: event.fromDriver?.name ?? null,
    toDriverName: event.toDriver?.name ?? null,
    missionReference: event.mission?.reference ?? null,
    truckPlate: event.mission?.assignment?.truck?.plateNumber ?? null,
  }))

  return res.status(200).json({ movements })
}

export default withTenantApiRoute(handler)
