'use client'

import { useState } from 'react'
import type { GerardInsight, GerardInsightReport, GerardInsightSeverity } from '../../../lib/dispatch/intelligence/insights'

/**
 * Présentation des points d'attention. Ils vivent dans l'assistant, jamais dans
 * le flux du planning : la grille reste la vue reine.
 *
 * Parti pris visuel : aucune bordure. Les surfaces se distinguent par le fond,
 * l'espacement et le rayon. La gravité est portée par un filet vertical aligné
 * sur toute la hauteur du contenu, ce qui supprime le point flottant mal calé.
 *
 * Aucune action d'écriture ici : ouvrir une mission ou lancer une simulation.
 */
const severityStyles: Record<GerardInsightSeverity, { label: string; rail: string; text: string }> = {
  CRITICAL: { label: 'Critique', rail: 'bg-[#d4503f]', text: 'text-[#a33a2c]' },
  ATTENTION: { label: 'Attention', rail: 'bg-[#e8760d]', text: 'text-[#9a5407]' },
  OPPORTUNITY: { label: 'Opportunité', rail: 'bg-[#7fb833]', text: 'text-[#4d7317]' },
  INFO: { label: 'Information', rail: 'bg-[#b9bfb1]', text: 'text-[#78806f]' },
}

const severityOrder = ['CRITICAL', 'ATTENTION', 'OPPORTUNITY', 'INFO'] as const

export function insightHeadline(report: Pick<GerardInsightReport, 'total'> | null) {
  if (!report || report.total === 0) return 'Rien de particulier à signaler sur cette semaine'
  return report.total === 1 ? '1 point à vérifier' : `${report.total} points à vérifier`
}

export type InsightActionHandlers = {
  onSimulate?: (input: { suggestionId: string; missionId: string; proposedPairRowId: string }) => void
  onOpenMission?: (input: { missionId: string; missionReference: string }) => void
}

/**
 * Section « Points à vérifier » : un en-tête cliquable sans cadre, puis la liste.
 * Repliée, elle n'occupe qu'une ligne.
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
    return <p className="px-1 py-1 text-[13px] text-[#8a9080]">Analyse de la semaine…</p>
  }
  if (error) {
    return <p className="px-1 py-1 text-[13px] text-[#8a9080]">Gerard n’a pas pu analyser cette semaine.</p>
  }
  if (!report) return null

  const counts = report.bySeverity
  const present = severityOrder.filter((severity) => counts[severity] > 0)

  return <section aria-label="Points à vérifier">
    <button
      type="button"
      onClick={() => setOpen((current) => !current)}
      aria-expanded={open}
      className="group flex w-full items-center gap-3 rounded-[14px] border-0 bg-transparent px-2 py-2 text-left transition-colors hover:bg-black/[0.03]"
    >
      <span className="flex-1 text-[15px] font-semibold tracking-[-0.015em] text-[#14160f]">
        {insightHeadline(report)}
      </span>
      {present.length ? <span className="flex shrink-0 items-center gap-1.5" aria-hidden>
        {present.map((severity) => <span key={severity} className="flex items-center gap-1">
          <span className={`h-[7px] w-[7px] rounded-full ${severityStyles[severity].rail}`} />
          <span className="text-[12.5px] font-medium tabular-nums text-[#6d7466]">{counts[severity]}</span>
        </span>)}
      </span> : null}
      <svg
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        className={`h-4 w-4 shrink-0 text-[#a6ad9d] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        aria-hidden
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    {open ? <div className="pt-1">
      {report.total === 0
        ? <p className="px-2 pb-1 pt-1 text-[13px] leading-[21px] text-[#7c8374]">
            Aucun conflit, aucune mission à planifier et aucune amélioration matérielle détectée sur les missions analysables de la semaine.
          </p>
        : <ul className="list-none space-y-1">
            {report.insights.map((insight) => <InsightRow key={insight.id} insight={insight} onSimulate={onSimulate} onOpenMission={onOpenMission} />)}
          </ul>}
      {report.total > report.insights.length
        ? <p className="px-2 pt-2 text-[12.5px] text-[#9aa192]">{report.total - report.insights.length} autre(s) point(s) non affiché(s).</p>
        : null}
    </div> : null}
  </section>
}

/**
 * Ligne d'un insight. Le filet de gravité court sur toute la hauteur : titre,
 * détail et action restent alignés sur une seule colonne de texte.
 */
export function InsightRow({ insight, onSimulate, onOpenMission }: { insight: GerardInsight } & InsightActionHandlers) {
  const style = severityStyles[insight.severity]
  return <li className="rounded-[14px] px-2 py-2.5 transition-colors hover:bg-black/[0.025]">
    <div className="flex gap-3">
      <span className={`w-[3px] shrink-0 self-stretch rounded-full ${style.rail}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={`text-[12px] font-medium uppercase tracking-[0.07em] ${style.text}`}>{style.label}</p>
        <p className="mt-1 text-[14px] font-semibold leading-[20px] tracking-[-0.01em] text-[#14160f]">{insight.title}</p>
        <p className="mt-1 text-[13px] leading-[20px] text-[#6d7466]">{insight.summary}</p>

        {insight.availableActions.length ? <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {/* Le libellé vient du moteur : il porte la référence de mission, que
              le titre ne répète pas toujours. Seule sa forme change ici. */}
          {insight.availableActions.map((action) => action.type === 'SIMULATE'
            ? <InsightAction
                key={action.suggestionId}
                label={action.label}
                disabledReason={onSimulate ? null : 'Simulation indisponible depuis cette vue'}
                onClick={() => onSimulate?.({ suggestionId: action.suggestionId, missionId: action.missionId, proposedPairRowId: action.proposedPairRowId })}
              />
            : <InsightAction
                key={`${action.type}-${action.missionId}`}
                label={action.label}
                disabledReason={onOpenMission ? null : 'Ouverture indisponible depuis cette vue'}
                onClick={() => onOpenMission?.({ missionId: action.missionId, missionReference: action.missionReference })}
              />)}
        </div> : null}
      </div>
    </div>
  </li>
}

/**
 * Action d'insight : un lien affirmé plutôt qu'un petit bouton encadré. La zone
 * de clic déborde du texte pour rester confortable.
 */
function InsightAction({ label, onClick, disabledReason }: { label: string; onClick: () => void; disabledReason: string | null }) {
  return <button
    type="button"
    onClick={onClick}
    disabled={Boolean(disabledReason)}
    title={disabledReason ?? undefined}
    className="group -mx-1.5 inline-flex items-center gap-1 rounded-lg border-0 bg-transparent px-1.5 py-1 text-[13px] font-semibold text-[#4a6b12] transition-colors hover:bg-[#f1f8e2] hover:text-[#3b5a0c] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-[#a6ad9d]"
  >
    {label}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-disabled:translate-x-0" aria-hidden>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  </button>
}
