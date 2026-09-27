'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import type { GerardAssistantAction, GerardAssistantApplicationOutcome, GerardAssistantConfirmApplyAction, GerardAssistantReply } from '../../../lib/dispatch/intelligence/types'
import type { GerardInsightReport } from '../../../lib/dispatch/intelligence/insights'
import { applicationSettled, applyRequested, cancelRequested, confirmRequested, questionAsked } from '../../../lib/dispatch/intelligence/assistant-interaction'
import type { AssistantTransition } from '../../../lib/dispatch/intelligence/assistant-interaction'
import { GerardInsightsSection, type InsightActionHandlers } from './GerardInsightsPanel'

type Message = { id: string; role: 'user' | 'assistant'; text: string; reply?: GerardAssistantReply }

const shortcuts = [
  'Analyser le planning',
  'Voir les optimisations possibles',
  'Pourquoi cette mission est affectée ici ?',
  'Vérifier les conflits',
  'Réduire les kilomètres à vide',
]

/** Issue d'application traduite en registre visuel : succès, refus, ou interdit. */
const outcomeTone: Record<GerardAssistantApplicationOutcome['status'], { label: string; className: string }> = {
  APPLIED: { label: 'Appliqué', className: 'bg-[#eefad7] text-[#3d5a0d] ring-1 ring-inset ring-[#cbe79a]' },
  ALREADY_APPLIED: { label: 'Déjà appliqué', className: 'bg-[#eefad7] text-[#3d5a0d] ring-1 ring-inset ring-[#cbe79a]' },
  STALE: { label: 'Planning modifié', className: 'bg-[#fdf3e0] text-[#7a551a] ring-1 ring-inset ring-[#ecd6a6]' },
  CONFLICT: { label: 'Conflit', className: 'bg-[#fdf3e0] text-[#7a551a] ring-1 ring-inset ring-[#ecd6a6]' },
  INVALID: { label: 'Refusé', className: 'bg-[#fdecea] text-[#8d2f22] ring-1 ring-inset ring-[#f0c4bd]' },
  FORBIDDEN: { label: 'Non autorisé', className: 'bg-[#fdecea] text-[#8d2f22] ring-1 ring-inset ring-[#f0c4bd]' },
}

