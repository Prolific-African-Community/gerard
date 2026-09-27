import { createHmac, randomUUID, timingSafeEqual } from 'crypto'

import { logIntelligenceEvent } from './observability'
import type { GerardAssistantConfirmApplyAction } from './types'

/**
 * Une action d'application proposée par l'assistant est signée côté serveur,
 * comme le jeton de simulation d'auto-planning. Le client ne transporte qu'un
 * jeton opaque : ni le modèle de langage ni le navigateur ne peuvent fabriquer
 * ou modifier la suggestion, l'empreinte de snapshot ou la clé d'idempotence
 * réellement utilisées à l'écriture.
 */
export type PendingApplyPayload = {
  userId: string
  suggestionId: string
  weekStart: string
  snapshotFingerprint: string
  /**
   * Empreinte des faits confirmés (kilomètres, économie, score, routes). Le
   * snapshot ne couvre pas les routes : sans cela, l'ampleur du gain pourrait
   * changer entre la confirmation et l'écriture.
   */
  evidenceFingerprint: string
  idempotencyKey: string
  expiresAt: string
}

const defaultLifetimeMs = 15 * 60 * 1000

function secret() {
  const value = process.env.JWT_SECRET
  if (!value) throw new Error('JWT_SECRET is missing')
  return value
}

function sign(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url')
}

export function createPendingApplyToken(
  input: Omit<PendingApplyPayload, 'idempotencyKey' | 'expiresAt'> & {
    idempotencyKey?: string
    lifetimeMs?: number
    now?: Date
  }
) {
  const payload: PendingApplyPayload = {
    userId: input.userId,
    suggestionId: input.suggestionId,
    weekStart: input.weekStart,
    snapshotFingerprint: input.snapshotFingerprint,
    evidenceFingerprint: input.evidenceFingerprint,
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    expiresAt: new Date(
      (input.now?.getTime() ?? Date.now()) + (input.lifetimeMs ?? defaultLifetimeMs)
    ).toISOString(),
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return { token: `${body}.${sign(body)}`, payload }
}

/**
 * Primitive unique d'émission d'une action d'application. Le panneau de
 * suggestions et l'assistant passent tous les deux par ici : la clé
 * d'idempotence est donc toujours émise par le serveur, et les paramètres
 * d'écriture voyagent dans le jeton signé, pas dans le corps de la requête.
 */
export function buildPendingApplyAction(input: {
  userId: string
  weekStart: string
  suggestionId: string
  snapshotFingerprint: string
  evidenceFingerprint: string
  missionReference: string
  summary: string
  label?: string
}): GerardAssistantConfirmApplyAction {
  const { token, payload } = createPendingApplyToken({
    userId: input.userId,
    suggestionId: input.suggestionId,
    weekStart: input.weekStart,
    snapshotFingerprint: input.snapshotFingerprint,
    evidenceFingerprint: input.evidenceFingerprint,
  })
  // Le jeton lui-même n'est jamais journalisé.
  logIntelligenceEvent('confirmation.offered', {
    week: input.weekStart,
    suggestionId: input.suggestionId,
    missionId: input.missionReference,
    userId: input.userId,
  })
  return {
    type: 'CONFIRM_APPLY',
    label: input.label ?? `Appliquer cette suggestion sur ${input.missionReference}`,
    suggestionId: input.suggestionId,
    missionReference: input.missionReference,
    snapshotFingerprint: input.snapshotFingerprint,
    idempotencyKey: payload.idempotencyKey,
    summary: input.summary,
    token,
  }
}

export function verifyPendingApplyToken(
  token: string,
  expectedUserId: string,
  now: Date = new Date()
): PendingApplyPayload | null {
  const [body, signature] = token.split('.')
  if (!body || !signature) return null
  const actual = Buffer.from(signature)
  const expected = Buffer.from(sign(body))
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(new Uint8Array(actual), new Uint8Array(expected))
  ) {
    return null
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    ) as PendingApplyPayload
    if (
      payload.userId !== expectedUserId ||
      !payload.suggestionId ||
      !payload.weekStart ||
      !payload.snapshotFingerprint ||
      !payload.evidenceFingerprint ||
      !payload.idempotencyKey ||
      new Date(payload.expiresAt).getTime() <= now.getTime()
    ) {
      return null
    }
    return payload
  } catch {
    return null
  }
}
