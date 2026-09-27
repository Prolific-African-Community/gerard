'use client'

import { useCallback, useEffect, useState } from 'react'
import type { GerardInsight, GerardInsightReport, GerardInsightSeverity } from '../../../lib/dispatch/intelligence/insights'

/**
 * Surface proactive : elle se charge avec le planning et reste posée dans la
 * page. Pas de modale, pas d'ouverture automatique, aucune action d'écriture —
 * l'application passe toujours par la simulation puis la confirmation
 * existantes.
 */
const severityStyles: Record<GerardInsightSeverity, { label: string; chip: string }> = {
  CRITICAL: { label: 'CRITIQUE', chip: 'bg-red-100 text-red-800' },
  ATTENTION: { label: 'ATTENTION', chip: 'bg-amber-100 text-amber-900' },
  OPPORTUNITY: { label: 'OPPORTUNITÉ', chip: 'bg-[#e8ffbe] text-[#3f5513]' },
  INFO: { label: 'INFO', chip: 'bg-black/[0.06] text-[#5b6153]' },
}

export function insightHeadline(report: Pick<GerardInsightReport, 'total'> | null) {
  if (!report || report.total === 0) return 'Rien à signaler sur cette semaine'
  return report.total === 1 ? '1 point à vérifier' : `${report.total} points à vérifier`
}

export function GerardInsightsPanel({
  weekStart,
  refreshKey = 0,
  compact = false,
  onSimulate,
  onOpenMission,
}: {
  weekStart: string
  /** Incrémenté par le parent après une application ou un rafraîchissement du planning. */
  refreshKey?: number
  compact?: boolean
  onSimulate?: (input: { suggestionId: string; missionId: string; proposedPairRowId: string }) => void
  onOpenMission?: (input: { missionId: string; missionReference: string }) => void
}) {
  const [report, setReport] = useState<GerardInsightReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/dispatch/intelligence/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Analyse indisponible')
      setReport(body)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Analyse indisponible')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  useEffect(() => { setExpanded(false); void load() }, [load, refreshKey])

  if (loading && !report) return null
  if (error) {
    return <section aria-label="Gerard Intelligence" className={`${compact ? 'mx-4 mt-3' : 'mx-3 mb-3'} rounded-2xl border border-black/[0.06] bg-white px-4 py-3 text-xs font-semibold text-[#7a8074]`}>
      Gerard n’a pas pu analyser cette semaine.
    </section>
  }
  if (!report) return null

  const visible = expanded ? report.insights : report.insights.slice(0, 3)
  return <section aria-label="Gerard Intelligence" className={`${compact ? 'mx-4 mt-3' : 'mx-3 mb-3'} rounded-2xl border border-black/[0.06] bg-white px-4 py-3 shadow-sm`}>
    <div className="flex items-baseline justify-between gap-3">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#709724]">Gerard Intelligence</p>
      <p className="text-xs font-bold text-[#4e554a]">{insightHeadline(report)}</p>
    </div>
    {report.total === 0
      ? <p className="mt-2 text-xs text-[#7a8074]">Le planning de la semaine ne présente ni conflit, ni mission à planifier, ni amélioration matérielle.</p>
      : <ul className="mt-3 space-y-2">
          {visible.map((insight) => <InsightRow key={insight.id} insight={insight} onSimulate={onSimulate} onOpenMission={onOpenMission} />)}
        </ul>}
    {report.insights.length > 3 && !expanded
      ? <button type="button" onClick={() => setExpanded(true)} className="mt-3 text-xs font-bold text-[#5c7a1f] underline">Voir tout ({report.insights.length})</button>
      : null}
    {report.total > report.insights.length
      ? <p className="mt-2 text-[11px] text-[#8a9080]">{report.total - report.insights.length} autre(s) point(s) non affiché(s).</p>
      : null}
  </section>
}

/**
 * Ligne d un insight. Purement présentationnelle : elle nomme la gravité, le
 * fait, et n expose que des actions de lecture.
 */
export function InsightRow({
  insight,
  onSimulate,
  onOpenMission,
}: {
  insight: GerardInsight
  onSimulate?: (input: { suggestionId: string; missionId: string; proposedPairRowId: string }) => void
  onOpenMission?: (input: { missionId: string; missionReference: string }) => void
}) {
  const style = severityStyles[insight.severity]
  return <li className="rounded-xl bg-[#f7f8f4] px-3 py-2">
    <div className="flex items-start gap-2">
      <span className={`mt-0.5 rounded-md px-1.5 py-0.5 text-[9px] font-black tracking-wide ${style.chip}`}>{style.label}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-[#24271f]">{insight.title}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-[#6b7263]">{insight.summary}</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {insight.availableActions.map((action) => action.type === 'SIMULATE'
            ? <button
                key={action.suggestionId}
                type="button"
                disabled={!onSimulate}
                onClick={() => onSimulate?.({ suggestionId: action.suggestionId, missionId: action.missionId, proposedPairRowId: action.proposedPairRowId })}
                className="rounded-lg bg-[#171814] px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40"
              >{action.label}</button>
            : <button
                key={`${action.type}-${action.missionId}`}
                type="button"
                disabled={!onOpenMission}
                onClick={() => onOpenMission?.({ missionId: action.missionId, missionReference: action.missionReference })}
                className="rounded-lg bg-black/[0.06] px-2.5 py-1 text-[11px] font-bold text-[#3f4539] disabled:opacity-40"
              >{action.label}</button>)}
        </div>
      </div>
    </div>
  </li>
}
