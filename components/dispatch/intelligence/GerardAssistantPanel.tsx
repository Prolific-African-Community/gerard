'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import type { GerardAssistantAction, GerardAssistantApplicationOutcome, GerardAssistantConfirmApplyAction, GerardAssistantReply } from '../../../lib/dispatch/intelligence/types'
import type { GerardInsightReport } from '../../../lib/dispatch/intelligence/insights'
import { applicationSettled, applyRequested, cancelRequested, confirmRequested, questionAsked } from '../../../lib/dispatch/intelligence/assistant-interaction'
import type { AssistantTransition } from '../../../lib/dispatch/intelligence/assistant-interaction'
import { GerardInsightsSection, type InsightActionHandlers } from './GerardInsightsPanel'

type Message = { id: string; role: 'user' | 'assistant'; text: string; reply?: GerardAssistantReply }

// Simples exemples de départ : toute question libre suit le même chemin.
const shortcuts = [
  'Qu’est-ce qui mérite mon attention ?',
  'Pourquoi certaines missions ne sont pas planifiées ?',
  'Où peut-on améliorer le planning ?',
  'Que ferais-tu en priorité ?',
]

/**
 * Issue d'application traduite en registre visuel. Deux familles seulement —
 * aboutie ou refusée — pour ne pas transformer la conversation en nuancier.
 */
