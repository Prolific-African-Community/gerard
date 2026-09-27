'use client'

import { useCallback, useEffect, useState } from 'react'

import type { GerardInsightReport } from '../../../lib/dispatch/intelligence/insights'

/**
 * Source unique des insights pour le cockpit : la pastille de la barre de
 * contrôles et le contenu de l'assistant lisent le même rapport, chargé une
 * seule fois par semaine affichée. Deux surfaces ne peuvent donc pas afficher
 * des comptes différents.
 */
export function useGerardInsights(input: { weekStart: string; enabled?: boolean; refreshKey?: number }) {
  const { weekStart, enabled = true, refreshKey = 0 } = input
  const [report, setReport] = useState<GerardInsightReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!enabled) return
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
  }, [enabled, weekStart])

  useEffect(() => { void load() }, [load, refreshKey])

  return { report, loading, error, reload: load }
}

/**
 * Nombre porté par la pastille. Zéro ou rapport absent : aucune pastille, la
 * barre de contrôles reste silencieuse plutôt que d'afficher un « 0 ».
 */
export function insightBadgeCount(report: GerardInsightReport | null) {
  return report && report.total > 0 ? report.total : null
}
