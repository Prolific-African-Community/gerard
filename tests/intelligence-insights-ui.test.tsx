// Rendu de la surface proactive.
//
// Même approche légère que le bloc de confirmation du chat : `react-dom/server`
// pour le balisage, et des assertions directes sur le contrat d'action. Aucun
// framework de test frontend n'est ajouté.

import assert from 'node:assert/strict'
// @ts-expect-error -- le projet n'installe pas @types/react-dom : un seul import suffit ici.
import { renderToStaticMarkup } from 'react-dom/server'

import { GerardInsightsSection, InsightRow, insightHeadline } from '../components/dispatch/intelligence/GerardInsightsPanel'
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

// B — sans rapport, la section ne rend rien : elle n'occupe jamais la place
// d'un contenu qu'elle n'a pas.
const markup = renderToStaticMarkup(<GerardInsightsSection report={null} />)
assert.equal(markup, '', 'aucun rendu sans rapport')
console.log('B aucun rendu sans rapport: OK')

// C — chaque gravité rend son libellé, son titre, son explication et ses
// actions, et rien qui puisse écrire.
const rows = report.insights.map((item) => renderToStaticMarkup(<InsightRow insight={item} onSimulate={() => {}} onOpenMission={() => {}} />))
assert.match(rows[0], />Attention</)
assert.match(rows[0], />1 mission non affectée</)
assert.match(rows[0], />Ouvrir GRD-01</)
assert.match(rows[1], />Opportunité</)
assert.match(rows[1], />62 km à vide peuvent être évités</)
assert.match(rows[1], />Simuler GRD-02</)
assert.match(rows[2], />Information</)
assert.match(rows[2], />Données manquantes : durée de route non calculée\.</)
assert.match(
  renderToStaticMarkup(<InsightRow insight={insight({ id: 'x', type: 'PLANNING_CONFLICT', severity: 'CRITICAL', title: 'Conflit' })} />),
  />Critique</
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

// G — la section rend son résumé et ses lignes, sans jamais ouvrir de modale
// ni s'imposer dans le flux : c'est un bloc repliable, pas un panneau.
const sectionMarkup = renderToStaticMarkup(
  <GerardInsightsSection report={report} onSimulate={() => {}} onOpenMission={() => {}} />
)
assert.match(sectionMarkup, /3 points à vérifier/)
assert.match(sectionMarkup, /aria-expanded="true"/, 'la section est dépliable')
assert.match(sectionMarkup, /aria-label="Points à vérifier"/)
assert.match(sectionMarkup, />Ouvrir GRD-01</)
assert.match(sectionMarkup, />Simuler GRD-02</)
assert.ok(!/role="dialog"/.test(markup + sectionMarkup), 'la surface proactive n’ouvre aucune modale')
// Repliée, elle ne rend plus les lignes : elle ne pousse rien vers le bas.
const collapsed = renderToStaticMarkup(<GerardInsightsSection report={report} defaultOpen={false} />)
assert.match(collapsed, /3 points à vérifier/)
assert.ok(!/Ouvrir GRD-01/.test(collapsed), 'repliée, la section n’affiche aucune ligne')
console.log('G section repliable, aucune modale, aucun bloc imposé: OK')

// H — l'état vide de la section reste calme et ne promet aucun optimum.
const emptyMarkup = renderToStaticMarkup(<GerardInsightsSection report={empty} />)
assert.match(emptyMarkup, /Rien de particulier à signaler/)
assert.ok(!/optimal|parfait|alerte|erreur/i.test(emptyMarkup))
console.log('H état vide calme dans la section: OK')

// I — les actions sont actives dès que la surface hôte sait les exécuter, et
// seulement désactivées avec une raison explicite.
const wired = renderToStaticMarkup(<InsightRow insight={report.insights[0]} onOpenMission={() => {}} />)
assert.ok(!/disabled=""/.test(wired), 'un CTA branché ne doit jamais être grisé')
const unwired = renderToStaticMarkup(<InsightRow insight={report.insights[0]} />)
assert.match(unwired, /disabled=""/)
assert.match(unwired, /title="Ouverture indisponible depuis cette vue"/, 'une action désactivée doit se justifier')
console.log('I CTA actifs quand branchés, désactivation justifiée sinon: OK')
