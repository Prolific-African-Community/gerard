import type {
  GerardAssistantApplicationOutcome,
  GerardAssistantConfirmApplyAction,
  GerardAssistantReply,
} from './types'

/**
 * Machine d'interaction du chat Gerard. Elle est volontairement séparée du
 * composant React : c'est ici que se décide quand une requête part, et si elle
 * porte une confirmation. Une transition qui ne rend pas de `request` ne peut
 * produire aucune écriture, ce qui rend la règle testable sans navigateur.
 */
export type AssistantRequestBody = {
  message: string
  weekStart: string
  conversationContext: { missionReference?: string; suggestionId?: string }
  /** Derniers échanges, pour que l'agent comprenne les relances (« et Marc ? »). */
  history?: Array<{ role: 'user' | 'assistant'; text: string }>
  confirmation?: { token: string }
}

export type AssistantTransition = {
  /** Action d'application en attente de confirmation explicite. */
  pending: GerardAssistantConfirmApplyAction | null
  /** Requête à envoyer, ou `null` quand la transition reste locale. */
  request: AssistantRequestBody | null
  /** Vrai seulement après une application effective : le planning doit être relu. */
  refreshPlanning: boolean
}

export const confirmationMessage = 'Je confirme l’application de cette suggestion.'

function body(input: {
  message: string
  weekStart: string
  conversationContext?: { missionReference?: string; suggestionId?: string }
  suggestionId?: string
  history?: AssistantRequestBody['history']
  confirmation?: { token: string }
}): AssistantRequestBody {
  return {
    message: input.message,
    weekStart: input.weekStart,
    conversationContext: {
      ...input.conversationContext,
      suggestionId: input.suggestionId ?? input.conversationContext?.suggestionId,
    },
    ...(input.history?.length && !input.confirmation ? { history: input.history } : {}),
    ...(input.confirmation ? { confirmation: input.confirmation } : {}),
  }
}

/** Question libre ou raccourci : jamais de confirmation. */
export function questionAsked(input: {
  message: string
  weekStart: string
  conversationContext?: { missionReference?: string; suggestionId?: string }
  pending: GerardAssistantConfirmApplyAction | null
  suggestionId?: string
  history?: AssistantRequestBody['history']
}): AssistantTransition {
  return { pending: input.pending, request: body(input), refreshPlanning: false }
}

/** Clic sur « Appliquer » : ouvre la confirmation, n'envoie rien. */
export function applyRequested(action: GerardAssistantConfirmApplyAction): AssistantTransition {
  return { pending: action, request: null, refreshPlanning: false }
}

/** Clic sur « Annuler » : referme la confirmation, n'envoie rien. */
export function cancelRequested(): AssistantTransition {
  return { pending: null, request: null, refreshPlanning: false }
}

/**
 * Clic sur « Confirmer » : seule transition qui porte un jeton de confirmation.
 * L'action reste en attente tant que le serveur n'a pas répondu.
 */
export function confirmRequested(input: {
  pending: GerardAssistantConfirmApplyAction | null
  weekStart: string
  conversationContext?: { missionReference?: string; suggestionId?: string }
}): AssistantTransition {
  if (!input.pending) return { pending: null, request: null, refreshPlanning: false }
  return {
    pending: input.pending,
    request: body({
      message: confirmationMessage,
      weekStart: input.weekStart,
      conversationContext: input.conversationContext,
      suggestionId: input.pending.suggestionId,
      confirmation: { token: input.pending.token },
    }),
    refreshPlanning: false,
  }
}

/**
 * Réponse à une confirmation : l'action en attente est consommée dans tous les
 * cas, et le planning n'est relu que si une application a réellement eu lieu.
 */
export function applicationSettled(
  application: GerardAssistantApplicationOutcome | null
): AssistantTransition {
  return {
    pending: null,
    request: null,
    refreshPlanning: application?.status === 'APPLIED' || application?.status === 'ALREADY_APPLIED',
  }
}

export function confirmApplyActionOf(reply: Pick<GerardAssistantReply, 'actions'>) {
  return reply.actions.find(
    (item): item is GerardAssistantConfirmApplyAction => item.type === 'CONFIRM_APPLY'
  ) ?? null
}
