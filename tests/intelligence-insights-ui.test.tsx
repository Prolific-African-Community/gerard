// Rendu de la surface proactive.
//
// Même approche légère que le bloc de confirmation du chat : `react-dom/server`
// pour le balisage, et des assertions directes sur le contrat d'action. Aucun
// framework de test frontend n'est ajouté.

import assert from 'node:assert/strict'
// @ts-expect-error -- le projet n'installe pas @types/react-dom : un seul import suffit ici.
import { renderToStaticMarkup } from 'react-dom/server'

import { GerardInsightsPanel, InsightRow, insightHeadline } from '../components/dispatch/intelligence/GerardInsightsPanel'
import type { GerardInsight, GerardInsightReport } from '../lib/dispatch/intelligence/insights'

function insight(overrides: Partial<GerardInsight> & Pick<GerardInsight, 'id' | 'type' | 'severity' | 'title'>): GerardInsight {
  return {
    summary: 'Résumé.',
    missionIds: ['mission-1'],
    evidence: [],
    confidence: 'HIGH',
    availableActions: [],
    occursAt: null,
    score: null,
    ...overrides,
  }
}

const report: GerardInsightReport = {
  weekStart: '2034-01-02T00:00:00.000Z',
  analyzedAt: '2034-01-02T06:00:00.000Z',
  total: 3,
  bySeverity: { CRITICAL: 0, ATTENTION: 1, OPPORTUNITY: 1, INFO: 1 },
  insights: [
    insight({
      id: 'insight:UNASSIGNED_MISSION:mission-1:aaa',
      type: 'UNASSIGNED_MISSION',
      severity: 'ATTENTION',
      title: '1 mission non affectée',
      availableActions: [{ type: 'OPEN_MISSION', label: 'Ouvrir GRD-01', missionId: 'mission-1', missionReference: 'GRD-01' }],
    }),
    insight({
      id: 'insight:OPTIMIZATION_OPPORTUNITY:mission-2:bbb',
      type: 'OPTIMIZATION_OPPORTUNITY',
      severity: 'OPPORTUNITY',
      title: '62 km à vide peuvent être évités',
      availableActions: [{ type: 'SIMULATE', label: 'Simuler GRD-02', suggestionId: 'reassignment:abc:mission-2:cand', missionId: 'mission-2', proposedPairRowId: 'row-2' }],
    }),
    insight({
      id: 'insight:INCOMPLETE_CRITICAL_DATA:mission-3:ccc',
      type: 'INCOMPLETE_CRITICAL_DATA',
      severity: 'INFO',
      title: 'GRD-03 ne peut pas être évaluée complètement',
      summary: 'Données manquantes : durée de route non calculée.',
    }),
  ],
}

// A — le décompte est rendu tel quel, au singulier comme au pluriel.
assert.equal(insightHeadline(report), '3 points à vérifier')
assert.equal(insightHeadline({ total: 1 }), '1 point à vérifier')
assert.equal(insightHeadline({ total: 0 }), 'Rien de particulier à signaler sur cette semaine')
assert.equal(insightHeadline(null), 'Rien de particulier à signaler sur cette semaine')
console.log('A décompte rendu correctement: OK')

// B — les libellés de gravité apparaissent, et rien d'autre ne se déclenche au
// rendu : le panneau charge ses données dans un effet, absent côté serveur.
const markup = renderToStaticMarkup(<GerardInsightsPanel weekStart="2034-01-02" />)
assert.equal(markup, '', 'le panneau ne rend rien tant que le rapport n’est pas chargé')
console.log('B aucun rendu avant chargement, aucun effet au rendu serveur: OK')

