'use client'

import { useEffect, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { GerardSuggestion } from '../../../lib/dispatch/suggestions/types'

type Analysis = {
  analyzedAt: string
  weekStart: string
  snapshotFingerprint: string
  summary: { analyzedMissions: number; validBaselines: number; validAlternatives: number; suggestions: number }
  suggestions: GerardSuggestion[]
  diagnostics: { noValidAlternative: number; belowThreshold: number; incomplete: number }
}

export function GerardSuggestionsPanel({ weekStart, compact = false, onApplied, hideTrigger = false, analyzeRef }: { weekStart: string; compact?: boolean; onApplied?: () => void | Promise<void>; /** La barre de contrôles porte déjà l'action : on masque le bouton local. */ hideTrigger?: boolean; /** Expose le déclenchement de l'analyse à la barre de contrôles. */ analyzeRef?: MutableRefObject<(() => void) | null> }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [simulation, setSimulation] = useState<Record<string, 'loading' | 'valid' | 'stale'>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [application, setApplication] = useState<Record<string, 'loading' | 'applied' | 'error'>>({})
  const [applicationMessage, setApplicationMessage] = useState<Record<string, string>>({})
  const [idempotencyKeys, setIdempotencyKeys] = useState<Record<string, string>>({})

  async function analyze() {
    setOpen(true); setLoading(true); setError(null); setAnalysis(null)
    try {
      const response = await fetch('/api/dispatch/intelligence/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekStart }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Analyse impossible')
      setAnalysis(body)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Analyse impossible') }
    finally { setLoading(false) }
  }

  async function simulate(suggestion: GerardSuggestion) {
    setSimulation((current) => ({ ...current, [suggestion.id]: 'loading' }))
    try {
      const response = await fetch('/api/dispatch/intelligence/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekStart, missionId: suggestion.proposedState.missionId, proposedPairRowId: suggestion.proposedState.pairRowId }) })
      const body = await response.json()
      if (response.ok && body.status === 'VALID' && body.suggestion) {
        const freshId = body.suggestion.id as string
        setAnalysis((current) => current ? { ...current, suggestions: current.suggestions.map((item) => item.id === suggestion.id ? body.suggestion : item) } : current)
        setSimulation((current) => {
          const next = { ...current }
          delete next[suggestion.id]
          next[freshId] = 'valid'
          return next
        })
        setIdempotencyKeys((current) => ({ ...current, [freshId]: current[freshId] ?? crypto.randomUUID() }))
        return
      }
      setSimulation((current) => ({ ...current, [suggestion.id]: response.ok && body.status === 'VALID' ? 'valid' : 'stale' }))
    } catch { setSimulation((current) => ({ ...current, [suggestion.id]: 'stale' })) }
  }

  async function applySuggestion(suggestion: GerardSuggestion) {
    const idempotencyKey = idempotencyKeys[suggestion.id] ?? crypto.randomUUID()
    setIdempotencyKeys((current) => ({ ...current, [suggestion.id]: idempotencyKey }))
    setApplication((current) => ({ ...current, [suggestion.id]: 'loading' }))
    setApplicationMessage((current) => ({ ...current, [suggestion.id]: '' }))
    try {
      const response = await fetch('/api/dispatch/intelligence/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: suggestion.id, weekStart, snapshotFingerprint: suggestion.snapshotFingerprint, idempotencyKey }),
      })
      const body = await response.json()
      if (!response.ok || !['APPLIED', 'ALREADY_APPLIED'].includes(body.status)) {
        setApplication((current) => ({ ...current, [suggestion.id]: 'error' }))
        setApplicationMessage((current) => ({ ...current, [suggestion.id]: body.error ?? 'La suggestion n’a pas pu être appliquée.' }))
        if (body.status === 'STALE' || body.status === 'CONFLICT') {
          setSimulation((current) => ({ ...current, [suggestion.id]: 'stale' }))
        }
        return
      }
      setConfirming(null)
      setApplication((current) => ({ ...current, [suggestion.id]: 'applied' }))
      setApplicationMessage((current) => ({ ...current, [suggestion.id]: 'Suggestion appliquée' }))
      setSimulation((current) => Object.fromEntries(Object.keys(current).map((id) => [id, id === suggestion.id ? 'valid' : 'stale'])))
      await onApplied?.()
    } catch {
      setApplication((current) => ({ ...current, [suggestion.id]: 'error' }))
      setApplicationMessage((current) => ({ ...current, [suggestion.id]: 'La suggestion n’a pas pu être appliquée.' }))
    }
  }

  useEffect(() => {
    if (!analyzeRef) return
    analyzeRef.current = () => void analyze()
    return () => {
      analyzeRef.current = null
    }
  })

  return <>
    {hideTrigger ? null : <button type="button" onClick={() => void analyze()} className={`${compact ? 'mx-4 mt-3 w-[calc(100%-2rem)]' : 'mx-3 mb-3'} rounded-xl border border-[#b9e85a] bg-[#eaffc8] px-4 py-2 text-xs font-bold text-[#263115] shadow-sm hover:bg-[#ddf9a4]`}>
      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#91c72e]" />Analyser le planning
    </button>}
    {open ? <div className="fixed inset-0 z-[90] bg-black/25" onClick={() => setOpen(false)}>
      <aside role="dialog" aria-label="Gerard suggère" onClick={(event) => event.stopPropagation()} className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[28px] bg-[#f7f8f4] p-5 shadow-2xl md:inset-y-0 md:left-auto md:w-[480px] md:rounded-none md:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#739c25]">Intelligence Gerard</p><h2 className="mt-1 text-2xl font-black text-[#171814]">Gerard suggère</h2>{analysis ? <p className="mt-1 text-sm text-[#687064]">{analysis.summary.suggestions} amélioration(s) possible(s) sur cette semaine.</p> : null}</div><button type="button" onClick={() => setOpen(false)} className="h-9 w-9 rounded-full bg-black/5 text-xl">×</button></div>
        {loading ? <div className="mt-8 rounded-2xl bg-white p-5 text-sm font-semibold text-[#596052]"><div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[#edf0e8]"><div className="h-full w-2/3 animate-pulse rounded-full bg-[#a8db46]" /></div>Analyse des missions · Vérification des ressources · Calcul des gains</div> : null}
        {error ? <div role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}<button type="button" onClick={() => void analyze()} className="mt-3 block rounded-lg bg-red-100 px-3 py-2">Réessayer</button></div> : null}
        {analysis ? <div className="mt-5 space-y-4"><div className="grid grid-cols-3 gap-2 text-center"><Metric value={analysis.summary.analyzedMissions} label="missions" /><Metric value={analysis.summary.validAlternatives} label="alternatives" /><Metric value={analysis.summary.suggestions} label="suggestions" /></div>
          {!analysis.suggestions.length ? <div className="rounded-2xl bg-white p-5"><p className="font-bold">Le planning est déjà bien optimisé.</p><p className="mt-1 text-sm text-[#687064]">Aucune amélioration significative et applicable n’a été détectée sur cette semaine.</p></div> : analysis.suggestions.map((suggestion) => {
            const km = Math.max(0, -suggestion.impact.emptyKm.delta), cost = Math.max(0, -(suggestion.impact.estimatedCost.delta ?? 0)), margin = Math.max(0, suggestion.impact.estimatedMargin.delta ?? 0), state = simulation[suggestion.id], applyState = application[suggestion.id]
            return <article key={suggestion.id} className="rounded-[22px] border border-black/[0.06] bg-white p-5 shadow-[0_10px_30px_rgba(17,18,15,0.06)]"><p className="text-[11px] font-bold uppercase tracking-wider text-[#729525]">Une affectation plus efficace</p><h3 className="mt-1 text-base font-black">{suggestion.proposedState.missionReference}</h3><p className="mt-2 text-sm"><b>{suggestion.proposedState.driverName}</b> à la place de <b>{suggestion.currentState.driverName}</b></p><div className="mt-4 space-y-1.5 text-sm"><Impact value={`${km.toFixed(1)} km`} label="à vide en moins" /><Impact value={`${cost.toFixed(2)} €`} label="de coût estimé en moins" /><Impact value={`+${margin.toFixed(2)} €`} label="de marge estimée" /></div><p className="mt-3 text-xs text-[#72786e]">Temporalité et ressources compatibles · Confiance {suggestion.confidence === 'MEDIUM' ? 'moyenne' : 'haute'}</p>
              <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => setExpanded(expanded === suggestion.id ? null : suggestion.id)} className="rounded-xl bg-black/[0.05] px-3 py-2 text-xs font-bold">Voir pourquoi</button><button type="button" disabled={state === 'loading' || applyState === 'applied'} onClick={() => void simulate(suggestion)} className="rounded-xl bg-[#171814] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{state === 'loading' ? 'Simulation…' : 'Simuler'}</button>{state === 'valid' && applyState !== 'applied' ? <button type="button" onClick={() => setConfirming(suggestion.id)} className="rounded-xl bg-[#b9ed55] px-3 py-2 text-xs font-black text-[#1d2810]">Appliquer</button> : null}</div>
              {state === 'valid' ? <p className="mt-3 rounded-xl bg-lime-50 p-3 text-xs font-bold text-[#49630b]">Suggestion toujours valide</p> : null}{state === 'stale' ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">Le planning a changé depuis l’analyse. Relancez l’analyse.</p> : null}
              {confirming === suggestion.id ? <div className="mt-3 rounded-2xl border border-[#cce98e] bg-[#f4ffe0] p-4"><p className="text-sm font-black">Appliquer cette suggestion ?</p><p className="mt-1 text-xs text-[#59634d]">{suggestion.currentState.driverName} → {suggestion.proposedState.driverName} · {km.toFixed(1)} km à vide estimés en moins · +{margin.toFixed(2)} € de marge estimée</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => setConfirming(null)} className="rounded-lg bg-white px-3 py-2 text-xs font-bold">Annuler</button><button type="button" disabled={applyState === 'loading'} onClick={() => void applySuggestion(suggestion)} className="rounded-lg bg-[#171814] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{applyState === 'loading' ? 'Application…' : 'Appliquer'}</button></div></div> : null}
              {applicationMessage[suggestion.id] ? <div role={applyState === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-xl p-3 text-xs font-bold ${applyState === 'error' ? 'bg-red-50 text-red-700' : 'bg-lime-100 text-[#49630b]'}`}><p>{applicationMessage[suggestion.id]}</p>{applyState === 'applied' ? <button type="button" onClick={() => void analyze()} className="mt-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-[#263115]">Analyser à nouveau</button> : null}</div> : null}
              {expanded === suggestion.id ? <SuggestionDetails suggestion={suggestion} /> : null}
            </article>})}
          <p className="px-1 text-xs text-[#777d73]">{analysis.summary.analyzedMissions} missions analysées · {analysis.diagnostics.noValidAlternative} sans alternative · {analysis.diagnostics.incomplete} incomplète(s)</p>
        </div> : null}
      </aside>
    </div> : null}
  </>
}

function Metric({ value, label }: { value: number; label: string }) { return <div className="rounded-2xl bg-white px-2 py-3"><b className="block text-lg">{value}</b><span className="text-[10px] uppercase text-[#747a70]">{label}</span></div> }
function Impact({ value, label }: { value: string; label: string }) { return <p><b className="text-[#567d12]">{value}</b> <span className="text-[#5f665b]">{label}</span></p> }
function SuggestionDetails({ suggestion }: { suggestion: GerardSuggestion }) { return <div className="mt-4 border-t border-black/10 pt-4 text-xs text-[#555d51]"><div className="grid grid-cols-2 gap-3"><State title="Situation actuelle" state={suggestion.currentState} /><State title="Proposition Gerard" state={suggestion.proposedState} /></div><h4 className="mt-4 font-black text-[#24271f]">Vérifications</h4><p className="mt-1">Disponibilité, compatibilité, temporalité, réglementation et routes vérifiées.</p><h4 className="mt-3 font-black text-[#24271f]">Hypothèses</h4><p className="mt-1">{suggestion.evidence.assumptions.length ? suggestion.evidence.assumptions.join(' · ') : 'Aucune hypothèse bloquante.'}</p><p className="mt-3">Calcul basé sur les routes Google, les disponibilités et les paramètres de coût actuels.</p></div> }
function State({ title, state }: { title: string; state: GerardSuggestion['currentState'] }) { return <div className="rounded-xl bg-[#f5f6f2] p-3"><b className="text-[#24271f]">{title}</b><p className="mt-2">{state.driverName}</p><p>{state.truckPlateNumber}</p><p>{state.trailerPlateNumber ?? 'Sans remorque'}</p><p className="mt-2">{state.emptyKm.toFixed(1)} km à vide</p><p>{state.estimatedCost?.toFixed(2) ?? '—'} € coût</p><p>{state.estimatedMargin?.toFixed(2) ?? '—'} € marge</p></div> }
