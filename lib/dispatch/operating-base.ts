import { requireActiveOrganizationId } from '../auth/organization-context'
import { prisma } from '../prisma'
import { configuredOperatingBase, type OperatingBasePosition } from './base-location'

export type ResolvedOperatingBase = OperatingBasePosition & {
  address?: string | null
  placeId?: string | null
  source: 'ORGANIZATION' | 'ENVIRONMENT'
}

function validCoordinate(latitude: number | null, longitude: number | null) {
  return typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
}

/** One server-side precedence rule used by planning and routing. */
export async function resolveOperatingBase(organizationId = requireActiveOrganizationId()): Promise<ResolvedOperatingBase | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      operatingBaseAddress: true,
      operatingBasePlaceId: true,
      operatingBaseLat: true,
      operatingBaseLng: true,
    },
  })
  if (organization && validCoordinate(organization.operatingBaseLat, organization.operatingBaseLng)) {
    return {
      latitude: organization.operatingBaseLat!,
      longitude: organization.operatingBaseLng!,
      label: organization.operatingBaseAddress || 'Base d’exploitation',
      address: organization.operatingBaseAddress,
      placeId: organization.operatingBasePlaceId,
      source: 'ORGANIZATION',
    }
  }
  const fallback = configuredOperatingBase()
  return fallback ? { ...fallback, source: 'ENVIRONMENT' } : null
}
