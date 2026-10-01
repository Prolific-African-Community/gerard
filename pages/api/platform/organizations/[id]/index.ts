import { Prisma } from '@prisma/client'
import type { NextApiRequest, NextApiResponse } from 'next'

import { requirePlatformAccess, requireSuperAdmin } from '../../../../../lib/auth/platform-authorization'
import { readPlatformConfiguration } from '../../../../../lib/organization/platform-configuration'
import { getOrganizationDetail, isOrganizationStatus, listAvailableUsers, normalizeSlug, parseBranding, parseModules, updateOrganization } from '../../../../../lib/platform/organizations'

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!id) return res.status(400).json({ error: 'Organisation requise' })
  if (req.method === 'GET') {
    const actor = await requirePlatformAccess(req, res)
    if (!actor) return
    const organization = await getOrganizationDetail(id)
    if (!organization) return res.status(404).json({ error: 'Organisation introuvable' })
    return res.status(200).json({ organization, configuration: await readPlatformConfiguration(id), availableUsers: await listAvailableUsers(id), platformRole: actor.platformRole })
  }
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }
  const actor = await requireSuperAdmin(req, res)
  if (!actor) return
  const name = req.body?.name === undefined ? undefined : text(req.body.name)
  const slug = req.body?.slug === undefined ? undefined : normalizeSlug(text(req.body.slug))
  const status = req.body?.status
  const modules = req.body?.enabledModules === undefined ? undefined : parseModules(req.body.enabledModules)
  const branding = parseBranding(req.body || {})
  const operatingBaseAddress = req.body?.operatingBaseAddress === undefined ? undefined : text(req.body.operatingBaseAddress) || null
  const operatingBasePlaceId = req.body?.operatingBasePlaceId === undefined ? undefined : text(req.body.operatingBasePlaceId) || null
  const coordinate = (value: unknown) => value === null || value === '' ? null : typeof value === 'number' && Number.isFinite(value) ? value : undefined
  const operatingBaseLat = req.body?.operatingBaseLat === undefined ? undefined : coordinate(req.body.operatingBaseLat)
  const operatingBaseLng = req.body?.operatingBaseLng === undefined ? undefined : coordinate(req.body.operatingBaseLng)
  const invalidBase = operatingBaseLat === undefined && req.body?.operatingBaseLat !== undefined || operatingBaseLng === undefined && req.body?.operatingBaseLng !== undefined || (operatingBaseLat === null) !== (operatingBaseLng === null) || typeof operatingBaseLat === 'number' && (operatingBaseLat < -90 || operatingBaseLat > 90 || operatingBaseLng! < -180 || operatingBaseLng! > 180)
  const unresolvedBase = Boolean(operatingBaseAddress) && (!operatingBasePlaceId || typeof operatingBaseLat !== 'number' || typeof operatingBaseLng !== 'number')
  if ((name !== undefined && !name) || (slug !== undefined && !slug) || (status !== undefined && !isOrganizationStatus(status)) || modules === null || !branding || invalidBase || unresolvedBase) return res.status(400).json({ error: unresolvedBase ? 'Sélectionnez une adresse Google valide pour la base d’exploitation' : 'Modification invalide' })
  try {
    const organization = await updateOrganization({ actorUserId: actor.id, organizationId: id, name, slug, status, enabledModules: modules, ...branding, operatingBaseAddress, operatingBasePlaceId, operatingBaseLat, operatingBaseLng })
    return res.status(200).json({ organization })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return res.status(404).json({ error: 'Organisation introuvable' })
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'Slug déjà utilisé' })
    console.error('Platform organization update failed', error)
    return res.status(500).json({ error: 'Modification impossible' })
  }
}
