import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { PlatformConfigurationRequest } from '@prolific/gerard-core'

const MAX_SKEW_SECONDS = 300
const seenNonces = new Map<string, number>()

function secret() {
  const value = process.env.GERARD_PLATFORM_INSTANCE_SHARED_SECRET
  if (!value) throw new Error('PLATFORM_INSTANCE_SECRET_REQUIRED')
  return value
}

function canonical(request: PlatformConfigurationRequest) {
  return JSON.stringify({ version: request.version, application: request.application, organizationId: request.organizationId, action: request.action, payload: request.payload, timestamp: request.timestamp, nonce: request.nonce })
}

export function createPlatformConfigurationRequest(input: Omit<PlatformConfigurationRequest, 'version' | 'timestamp' | 'nonce'> & { timestamp?: number; nonce?: string }) {
  const request: PlatformConfigurationRequest = { ...input, version: 1, timestamp: input.timestamp ?? Math.floor(Date.now() / 1000), nonce: input.nonce ?? randomUUID() }
  const signature = createHmac('sha256', secret()).update(canonical(request)).digest('hex')
  return { request, signature }
}

export function verifyPlatformConfigurationRequest(request: unknown, signature: unknown, expectedApplication: string, expectedOrganizationId: string) {
  if (!request || typeof request !== 'object' || typeof signature !== 'string') return { ok: false as const, reason: 'INVALID_REQUEST' }
  const value = request as Partial<PlatformConfigurationRequest>
  if (value.version !== 1 || value.application !== expectedApplication || value.organizationId !== expectedOrganizationId || typeof value.timestamp !== 'number' || typeof value.nonce !== 'string' || value.nonce.length < 16) return { ok: false as const, reason: 'INVALID_REQUEST' }
  if (Math.abs(Math.floor(Date.now() / 1000) - value.timestamp) > MAX_SKEW_SECONDS) return { ok: false as const, reason: 'REQUEST_EXPIRED' }
  const key = `${value.application}:${value.nonce}`
  const seenUntil = seenNonces.get(key)
  if (seenUntil && seenUntil > Date.now()) return { ok: false as const, reason: 'REQUEST_REPLAYED' }
  let expected: string
  try { expected = createHmac('sha256', secret()).update(canonical(value as PlatformConfigurationRequest)).digest('hex') } catch { return { ok: false as const, reason: 'PLATFORM_INSTANCE_SECRET_REQUIRED' } }
  const provided = Buffer.from(signature, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided as unknown as Uint8Array, expectedBuffer as unknown as Uint8Array)) return { ok: false as const, reason: 'INVALID_SIGNATURE' }
  seenNonces.set(key, Date.now() + (MAX_SKEW_SECONDS * 1000))
  for (const [nonceKey, expires] of Array.from(seenNonces.entries())) if (expires <= Date.now()) seenNonces.delete(nonceKey)
  return { ok: true as const }
}
