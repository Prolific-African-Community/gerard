// Points d'entrée du cockpit dispatch après la simplification V1.
//
// Décision produit : « Analyser le planning » disparaît en tant qu'entrée
// autonome. Sa capacité ne disparaît pas — elle arrive par la surface proactive
// et par l'assistant. Ce test garde les deux entrées restantes et empêche la
// réapparition silencieuse de la troisième.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error -- le projet n'installe pas @types/react-dom : un seul import suffit ici.
import { renderToStaticMarkup } from 'react-dom/server'

import { DispatchToolbar } from '../components/dispatch/DispatchToolbar'

const weekStart = new Date(2035, 0, 1)
const viewOptions = [
  { value: 'planning' as const, label: 'Planning' },
  { value: 'map' as const, label: 'Carte' },
]

/** Barre de contrôles gréée comme sur le poste fixe, toutes capacités ouvertes. */
const toolbar = renderToStaticMarkup(
  <DispatchToolbar
    viewMode="planning"
    viewOptions={viewOptions}
    onViewChange={() => {}}
    selectedWeekStartDate={weekStart}
    onWeekChange={() => {}}
    onOpenSearch={() => {}}
    onOpenAssistant={() => {}}
    onOpenAutoPlanning={() => {}}
    onCompletePlanningRows={() => {}}
    onOpenImports={() => {}}
    onOpenClientProfiles={() => {}}
    onCreateMission={() => {}}
  />
)

// A — l'entrée autonome d'analyse n'existe plus.
assert.ok(!/Analyser le planning/.test(toolbar), 'la barre de contrôles ne doit plus proposer « Analyser le planning »')
console.log('A l entrée autonome « Analyser le planning » a disparu: OK')

// B — l'affectation automatique reste une action distincte et visible.
assert.match(toolbar, /Planification automatique/)
console.log('B l affectation automatique reste exposée: OK')

// C — l'assistant reste exposé.
assert.match(toolbar, /Assistant Gerard/)
console.log('C l assistant reste exposé: OK')

// D — la barre ne peut plus recevoir de rappel d'analyse : la prop a été
// retirée, pas seulement le bouton. Une réintroduction par mégarde échoue ici.
const toolbarSource = readFileSync('components/dispatch/DispatchToolbar.tsx', 'utf8')
assert.ok(!/onAnalyzePlanning/.test(toolbarSource), 'la prop d’analyse ne doit plus exister')
assert.ok(!/Analyser le planning/.test(toolbarSource))
console.log('D la prop d analyse a été retirée, pas seulement masquée: OK')

// E — aucune surface dispatch ne rend plus de déclencheur d'analyse autonome.
// Le panneau de résultats reste monté, mais uniquement piloté par la surface
// proactive (`hideTrigger` + `analyzeRef`).
for (const file of [
  'components/dispatch/WeeklyDispatchBoard.tsx',
  'components/dispatch/mobile/MobileDispatchView.tsx',
]) {
  const source = readFileSync(file, 'utf8')
  assert.ok(!/onAnalyzePlanning/.test(source), `${file} ne doit plus câbler d’action d’analyse`)
  assert.match(source, /hideTrigger/, `${file} doit masquer le déclencheur local du panneau de suggestions`)
  assert.match(source, /analyzeRef=\{openSuggestionsRef\}/, `${file} doit piloter le panneau depuis l’assistant`)
  assert.match(source, /<GerardAssistantPanel/, `${file} doit monter l’assistant`)
  assert.match(source, /<AutoPlanningPanel/, `${file} doit conserver l’affectation automatique`)
  // Le planning reste la vue reine : plus aucun panneau d'insights posé dans
  // son flux. Les insights sont consultés depuis l'assistant.
  assert.ok(!/<GerardInsightsPanel/.test(source), `${file} ne doit plus poser de bloc d’insights dans le planning`)
  assert.match(source, /useGerardInsights/, `${file} doit lire le rapport partagé`)
  assert.match(source, /assistantBadge=\{insightBadgeCount\(insights\.report\)\}/, `${file} doit porter la pastille sur l’entrée assistant`)
  assert.match(source, /insights=\{insights\.report\}/, `${file} doit transmettre le rapport à l’assistant`)
  assert.match(source, /onOpenMission=\{/, `${file} doit brancher l’ouverture de mission`)
  assert.match(source, /openSuggestionsRef\.current\?\.\(\)/, `${file} doit brancher la simulation`)
  // Le panneau de résultats est moins haut que l'assistant : sans retrait
  // préalable, il s'ouvrirait derrière lui et resterait invisible.
  assert.match(
    source,
    /setIsAssistantOpen\(false\)\s*\n\s*openSuggestionsRef\.current/,
    `${file} doit retirer l’assistant avant d’ouvrir le panneau de résultats`
  )
}
console.log('E desktop et mobile : insights dans l’assistant, CTA branchés, pastille portée: OK')

// E2 — les deux chemins d'application rafraîchissent la surface proactive. Sans
// cela, une opportunité appliquée depuis le chat resterait affichée alors
// qu'elle n'existe plus.
for (const file of [
  'components/dispatch/WeeklyDispatchBoard.tsx',
  'components/dispatch/mobile/MobileDispatchView.tsx',
]) {
  const source = readFileSync(file, 'utf8')
  const refreshingCallbacks = source.match(/onApplied=\{\(\) => \{[\s\S]*?\}\}/g) ?? []
  assert.equal(
    refreshingCallbacks.length,
    2,
    `${file} doit rafraîchir les insights depuis le panneau de suggestions ET depuis l’assistant`
  )
  for (const callback of refreshingCallbacks) {
    assert.match(callback, /setInsightsRefreshKey/, `${file} : un chemin d’application ne rafraîchit pas la surface proactive`)
  }
}
console.log('E2 les deux chemins d application rafraîchissent la surface proactive: OK')

// F — le panneau de suggestions garde son déclencheur local en propre, mais il
// n'est rendu que si personne ne le masque : la capacité reste disponible pour
// une surface future sans être exposée aujourd'hui.
const suggestionsSource = readFileSync('components/dispatch/intelligence/GerardSuggestionsPanel.tsx', 'utf8')
assert.match(suggestionsSource, /hideTrigger \? null :/, 'le déclencheur local reste conditionnel')
console.log('F le panneau de résultats reste réutilisable sans entrée visible: OK')

// G — l'affectation automatique et l'intelligence restent deux chemins séparés :
// aucun module d'intelligence ne déclenche l'auto-planification.
for (const file of [
  'lib/dispatch/intelligence/assistant.ts',
  'lib/dispatch/intelligence/insights.ts',
  'lib/dispatch/intelligence/facade.ts',
  'lib/dispatch/suggestions/application.ts',
]) {
  const source = readFileSync(file, 'utf8')
  assert.ok(
    !/applyAutoPlanning|simulateAutoPlanning|persistValidatedAutoPlanning/.test(source),
    `${file} ne doit jamais déclencher l’auto-planification`
  )
}
console.log('G aucune entrée Intelligence ne déclenche l auto-planification: OK')