export function GerardAssistantPanel({
  open,
  onClose,
  weekStart,
  missionReference,
  onApplied,
  insights,
  insightsLoading,
  insightsError,
  onSimulate,
  onOpenMission,
}: {
  open: boolean
  onClose: () => void
  weekStart: string
  missionReference?: string | null
  onApplied?: () => void | Promise<void>
  /** Rapport partagé avec la pastille de la barre de contrôles. */
  insights?: GerardInsightReport | null
  insightsLoading?: boolean
  insightsError?: string | null
} & InsightActionHandlers) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationContext, setConversationContext] = useState<{ missionReference?: string; suggestionId?: string }>(() => ({ missionReference: missionReference ?? undefined }))
  /** Action d'application en attente de confirmation explicite, émise par le serveur. */
  const [pendingApply, setPendingApply] = useState<GerardAssistantConfirmApplyAction | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [open, messages, loading])
  useEffect(() => { setMessages([]); setError(null); setPendingApply(null); setConversationContext({ missionReference: missionReference ?? undefined }) }, [weekStart])
  useEffect(() => { if (missionReference) setConversationContext((current) => ({ ...current, missionReference })) }, [missionReference])
  if (!open) return null

  /** Toute requête part d'une transition : rien n'est envoyé hors de ce chemin. */
  async function dispatchTransition(transition: AssistantTransition) {
    setPendingApply(transition.pending)
    if (!transition.request) return
    const request = transition.request
    const question = request.message.trim()
    if (!question || loading) return
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text: question }])
    setInput(''); setLoading(true); setError(null)
    try {
      const response = await fetch('/api/dispatch/intelligence/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Assistant indisponible')
      const resolvedMission = body.data?.facts?.find((item: { label?: string; value?: unknown }) => item.label === 'Mission')?.value
      const resolvedSuggestion = body.data?.suggestions?.[0]?.id
      setConversationContext((current) => ({ ...current, ...(typeof resolvedMission === 'string' ? { missionReference: resolvedMission } : {}), ...(typeof resolvedSuggestion === 'string' ? { suggestionId: resolvedSuggestion } : {}) }))
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', text: body.answer, reply: body }])
      if (request.confirmation) {
        const settled = applicationSettled(body.application ?? null)
        setPendingApply(settled.pending)
        if (settled.refreshPlanning) await onApplied?.()
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : ''
      setError(message && message !== 'Failed to fetch' ? message : 'Gerard ne peut pas consulter le planning pour le moment.')
    } finally { setLoading(false) }
  }

  function ask(message: string, suggestionId?: string) {
    return dispatchTransition(questionAsked({ message, weekStart, conversationContext, pending: pendingApply, suggestionId }))
  }

  function submit(event: FormEvent) { event.preventDefault(); void ask(input) }

  const started = messages.length > 0

  return <div className="fixed inset-0 z-[95] bg-[#11120f]/20 backdrop-blur-[2px]" onClick={onClose}>
    <aside
      role="dialog"
      aria-label="Assistant Gerard"
      aria-modal="true"
      onClick={(event) => event.stopPropagation()}
      className="absolute inset-x-0 bottom-0 flex max-h-[90vh] min-h-[66vh] flex-col rounded-t-[26px] bg-[#fbfcfa] shadow-[0_-8px_40px_rgba(17,18,15,0.18)] md:inset-y-0 md:left-auto md:min-h-0 md:w-[468px] md:rounded-none md:shadow-[-12px_0_40px_rgba(17,18,15,0.10)]"
    >
      <header className="flex items-center gap-3 border-b border-black/[0.06] bg-white px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] bg-[#16180f]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-[#c8f06a]">
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
            <circle cx="12" cy="12" r="4.2" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[#11130f]">Assistant Gerard</h2>
          <p className="mt-px truncate text-[11.5px] text-[#8a9080]">Analyse et simulation · modification après confirmation</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer l’assistant"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6c7366] transition-colors hover:bg-black/[0.05]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {/* Les points d'attention ouvrent la conversation, puis s'effacent
            d'eux-mêmes pour laisser la place aux échanges. */}
        <GerardInsightsSection
          report={insights ?? null}
          loading={insightsLoading}
          error={insightsError}
          defaultOpen={!started}
          onSimulate={onSimulate}
          onOpenMission={onOpenMission}
        />

        {!started ? <div className="pt-1">
          <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[#a3a99b]">Questions fréquentes</p>
          <div className="flex flex-wrap gap-1.5">
            {shortcuts.map((item) => <button
              key={item}
              type="button"
              onClick={() => void ask(item)}
              className="rounded-full border border-black/[0.07] bg-white px-3 py-1.5 text-[12px] font-medium text-[#4e554a] transition-colors hover:border-[#c8e08a] hover:bg-[#f6fced]"
            >{item}</button>)}
          </div>
        </div> : null}

        {messages.map((message) => message.role === 'user'
          ? <div key={message.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-[16px] rounded-br-[6px] bg-[#16180f] px-3.5 py-2.5 text-[13px] leading-[19px] text-white">{message.text}</p>
            </div>
          : <AssistantMessage
              key={message.id}
              message={message}
              onSimulate={(suggestionId) => void ask('Simule cette proposition', suggestionId)}
              onRequestApply={(action) => void dispatchTransition(applyRequested(action))}
            />)}

        {pendingApply ? <AssistantApplyConfirmation
          action={pendingApply}
          loading={loading}
          onCancel={() => void dispatchTransition(cancelRequested())}
          onConfirm={() => void dispatchTransition(confirmRequested({ pending: pendingApply, weekStart, conversationContext }))}
        /> : null}

        {loading ? <div role="status" className="flex items-center gap-2 px-1 text-[12px] font-medium text-[#8a9080]">
          <span className="flex gap-1" aria-hidden>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#9bd33a]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#9bd33a] [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#9bd33a] [animation-delay:300ms]" />
          </span>
          Gerard consulte le planning…
        </div> : null}

        {error ? <div role="alert" className="rounded-2xl bg-[#fdecea] px-3.5 py-2.5 text-[12px] font-medium text-[#8d2f22] ring-1 ring-inset ring-[#f0c4bd]">{error}</div> : null}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="border-t border-black/[0.06] bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2 rounded-[18px] border border-black/[0.07] bg-[#f7f8f4] p-1.5 transition-colors focus-within:border-[#c8e08a] focus-within:bg-white">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(input) }
            }}
            maxLength={1000}
            rows={1}
            placeholder="Demander à Gerard…"
            aria-label="Question pour Gerard"
            className="max-h-28 min-h-[38px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[13px] leading-[19px] outline-none placeholder:text-[#9aa192]"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            aria-label="Envoyer"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] bg-[#16180f] text-white transition-opacity hover:opacity-90 disabled:opacity-25"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m5 12 14-7-5 14-2.5-5.5L5 12Z" /></svg>
          </button>
        </div>
      </form>
    </aside>
  </div>
}

