'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import type { GerardAssistantAction, GerardAssistantReply } from '../../../lib/dispatch/intelligence/types'

type Message = { id: string; role: 'user' | 'assistant'; text: string; reply?: GerardAssistantReply }

const shortcuts = [
  'Analyser le planning',
  'Voir les optimisations possibles',
  'Pourquoi cette mission est affectée ici ?',
  'Vérifier les conflits',
  'Réduire les kilomètres à vide',
]

export function GerardAssistantPanel({ open, onClose, weekStart, missionReference, onApplied }: { open: boolean; onClose: () => void; weekStart: string; missionReference?: string | null; onApplied?: () => void | Promise<void> }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationContext, setConversationContext] = useState<{ missionReference?: string; suggestionId?: string }>(() => ({ missionReference: missionReference ?? undefined }))
  /** Action d'application en attente de confirmation explicite, émise par le serveur. */
  const [pendingApply, setPendingApply] = useState<Extract<GerardAssistantAction, { type: 'CONFIRM_APPLY' }> | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [open, messages, loading])
  useEffect(() => { setMessages([]); setError(null); setPendingApply(null); setConversationContext({ missionReference: missionReference ?? undefined }) }, [weekStart])
  useEffect(() => { if (missionReference) setConversationContext((current) => ({ ...current, missionReference })) }, [missionReference])
  if (!open) return null

  async function send(text: string, options: { suggestionId?: string; confirmation?: { token: string } } = {}) {
    const question = text.trim()
    if (!question || loading) return
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', text: question }
    setMessages((current) => [...current, userMessage]); setInput(''); setLoading(true); setError(null)
    try {
      const response = await fetch('/api/dispatch/intelligence/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question,
          weekStart,
          conversationContext: { ...conversationContext, suggestionId: options.suggestionId ?? conversationContext.suggestionId },
          ...(options.confirmation ? { confirmation: options.confirmation } : {}),
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Assistant indisponible')
      const resolvedMission = body.data?.facts?.find((item: { label?: string; value?: unknown }) => item.label === 'Mission')?.value
      const resolvedSuggestion = body.data?.suggestions?.[0]?.id
      setConversationContext((current) => ({ ...current, ...(typeof resolvedMission === 'string' ? { missionReference: resolvedMission } : {}), ...(typeof resolvedSuggestion === 'string' ? { suggestionId: resolvedSuggestion } : {}) }))
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', text: body.answer, reply: body }])
      // Une application terminée, réussie ou refusée, périme l'action en attente.
      if (options.confirmation) {
        setPendingApply(null)
        if (body.application?.status === 'APPLIED' || body.application?.status === 'ALREADY_APPLIED') await onApplied?.()
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : ''
      setError(message && message !== 'Failed to fetch' ? message : 'Gerard ne peut pas consulter le planning pour le moment.')
    } finally { setLoading(false) }
  }

  function submit(event: FormEvent) { event.preventDefault(); void send(input) }

  return <div className="fixed inset-0 z-[95] bg-black/25" onClick={onClose}>
    <aside role="dialog" aria-label="Assistant Gerard" aria-modal="true" onClick={(event) => event.stopPropagation()} className="absolute inset-x-0 bottom-0 flex max-h-[88vh] min-h-[62vh] flex-col rounded-t-[28px] bg-white/95 shadow-2xl backdrop-blur-2xl md:inset-y-0 md:left-auto md:min-h-0 md:w-[430px] md:rounded-none">
      <header className="flex items-start justify-between border-b border-black/[0.06] px-5 py-5">
        <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#709724]">Gerard Intelligence</p><h2 className="mt-1 text-xl font-black tracking-[-0.03em] text-[#151712]">Assistant opérationnel</h2><p className="mt-1 text-xs text-[#73796e]">Lecture et simulation · modification uniquement après confirmation</p></div>
        <button type="button" onClick={onClose} aria-label="Fermer l’assistant" className="h-9 w-9 rounded-full bg-black/[0.05] text-xl">×</button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
        {!messages.length ? <div><div className="rounded-[20px] bg-[#f4f6f0] p-4 text-sm leading-6 text-[#444a40]">Je peux analyser cette semaine, expliquer une affectation et vérifier une suggestion existante.</div><div className="mt-4 flex flex-wrap gap-2">{shortcuts.map((item) => <button key={item} type="button" onClick={() => void send(item)} className="rounded-full bg-black/[0.045] px-3 py-2 text-left text-xs font-bold text-[#4e554a] hover:bg-[#eaffc8]">{item}</button>)}</div></div> : null}
        {messages.map((message) => <div key={message.id} className={message.role === 'user' ? 'ml-10 rounded-[18px] rounded-br-md bg-[#171914] px-4 py-3 text-sm leading-6 text-white' : 'mr-6 rounded-[18px] rounded-bl-md bg-[#f1f3ed] px-4 py-3 text-sm leading-6 text-[#252921]'}><p>{message.text}</p>{message.reply?.warnings?.length ? <details className="mt-3 text-xs text-[#666d61]"><summary className="cursor-pointer font-bold">Détails vérifiés</summary><ul className="mt-2 list-disc space-y-1 pl-4">{message.reply.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}{message.reply?.actions?.map((action) => action.type === 'CONFIRM_APPLY'
          ? <button key={`apply-${action.suggestionId}`} type="button" onClick={() => setPendingApply(action)} className="mt-3 block rounded-xl bg-[#b9ed55] px-3 py-2 text-xs font-black text-[#1d2810]">{action.label}</button>
          : <button key={action.suggestionId} type="button" onClick={() => void send('Simule cette proposition', { suggestionId: action.suggestionId })} className="mt-3 rounded-xl bg-[#dfffaa] px-3 py-2 text-xs font-black text-[#314313]">{action.label}</button>)}</div>)}
        {pendingApply ? <div role="group" aria-label="Confirmer l’application" className="rounded-2xl border border-[#cce98e] bg-[#f4ffe0] p-4">
          <p className="text-sm font-black text-[#1d2810]">Cette action modifiera l’affectation de {pendingApply.missionReference}. Confirmer ?</p>
          <p className="mt-1 text-xs text-[#59634d]">{pendingApply.summary}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setPendingApply(null)} className="rounded-lg bg-white px-3 py-2 text-xs font-bold">Annuler</button>
            <button type="button" disabled={loading} onClick={() => void send('Je confirme l’application de cette suggestion.', { suggestionId: pendingApply.suggestionId, confirmation: { token: pendingApply.token } })} className="rounded-lg bg-[#171814] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{loading ? 'Application…' : 'Confirmer'}</button>
          </div>
        </div> : null}
        {loading ? <div role="status" className="mr-20 rounded-[18px] rounded-bl-md bg-[#f1f3ed] px-4 py-3 text-xs font-bold text-[#697064]"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#9bd33a]" />Consultation du moteur Gerard…</div> : null}
        {error ? <div role="alert" className="rounded-2xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</div> : null}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="border-t border-black/[0.06] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><div className="flex items-end gap-2 rounded-[18px] bg-black/[0.045] p-2"><textarea value={input} onChange={(event) => setInput(event.target.value)} maxLength={1000} rows={2} placeholder="Demander à Gerard…" aria-label="Question pour Gerard" className="max-h-28 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[#92978e]" /><button type="submit" disabled={!input.trim() || loading} className="h-10 rounded-[13px] bg-[#171914] px-4 text-xs font-black text-white disabled:opacity-35">Envoyer</button></div></form>
    </aside>
  </div>
}
