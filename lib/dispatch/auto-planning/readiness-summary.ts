/**
 * Traduction des diagnostics internes de la planification automatique en un
 * message unique et lisible par le dispatcher.
 *
 * Le moteur raisonne champ par champ : il sait précisément quelle donnée
 * réglementaire lui manque. Le dispatcher, lui, a besoin d'une seule réponse :
 * est-ce prêt, est-ce une réserve, ou est-ce bloqué ? Les noms de champs
 * internes restent disponibles dans l'écran réglementaire dédié.
 *
 * Aucune décision métier n'est prise ici : la faisabilité reste calculée par
 * le moteur, on ne fait que résumer ce qu'il a déjà décidé.
 */

export type ReadinessLevel = 'READY' | 'WARNING' | 'BLOCKED'

/**
 * Une ligne de planning sans chauffeur ni tracteur est une place libre sur la
 * grille, pas une ressource a completer : elle n'identifie rien sur quoi le
 * dispatcher pourrait agir.
 */
export function isResourcePair(row: {
  driver?: unknown
  assignedTruck?: unknown
}) {
  return Boolean(row.driver || row.assignedTruck)
}

export type PairReadinessInput = {
  driverId: string | null
  driverName: string | null
  truckPlateNumber: string | null
  driverActive: boolean
  truckUsable: boolean
  missingRegulatoryState: boolean
  missingPosition: boolean
  regulatoryStatus: 'CONFORME' | 'AVERTISSEMENT' | 'BLOQUANT'
}

export type PairReadiness = {
  level: ReadinessLevel
  label: string
  summary: string
}

export function summarizePairReadiness(
  pair: PairReadinessInput
): PairReadiness {
  const label = [pair.driverName, pair.truckPlateNumber]
    .filter(Boolean)
    .join(' · ')

  if (!pair.driverActive) {
    return {
      level: 'BLOCKED',
      label,
      summary: 'Chauffeur indisponible : il ne sera pas proposé cette semaine.',
    }
  }
  if (!pair.truckUsable) {
    return {
      level: 'BLOCKED',
      label,
      summary: 'Tracteur immobilisé : il ne sera pas proposé cette semaine.',
    }
  }
  if (pair.regulatoryStatus === 'BLOQUANT') {
    return {
      level: 'BLOCKED',
      label,
      summary:
        'État réglementaire non conforme : le chauffeur ne peut pas prendre de mission.',
    }
  }
  if (pair.missingRegulatoryState) {
    return {
      level: 'WARNING',
      label,
      summary:
        'État réglementaire à initialiser. Gerard planifiera avec réserve en insérant les pauses et repos nécessaires.',
    }
  }
  if (pair.missingPosition) {
    return {
      level: 'WARNING',
      label,
      summary:
        'Position de départ estimée à la base faute d’état connu. La proposition reste applicable.',
    }
  }
  if (pair.regulatoryStatus === 'AVERTISSEMENT') {
    return {
      level: 'WARNING',
      label,
      summary:
        'Historique réglementaire partiel. Gerard insérera les pauses et repos nécessaires.',
    }
  }
  return { level: 'READY', label, summary: 'Prêt à être planifié.' }
}

/**
 * Les `missingData` d'une proposition arrivent sous forme de clés techniques
 * (`regulatory.splitBreakFirstPartSeconds`, `position.operatingBase`, une clé
 * d'itinéraire `A=>B`…). Une proposition conditionnelle en compte facilement
 * huit : affichées telles quelles elles donnent l'impression de huit erreurs
 * distinctes. On n'en garde qu'une par famille.
 */
export function summarizeProposalMissingData(
  missingData: readonly string[]
): string[] {
  const summaries: string[] = []
  const has = (prefix: string) =>
    missingData.some((item) => item.startsWith(prefix))

  if (has('regulatory.') || missingData.includes('MISSING_DRIVER_STATE')) {
    summaries.push(
      'Réserve réglementaire · historique partiel. Les pauses et repos seront intégrés au planning.'
    )
  }
  if (has('position.')) {
    summaries.push(
      'Réserve de position · position de départ estimée à la base d’exploitation.'
    )
  }
  if (missingData.some((item) => item.includes('=>'))) {
    summaries.push(
      'Réserve d’itinéraire · trajet d’approche estimé, non calculé par le fournisseur.'
    )
  }
  const known = new Set([
    'MISSING_DRIVER_STATE',
    'MISSING_TACHOGRAPH_HISTORY',
    'MISSING_WEEKLY_REST_STATE',
  ])
  for (const item of missingData) {
    if (
      item.startsWith('regulatory.') ||
      item.startsWith('position.') ||
      item.includes('=>') ||
      known.has(item)
    ) {
      continue
    }
    summaries.push(item)
  }
  return summaries
}