const outcomeTone: Record<GerardAssistantApplicationOutcome['status'], { label: string; dot: string; text: string }> = {
  APPLIED: { label: 'Appliqué', dot: 'bg-[#7fb833]', text: 'text-[#4d7317]' },
  ALREADY_APPLIED: { label: 'Déjà appliqué', dot: 'bg-[#7fb833]', text: 'text-[#4d7317]' },
  STALE: { label: 'Planning modifié', dot: 'bg-[#e8760d]', text: 'text-[#9a5407]' },
  CONFLICT: { label: 'Conflit', dot: 'bg-[#e8760d]', text: 'text-[#9a5407]' },
  INVALID: { label: 'Refusé', dot: 'bg-[#d4503f]', text: 'text-[#a33a2c]' },
  FORBIDDEN: { label: 'Non autorisé', dot: 'bg-[#d4503f]', text: 'text-[#a33a2c]' },
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
    const history = messages.slice(-12).map((item) => ({ role: item.role, text: item.text.slice(0, 1200) }))
    return dispatchTransition(questionAsked({ message, weekStart, conversationContext, pending: pendingApply, suggestionId, history }))
  }

  function submit(event: FormEvent) { event.preventDefault(); void ask(input) }

  const started = messages.length > 0

  return <div className="fixed inset-0 z-[95] bg-[#11120f]/25 backdrop-blur-[3px]" onClick={onClose}>
    <aside
      role="dialog"
      aria-label="Assistant Gerard"
      aria-modal="true"
      onClick={(event) => event.stopPropagation()}
      className="absolute inset-x-0 bottom-0 flex max-h-[92vh] min-h-[70vh] flex-col overflow-hidden rounded-t-[28px] bg-[#fbfcfa] shadow-[0_-10px_50px_rgba(17,18,15,0.2)] md:inset-y-0 md:left-auto md:min-h-0 md:w-[560px] md:rounded-none md:shadow-[-16px_0_50px_rgba(17,18,15,0.12)] lg:w-[620px]"
    >
      {/* En-tête : une seule ligne de force, aucun cadre. */}
      <header className="flex items-start gap-3.5 bg-white px-6 pb-5 pt-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#16180f]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-[#c8f06a]" aria-hidden>
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
            <circle cx="12" cy="12" r="4.2" />
          </svg>
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="text-[19px] font-semibold leading-tight tracking-[-0.025em] text-[#11130f]">Assistant Gerard</h2>
          <p className="mt-1 text-[13px] leading-[19px] text-[#7c8374]">Analyse, simulation et optimisation du planning</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer l’assistant"
          className="-mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-[#6c7366] transition-colors hover:bg-black/[0.055]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[18px] w-[18px]" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        {/* Les points à vérifier ouvrent la séance, puis se replient d'eux-mêmes. */}
        <div className="pb-2">
          <GerardInsightsSection
            report={insights ?? null}
            loading={insightsLoading}
            error={insightsError}
            defaultOpen={!started}
            onSimulate={onSimulate}
            onOpenMission={onOpenMission}
          />
        </div>

        {!started ? <div className="px-2 pt-4">
          <p className="text-[13px] font-medium text-[#9aa192]">Suggestions</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {shortcuts.map((item) => <button
              key={item}
              type="button"
              onClick={() => void ask(item)}
              className="rounded-full border-0 bg-black/[0.04] px-3.5 py-2 text-[13px] font-medium text-[#4e554a] transition-colors hover:bg-[#eef7dc] hover:text-[#3b5a0c]"
            >{item}</button>)}
          </div>
        </div> : null}

        {started ? <div className="space-y-5 pt-4">
          {messages.map((message) => message.role === 'user'
            ? <div key={message.id} className="flex justify-end pl-8">
                <p className="rounded-[18px] rounded-br-[8px] bg-[#16180f] px-4 py-2.5 text-[14px] leading-[21px] text-white">{message.text}</p>
              </div>
            : <AssistantMessage
                key={message.id}
                message={message}
                onSimulate={(suggestionId) => void ask('Simule cette proposition', suggestionId)}
                onRequestApply={(action) => void dispatchTransition(applyRequested(action))}
              />)}
        </div> : null}

        {pendingApply ? <div className="pt-5">
          <AssistantApplyConfirmation
            action={pendingApply}
            loading={loading}
            onCancel={() => void dispatchTransition(cancelRequested())}
            onConfirm={() => void dispatchTransition(confirmRequested({ pending: pendingApply, weekStart, conversationContext }))}
          />
        </div> : null}

        {loading ? <div role="status" className="flex items-center gap-2 px-2 pt-5 text-[13px] text-[#8a9080]">
          <span className="flex gap-1" aria-hidden>
            <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[#9bd33a]" />
            <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[#9bd33a] [animation-delay:150ms]" />
            <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[#9bd33a] [animation-delay:300ms]" />
          </span>
          Gerard consulte le planning…
        </div> : null}

        {error ? <p role="alert" className="mt-5 rounded-[16px] bg-[#fdeeeb] px-4 py-3 text-[13px] font-medium leading-[20px] text-[#a33a2c]">{error}</p> : null}
        <div ref={endRef} />
      </div>

      {/* Barre de composition : posée sur le fond, sans contour. */}
      <div className="bg-[#fbfcfa] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <form onSubmit={submit}>
          <div className="flex items-end gap-2 rounded-[22px] bg-black/[0.045] p-2 transition-all duration-200 focus-within:bg-white focus-within:shadow-[0_2px_14px_rgba(17,18,15,0.09)]">
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
              className="max-h-32 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-[14px] leading-[21px] text-[#14160f] outline-none placeholder:text-[#969d8e]"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              aria-label="Envoyer"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-[#16180f] text-white transition-all duration-200 hover:bg-[#2a2e21] disabled:bg-black/[0.09] disabled:text-[#a6ad9d]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
          </div>
        </form>
      </div>
    </aside>
  </div>
}

/**
 * Réponse de Gerard : une surface claire posée sur le fond, sans cadre. L'issue
 * d'une application est annoncée en tête plutôt que noyée dans la phrase.
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
  return <div className="rounded-[20px] rounded-bl-[8px] bg-white px-4 py-3.5 shadow-[0_1px_3px_rgba(17,18,15,0.05)]">
    {outcome ? <p className={`mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.07em] ${outcomeTone[outcome.status].text}`}>
      <span className={`h-[7px] w-[7px] rounded-full ${outcomeTone[outcome.status].dot}`} aria-hidden />
      {outcomeTone[outcome.status].label}
    </p> : null}
    <p className="text-[14px] leading-[22px] text-[#23261f]">{message.text}</p>

    {warnings.length ? <details className="mt-3">
      <summary className="cursor-pointer list-none text-[13px] font-medium text-[#7c8374] transition-colors hover:text-[#4e554a]">
        Détails vérifiés · {warnings.length}
      </summary>
      <ul className="mt-2 space-y-1.5 text-[13px] leading-[20px] text-[#6d7466]">
        {warnings.map((warning) => <li key={warning} className="flex gap-2">
          <span className="mt-[9px] h-[3px] w-[3px] shrink-0 rounded-full bg-[#b6bcae]" aria-hidden />
          {warning}
        </li>)}
      </ul>
    </details> : null}

    {actions.length ? <div className="mt-3 flex flex-wrap items-center gap-2">
      {actions.map((action: GerardAssistantAction) => action.type === 'CONFIRM_APPLY'
        ? <button
            key={`apply-${action.suggestionId}`}
            type="button"
            onClick={() => onRequestApply(action)}
            className="inline-flex items-center gap-1.5 rounded-full border-0 bg-[#c8f06a] px-4 py-2 text-[13px] font-semibold text-[#1d2810] transition-colors hover:bg-[#bde95a]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden><path d="m5 13 4 4L19 7" /></svg>
            {action.label}
          </button>
        : <button
            key={action.suggestionId}
            type="button"
            onClick={() => onSimulate(action.suggestionId)}
            className="inline-flex items-center gap-1.5 rounded-full border-0 bg-black/[0.045] px-4 py-2 text-[13px] font-semibold text-[#3f4539] transition-colors hover:bg-[#eef7dc] hover:text-[#3b5a0c]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7v5l3 2" /></svg>
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
  return <div role="group" aria-label="Confirmer l’application" className="rounded-[20px] bg-[#f3faE4] px-4 py-4">
    <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-[#5f8a16]">Confirmation requise</p>
    <p className="mt-1.5 text-[14px] font-semibold leading-[21px] tracking-[-0.01em] text-[#1d2810]">
      Cette action modifiera l’affectation de {action.missionReference}.
    </p>
    <p className="mt-1.5 text-[13px] leading-[20px] text-[#5d6b4a]">{action.summary}</p>
    <div className="mt-3.5 flex gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-full border-0 bg-white/80 px-4 py-2 text-[13px] font-semibold text-[#4e554a] transition-colors hover:bg-white"
      >Annuler</button>
      <button
        type="button"
        disabled={loading}
        onClick={onConfirm}
        className="rounded-full border-0 bg-[#16180f] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-45"
      >{loading ? 'Application…' : 'Confirmer'}</button>
    </div>
  </div>
}