/**
 * Réponse de Gerard : le texte, puis ce qu'il permet de faire. Une issue
 * d'application est annoncée par un bandeau de statut, pas noyée dans la phrase.
 */
function AssistantMessage({
  message,
  onSimulate,
  onRequestApply,
}: {
  message: Message
  onSimulate: (suggestionId: string) => void
  onRequestApply: (action: GerardAssistantConfirmApplyAction) => void
}) {
  const outcome = message.reply?.application ?? null
  const actions = message.reply?.actions ?? []
  const warnings = message.reply?.warnings ?? []
  return <div className="rounded-[16px] rounded-bl-[6px] border border-black/[0.06] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(17,18,15,0.04)]">
    {outcome ? <p className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${outcomeTone[outcome.status].className}`}>
      {outcomeTone[outcome.status].label}
    </p> : null}
    <p className="text-[13px] leading-[20px] text-[#23261f]">{message.text}</p>

    {warnings.length ? <details className="mt-2.5 rounded-xl bg-black/[0.025] px-2.5 py-1.5">
      <summary className="cursor-pointer text-[11px] font-semibold text-[#5f665b]">Détails vérifiés ({warnings.length})</summary>
      <ul className="mt-1.5 space-y-1 text-[11.5px] leading-[17px] text-[#71786a]">
        {warnings.map((warning) => <li key={warning} className="flex gap-1.5"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#b6bcae]" />{warning}</li>)}
      </ul>
    </details> : null}

    {actions.length ? <div className="mt-2.5 flex flex-wrap gap-1.5">
      {actions.map((action: GerardAssistantAction) => action.type === 'CONFIRM_APPLY'
        ? <button
            key={`apply-${action.suggestionId}`}
            type="button"
            onClick={() => onRequestApply(action)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#c8f06a] px-3 py-1.5 text-[12px] font-semibold text-[#1d2810] transition-colors hover:bg-[#bde95a]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="m5 13 4 4L19 7" /></svg>
            {action.label}
          </button>
        : <button
            key={action.suggestionId}
            type="button"
            onClick={() => onSimulate(action.suggestionId)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.08] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#3f4539] transition-colors hover:border-[#c8e08a] hover:bg-[#f6fced]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7v5l3 2" /></svg>
            {action.label}
          </button>)}
    </div> : null}
  </div>
}

/**
 * Bloc de confirmation d'une application depuis le chat. Purement présentationnel :
 * il nomme la mission concernée et n'expose que deux issues, dont une seule écrit.
 */
export function AssistantApplyConfirmation({ action, loading, onCancel, onConfirm }: { action: GerardAssistantConfirmApplyAction; loading?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div role="group" aria-label="Confirmer l’application" className="rounded-[16px] border border-[#cbe79a] bg-[#f6fced] p-3.5">
    <p className="flex items-start gap-2 text-[13px] font-semibold leading-[19px] text-[#1d2810]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-[#5f8a16]"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
      Cette action modifiera l’affectation de {action.missionReference}. Confirmer ?
    </p>
    <p className="mt-1.5 pl-[22px] text-[11.5px] leading-[17px] text-[#59634d]">{action.summary}</p>
    <div className="mt-3 flex gap-2 pl-[22px]">
      <button type="button" onClick={onCancel} className="rounded-lg border border-black/[0.08] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#4e554a] transition-colors hover:bg-black/[0.03]">Annuler</button>
      <button type="button" disabled={loading} onClick={onConfirm} className="rounded-lg bg-[#16180f] px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-45">{loading ? 'Application…' : 'Confirmer'}</button>
    </div>
  </div>
}
