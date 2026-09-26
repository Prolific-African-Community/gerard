import type { IncomingMessage } from 'http'
import { domainToASCII } from 'url'

import { prisma } from '../prisma'

export type HostnameSource = 'x-vercel-forwarded-host' | 'host' | 'none'

export type RequestOrganizationResolution = {
  hostname: string | null
  pathname: string
  source: HostnameSource
  organizationId: string | null
  domainId: string | null
  status: 'resolved' | 'local' | 'unknown' | 'missing'
}

export function normalizeHostname(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value?.split(',')[0]
  if (!first) return null
  const raw = first.trim().toLowerCase().replace(/^https?:\/\//, '')
  const bracketed = raw.match(/^\[([^\]]+)\](?::\d+)?$/)
  const withoutPort = bracketed ? bracketed[1] : raw.replace(/:\d+$/, '')
  const withoutDot = withoutPort.replace(/\.$/, '')
  const ascii = domainToASCII(withoutDot)
  return ascii || null
}

export function normalizePathPrefix(value: unknown) {
  if (value === null || value === undefined || value === '' || value === '/') return ''
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^\/[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(trimmed) || trimmed.includes('//') || trimmed.includes('..')) return null
  return trimmed.replace(/\/$/, '')
}

export function getTrustedRequestHostname(req: IncomingMessage) {
  if (process.env.VERCEL === '1') {
    const vercelHost = normalizeHostname(req.headers['x-vercel-forwarded-host'])
    if (vercelHost) return { hostname: vercelHost, source: 'x-vercel-forwarded-host' as const }
  }
  return { hostname: normalizeHostname(req.headers.host), source: req.headers.host ? 'host' as const : 'none' as const }
}

function isLocalHostname(hostname: string | null) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || Boolean(hostname?.endsWith('.localhost'))
}

function pathMatches(pathname: string, prefix: string) {
  return prefix === '' || pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export async function resolveOrganizationFromRequest(req: IncomingMessage): Promise<RequestOrganizationResolution> {
  const { hostname, source } = getTrustedRequestHostname(req)
  const pathname = (req.url || '/').split('?')[0] || '/'
  if (!hostname) return { hostname, pathname, source, organizationId: null, domainId: null, status: process.env.NODE_ENV !== 'production' ? 'local' : 'missing' }
  if (process.env.NODE_ENV !== 'production' && isLocalHostname(hostname)) {
    return { hostname, pathname, source, organizationId: null, domainId: null, status: 'local' }
  }
  const instanceOrganizationId = process.env.GERARD_INSTANCE_ORGANIZATION_ID?.trim()
  if (instanceOrganizationId) {
    const organization = await prisma.organization.findFirst({
      where: { id: instanceOrganizationId, status: 'ACTIVE' },
      select: { id: true },
    })
    return organization
      ? { hostname, pathname, source, organizationId: organization.id, domainId: null, status: 'resolved' }
      : { hostname, pathname, source, organizationId: null, domainId: null, status: 'unknown' }
  }
  const mappings = await prisma.organizationDomain.findMany({
    where: { hostname, isActive: true, organization: { status: 'ACTIVE' } },
    orderBy: { pathPrefix: 'desc' },
    select: { id: true, organizationId: true, pathPrefix: true },
  })
  const match = mappings.find((mapping) => pathMatches(pathname, mapping.pathPrefix))
  return match
    ? { hostname, pathname, source, organizationId: match.organizationId, domainId: match.id, status: 'resolved' }
    : { hostname, pathname, source, organizationId: null, domainId: null, status: 'unknown' }
}

export function assertDomainSessionCoherence(resolution: RequestOrganizationResolution, activeOrganizationId: string) {
  if (resolution.status === 'local') return
  if (resolution.status !== 'resolved') throw new Error('UNKNOWN_ORGANIZATION_DOMAIN')
  if (resolution.organizationId !== activeOrganizationId) throw new Error('DOMAIN_ORGANIZATION_MISMATCH')
}

export function isConfiguredPlatformHostname(hostname: string | null) {
  if (!hostname) return false
  const configured = (process.env.GERARD_PLATFORM_HOSTNAMES || '')
    .split(',')
    .map(normalizeHostname)
    .filter(Boolean)
  return configured.includes(hostname)
}
