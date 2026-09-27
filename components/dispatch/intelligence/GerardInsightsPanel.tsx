'use client'

import { useState } from 'react'
import type { GerardInsight, GerardInsightReport, GerardInsightSeverity } from '../../../lib/dispatch/intelligence/insights'

/**
 * Présentation des insights. Depuis la refonte, ils ne sont plus posés dans le
 * flux du planning : la grille reste la vue reine et cette section vit dans
 * l'assistant, repliée par défaut dès qu'une conversation commence.
 *
 * Aucune action d'écriture ici : ouvrir une mission ou lancer une simulation,
 * rien d'autre.
 */
const severityStyles: Record<GerardInsightSeverity, { label: string; dot: string; chip: string }> = {
  CRITICAL: { label: 'Critique', dot: 'bg-[#d4503f]', chip: 'bg-[#fdecea] text-[#8d2f22]' },
  ATTENTION: { label: 'Attention', dot: 'bg-[#d79a2b]', chip: 'bg-[#fdf3e0] text-[#7a551a]' },
  OPPORTUNITY: { label: 'Opportunité', dot: 'bg-[#8fc63d]', chip: 'bg-[#eefad7] text-[#42600f]' },
  INFO: { label: 'Info', dot: 'bg-[#a8b0a0]', chip: 'bg-black/[0.05] text-[#5b6153]' },
}

export function insightHeadline(report: Pick<GerardInsightReport, 'total'> | null) {
  if (!report || report.total === 0) return 'Rien de particulier à signaler sur cette semaine'
  return report.total === 1 ? '1 point à vérifier' : `${report.total} points à vérifier`
}

export type InsightActionHandlers = {
  onSimulate?: (input: { suggestionId: string; missionId: string; proposedPairRowId: string }) => void
  onOpenMission?: (input: { missionId: string; missionReference: string }) => void
}

/**
 * Section « Points d'attention » de l'assistant : compacte, repliable, jamais
 * bloquante. Elle résume d'abord, détaille ensuite.
 */
export function GerardInsightsSection({
  report,
  loading,
  error,
  defaultOpen = true,
  onSimulate,
  onOpenMission,
}: {
  report: GerardInsightReport | null
  loading?: boolean
  error?: string | null
  defaultOpen?: boolean
} & InsightActionHandlers) {
  const [open, setOpen] = useState(defaultOpen)

  if (loading && !report) {
    return <section aria-label="Points d’attention" className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3">
      <p className="text-[12px] font-medium text-[#8a9080]">Analyse de la semaine…</p>
    </section>
  }
  if (error) {
    return <section aria-label="Points d’attention" className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3">
      <p className="text-[12px] font-medium text-[#8a9080]">Gerard n’a pas pu analyser cette semaine.</p>
    </section>
  }
  if (!report) return null

  const counts = report.bySeverity
  return <section aria-label="Points d’attention" className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(17,18,15,0.04)]">
    <button
      type="button"
      onClick={() => setOpen((current) => !current)}
      aria-expanded={open}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.02]"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-[13px] font-semibold tracking-[-0.01em] text-[#16180f]">{insightHeadline(report)}</span>
      </span>
      {report.total > 0 ? <span className="flex shrink-0 items-center gap-1">
        {(['CRITICAL', 'ATTENTION', 'OPPORTUNITY', 'INFO'] as const)
          .filter((severity) => counts[severity] > 0)
          .map((severity) => <span key={severity} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${severityStyles[severity].chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${severityStyles[severity].dot}`} />{counts[severity]}
          </span>)}
      </span> : null}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`h-3.5 w-3.5 shrink-0 text-[#9aa192] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    {open ? <div className="border-t border-black/[0.05] px-3 pb-3 pt-2">
      {report.total === 0
        ? <p className="px-1 py-2 text-[12px] leading-5 text-[#7c8374]">
            Aucun conflit, aucune mission à planifier et aucune amélioration matérielle détectée sur les missions analysables de la semaine.
          </p>
        : <ul className="space-y-1.5">
            {report.insights.map((insight) => <InsightRow key={insight.id} insight={insight} onSimulate={onSimulate} onOpenMission={onOpenMission} />)}
          </ul>}
      {report.total > report.insights.length
        ? <p className="px-1 pt-2 text-[11px] text-[#9aa192]">{report.total - report.insights.length} autre(s) point(s) non affiché(s).</p>
        : null}
    </div> : null}
  </section>
}

/**
 * Ligne d'un insight : gravité, fait, actions de lecture. Une action n'est
 * désactivée que si la surface hôte ne sait pas l'exécuter.
 */
export function InsightRow({ insight, onSimulate, onOpenMission }: { insight: GerardInsight } & InsightActionHandlers) {
  const style = severityStyles[insight.severity]
  return <li className="rounded-xl px-2.5 py-2 transition-colors hover:bg-black/[0.02]">
    <div className="flex items-start gap-2.5">
      <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] font-semibold leading-5 tracking-[-0.01em] text-[#16180f]">
          {insight.title}
          <span className={`rounded-full px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide ${style.chip}`}>{style.label}</span>
        </p>
        <p className="mt-0.5 text-[11.5px] leading-[17px] text-[#71786a]">{insight.summary}</p>
        {insight.availableActions.length ? <div className="mt-2 flex flex-wrap gap-1.5">
          {insight.availableActions.map((action) => action.type === 'SIMULATE'
            ? <button
                key={action.suggestionId}
                type="button"
                disabled={!onSimulate}
                title={onSimulate ? undefined : 'Simulation indisponible depuis cette vue'}
                onClick={() => onSimulate?.({ suggestionId: action.suggestionId, missionId: action.missionId, proposedPairRowId: action.proposedPairRowId })}
                className="rounded-lg bg-[#16180f] px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
              >{action.label}</button>
            : <button
                key={`${action.type}-${action.missionId}`}
                type="button"
                disabled={!onOpenMission}
                title={onOpenMission ? undefined : 'Ouverture indisponible depuis cette vue'}
                onClick={() => onOpenMission?.({ missionId: action.missionId, missionReference: action.missionReference })}
                className="rounded-lg bg-black/[0.055] px-2.5 py-1 text-[11px] font-semibold text-[#3f4539] transition-colors hover:bg-black/[0.085] disabled:cursor-not-allowed disabled:opacity-35"
              >{action.label}</button>)}
        </div> : null}
      </div>
    </div>
  </li>
}