// C — chaque gravité rend son libellé, son titre, son explication et ses
// actions, et rien qui puisse écrire.
const rows = report.insights.map((item) => renderToStaticMarkup(<InsightRow insight={item} onSimulate={() => {}} onOpenMission={() => {}} />))
assert.match(rows[0], />ATTENTION</)
assert.match(rows[0], />1 mission non affectée</)
assert.match(rows[0], />Ouvrir GRD-01</)
assert.match(rows[1], />OPPORTUNITÉ</)
assert.match(rows[1], />62 km à vide peuvent être évités</)
assert.match(rows[1], />Simuler GRD-02</)
assert.match(rows[2], />INFO</)
assert.match(rows[2], />Données manquantes : durée de route non calculée\.</)
assert.match(
  renderToStaticMarkup(<InsightRow insight={insight({ id: 'x', type: 'PLANNING_CONFLICT', severity: 'CRITICAL', title: 'Conflit' })} />),
  />CRITIQUE</
)
for (const row of rows) {
  assert.ok(!/Appliquer|Confirmer/.test(row), 'aucune ligne n’offre d’application directe')
}
// Sans rappel fourni, les contrôles restent inertes plutôt qu'absents.
assert.match(renderToStaticMarkup(<InsightRow insight={report.insights[1]} />), /disabled=""/)
for (const item of report.insights) {
  assert.ok(item.title.length > 0, 'chaque insight porte un titre court')
  assert.ok(item.summary.length > 0, 'chaque insight porte une explication')
  assert.ok(
    item.availableActions.every((action) => action.type === 'SIMULATE' || action.type === 'OPEN_MISSION'),
    'aucune action d’insight ne peut écrire'
  )
}
console.log('C gravités, titres, explications et actions en lecture seule rendus: OK')

// D — aucune action d'insight n'est une application. La seule voie d'écriture
// reste SIMULATE puis la confirmation existante.
const actionTypes = new Set(report.insights.flatMap((item) => item.availableActions.map((action) => action.type)))
assert.deepEqual(Array.from(actionTypes).sort(), ['OPEN_MISSION', 'SIMULATE'])
assert.ok(!Array.from(actionTypes).includes('CONFIRM_APPLY' as never))
assert.ok(!Array.from(actionTypes).includes('APPLY' as never))
console.log('D aucune application directe depuis un insight: OK')

// E — l'état vide est calme : il n'emploie aucun vocabulaire d'alarme.
const empty: GerardInsightReport = { ...report, total: 0, insights: [], bySeverity: { CRITICAL: 0, ATTENTION: 0, OPPORTUNITY: 0, INFO: 0 } }
const emptyHeadline = insightHeadline(empty)
assert.ok(!/alerte|problème|erreur|urgent|risque/i.test(emptyHeadline), `état vide alarmant : ${emptyHeadline}`)
assert.match(emptyHeadline, /Rien de particulier à signaler/)
// La formulation ne promet pas un optimum : le moteur ne le démontre pas.
assert.ok(!/optimal|optimis[ée]|parfait|meilleur/i.test(emptyHeadline))
console.log('E état vide calme: OK')

// F — une opportunité résolue disparaît du rapport suivant : le composant ne
// conserve aucun insight entre deux chargements, il rend ce qu'on lui donne.
const afterApply: GerardInsightReport = {
  ...report,
  total: 2,
  bySeverity: { CRITICAL: 0, ATTENTION: 1, OPPORTUNITY: 0, INFO: 1 },
  insights: report.insights.filter((item) => item.type !== 'OPTIMIZATION_OPPORTUNITY'),
}
assert.equal(afterApply.insights.some((item) => item.type === 'OPTIMIZATION_OPPORTUNITY'), false)
assert.equal(insightHeadline(afterApply), '2 points à vérifier')
console.log('F opportunité résolue absente du rapport suivant: OK')

// G — la variante compacte du mobile reste un rendu valide et sans modale.
const compactMarkup = renderToStaticMarkup(<GerardInsightsPanel weekStart="2034-01-02" compact />)
assert.equal(compactMarkup, '')
assert.ok(!/role="dialog"/.test(markup + compactMarkup), 'la surface proactive n’ouvre aucune modale')
console.log('G variante compacte valide, aucune modale: OK')
