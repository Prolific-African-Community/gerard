import { createHmac, timingSafeEqual } from 'crypto'

import type { SnapshotTokenPayload } from './types'

function secret() {
  const value = process.env.JWT_SECRET
  if (!value) throw new Error('JWT_SECRET is missing')
  return value
}

function encode(value: string) {
  return Buffer.from(value).toString('base64url')
}

function sign(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url')
}

export function createSnapshotToken(payload: SnapshotTokenPayload) {
  const body = encode(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

export function verifySnapshotToken(
  token: string,
  expectedUserId: string
): SnapshotTokenPayload | null {
  const [body, signature] = token.split('.')
  if (!body || !signature) return null
  const expected = sign(body)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(
      new Uint8Array(actualBuffer),
      new Uint8Array(expectedBuffer)
    )
  ) {
    return null
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    ) as SnapshotTokenPayload
    if (
      payload.userId !== expectedUserId ||
      !payload.simulationId ||
      !payload.fingerprint ||
      new Date(payload.expiresAt).getTime() <= Date.now()
    ) {
      return null
    }
    return payload
  } catch {
    return null
  }
}
