# Gerard Intelligence — contrat V1

Version finale V1, close au Run 5. Construite au Run 1 (architecture et cycle de
vie), Run 2 (application depuis l'assistant après confirmation structurée),
Run 3 (classement multicritère déterministe), Run 4 (fraîcheur des routes et
surface proactive), Run 5 (simplification produit et observabilité). Ce document
décrit l'état réel du code, pas une cible produit.

## Modèle utilisateur

Le cockpit dispatch expose **deux** entrées, pas trois :

| Entrée | Intention | Portée |
| --- | --- | --- |
| **Affectation automatique** | « Fais le planning » | Flux de planification lourd, pouvant toucher de nombreuses missions. Action explicite et séparée. |
| **Assistant Gerard** | « Aide-moi à comprendre et à améliorer » | Analyse, explication, simulation, puis application d'**une** suggestion après confirmation. |

À côté, **Gerard Intelligence** est la surface proactive : elle se charge avec le
planning et ne demande aucun clic pour exister.

L'entrée autonome « Analyser le planning » a été **retirée de l'interface** au
Run 5. Sa capacité n'a pas disparu : l'analyse arrive d'elle-même par la surface
proactive, reste interrogeable par l'assistant, et l'API `analyze` ainsi que le
moteur d'analyse sont inchangés. Le panneau de résultats « Gerard suggère »
existe toujours et s'ouvre depuis un insight d'optimisation.

Vocabulaire exposé : « Affectation automatique », « Assistant Gerard »,
« Gerard Intelligence ». Les notions internes — score, empreinte de snapshot,
empreinte de preuve, fraîcheur de route — ne sont jamais montrées.

## Architecture actuelle

Distribution : `@prolific/gerard-core/intelligence`
(`packages/gerard-core/src/intelligence.ts`) est une façade de réexport pure. Les
routes API n'importent jamais `lib/` directement — contrainte vérifiée par
`tests/core-boundaries.test.ts`.

| Couche | Fichier | Rôle |
| --- | --- | --- |
| Routeur déterministe | `lib/dispatch/intelligence/intent-router.ts` | Regex FR → intention + entités. Valide aussi la sortie du modèle (`parseModelIntent`). |
| Routeur LLM | `lib/dispatch/intelligence/llm-router.ts` | OpenAI `/v1/responses`, `json_schema` strict, timeout 8 s. Classe une intention, ne produit aucun fait. |
| Assistant | `lib/dispatch/intelligence/assistant.ts` | Orchestration, formulation des réponses, exécution d'une confirmation structurée. |
| Action en attente | `lib/dispatch/intelligence/pending-action.ts` | Jeton HMAC liant utilisateur, suggestion, empreinte, semaine et clé d'idempotence. |
| Façade métier | `lib/dispatch/intelligence/facade.ts` | Contextes planning / mission / ressource, simulation, explication. |
| Moteur de suggestions | `lib/dispatch/suggestions/planning-service.ts`, `planning-analysis.ts`, `reassignment-efficiency.ts` | Analyse, candidats, seuils, classement. |
| Application | `lib/dispatch/suggestions/application.ts` | Seule écriture métier du périmètre Intelligence. |
| Snapshot partagé | `lib/dispatch/auto-planning/snapshot.ts` | `buildAutoPlanningSnapshot` + `fingerprintSnapshot`, réutilisés tels quels. |

| Surface proactive | `lib/dispatch/intelligence/insights.ts` | Insights déterministes, lecture seule, calculés depuis les moteurs existants. |
| Observabilité | `lib/dispatch/intelligence/observability.ts` | Journaux structurés d'analyse, simulation, confirmation et application. |

Routes (`pages/api/dispatch/intelligence/`) : `analyze`, `insights`, `simulate`,
`assistant`, `apply`. Toutes sous `withTenantApiRoute`.

UI, montée par `WeeklyDispatchBoard.tsx` et `MobileDispatchView.tsx` :

- `GerardInsightsPanel.tsx` — surface proactive, chargée avec le planning.
- `GerardSuggestionsPanel.tsx` — panneau de résultats, **sans entrée autonome**
  depuis le Run 5 : il s'ouvre depuis un insight d'optimisation
  (`hideTrigger` + `analyzeRef`).
- `GerardAssistantPanel.tsx` — conversation, simulation et confirmation.

Les deux chemins d'application rafraîchissent le planning **et** la surface
proactive via `onApplied`.

## Capacités existantes

- **Assistant** : 8 intentions (`PLANNING_SUMMARY`, `MISSION_CONTEXT`,
  `MISSION_ALTERNATIVES`, `RESOURCE_EXPLANATION`, `PLANNING_SUGGESTIONS`,
  `SUGGESTION_EXPLANATION`, `SIMULATE_SUGGESTION`, `UNKNOWN`). Routeur regex
  d'abord ; le LLM n'est appelé que sur `UNKNOWN` sans demande d'écriture.
  Repli `FALLBACK` si le provider échoue. `routing` expose
  `source` / `providerCalls` / `providerDurationMs`.
- **Contexte conversationnel** : porté par le client, limité à
  `{ missionReference, suggestionId }`. Aucun historique serveur.
- **Suggestions** : un seul type, `REASSIGNMENT_EFFICIENCY`. Id
  `reassignment:<fingerprint[0..16]>:<missionId>:<candidateId>`, donc lié au
  snapshot. Seuils via `defaultGerardApplication.policies.assignmentScoring`.
  Diagnostics par mission et agrégés (`noValidAlternative`, `belowThreshold`,
  `incomplete`), `affectedMissionIds` et `affectedResources` renseignés.
- **Simulation** : réanalyse complète puis sélection par
  `(missionId, proposedPairRowId)` côté route, ou par `suggestionId` désigné côté
  assistant. Elle revalide l'état courant sans produire d'information absente de
  l'analyse. Depuis le Run 2, **aucun repli sur « la première suggestion »** :
  une simulation sans suggestion désignée rend `UNDESIGNATED`.
- **Assistant applicateur** : après une simulation valide, l'assistant émet une
  action `CONFIRM_APPLY` portant un jeton signé. La confirmation explicite de ce
  jeton, et elle seule, appelle `applyPlanningSuggestion`. Un message libre ne
  vaut jamais confirmation.
- **Application** : `applyPlanningSuggestion` — idempotence, verrou consultatif
  PostgreSQL par organisation et semaine, isolation `Serializable`,
  revérification complète avant écriture, `MissionEvent` +
  `DispatchOptimizationApplication`.
- **Auto-planning** : `lib/dispatch/auto-planning/` fournit le snapshot et son
  empreinte à Intelligence. Ses couches `simulation.ts` / `application.ts` /
  `token.ts` restent séparées : périmètre différent (planification de missions
  non affectées) et jeton HMAC propre.

## Garanties existantes

| Garantie | État | Implémentation | Test |
| --- | --- | --- | --- |
| Frontière tenant imposée côté serveur | VERIFIED | extension Prisma `organization-scope` (`lib/prisma.ts`) : injection forcée, exception si contexte absent | `tests/multi-tenant-isolation.test.ts`, `tests/intelligence-apply-contract.test.ts` (C) |
| Permissions vérifiées côté serveur | VERIFIED | `analyze`/`simulate`/`assistant` → `dispatch.view` ; `apply` → `dispatch.assign` ; modules `INTELLIGENCE` / `ASSISTANT` | `tests/intelligence-assistant.test.ts` (K, 401) |
| Suggestion issue d'un snapshot planning | VERIFIED | `intelligenceFingerprint` (métier uniquement, routes revalidées à part) ; id préfixé par l'empreinte | `tests/intelligence-apply-contract.test.ts` (A) |
| Suggestion périmée non applicable | VERIFIED | triple garde : réanalyse + comparaison d'empreinte, `buildMutationPlan`, revérification `updatedAt` dans la transaction | `intelligence-apply.integration.ts` (C, M) |
| Application idempotente | VERIFIED | `@@unique([organizationId, idempotencyKey])` + relecture `resultSummary` avant et dans la transaction | `intelligence-apply.integration.ts` (B, K) |
| Application transactionnelle | VERIFIED | `$transaction` `Serializable` + `pg_advisory_xact_lock` | `intelligence-apply.integration.ts` (A) |
| Contraintes métier revalidées juste avant écriture | VERIFIED | statuts chauffeur/camion/remorque, cohérence `PlanningRow`, `findResourceOccupationConflicts` | `intelligence-apply.integration.ts` (D2, N) |
| Événement et audit écrits | VERIFIED | `MissionEvent` (`origin: GERARD_INTELLIGENCE`) + `DispatchOptimizationApplication` dans la même transaction | `intelligence-apply.integration.ts` (A, F) |
| Conflit de concurrence signalé, jamais avalé | VERIFIED | `SuggestionApplicationError` + `P2034` → HTTP 409 | `intelligence-apply.integration.ts` (D1) |
| Confirmation explicite avant application | VERIFIED | `applicability.requiresExplicitConfirmation` ; jeton `CONFIRM_APPLY` ; UI à double étape des deux panneaux | `intelligence-apply-contract.test.ts` (B), `intelligence-apply.integration.ts` (G, H/I) |
| Un message libre n'écrit jamais | VERIFIED | `requestsMutation` → au mieux une action confirmable, jamais un appel à l'application | `intelligence-assistant.test.ts` (J), `intelligence-apply.integration.ts` (G) |
| Le LLM ne peut fournir ni suggestion, ni empreinte, ni clé | VERIFIED | paramètres d'écriture relus dans le jeton signé, jamais dans le corps de requête ni la sortie du modèle | `intelligence-pending-action.test.ts`, `intelligence-apply.integration.ts` (J, P) |
| L'application depuis le chat exige `dispatch.assign` | VERIFIED | `canApply` côté assistant, plus `requirePermission(dispatchAssign)` sur la branche de confirmation de la route | `intelligence-apply.integration.ts` (L) |
| Échec LLM sans effet sur les règles métier | VERIFIED | le LLM ne produit qu'une intention, validée par `parseModelIntent` ; repli `FALLBACK` | `tests/intelligence-assistant.test.ts` (routeur, TIMEOUT, INVALID_OUTPUT) |
| Réversibilité d'une application | **MISSING** | aucun chemin d'annulation ; l'état précédent n'est conservé que dans `MissionEvent.metadata.previousAssignment` | — |
| Traçabilité d'une simulation | **MISSING** | aucune persistance : une simulation ne laisse aucune trace | — |

## Lacunes suivies, et leur sort

Toutes les lacunes ouvertes pendant la construction ont ete closes, sauf celles
listees dans "Limites connues de la V1".

| Lacune | Sort |
| --- | --- |
| A1, A2, A3 assistant non applicateur | closes au Run 2 |
| B1 absence de jeton signe | close au Run 2 |
| A5 cle d'idempotence cliente | close au Run 3 : une seule primitive serveur |
| B2 rejeu opaque en 500 | close au Run 3 : conflit explicite |
| D2 pas d'action d'application dans le chat | close au Run 2 |
| D3 rejeu indistinct dans le panneau | close au Run 3 |
| E1 erreurs de `simulate` non structurees | close au Run 3 |
| E2 statut fournisseur invisible | close au Run 3 |
| E3 aucune metrique exploitable | close au Run 5 : voir "Observabilite" |
| T1 chemin d'ecriture non teste | close au Run 2 |
| T2 facade testee seulement via l'assistant | close au Run 4 |
| T3 route `simulate` non testee | close au Run 3 |
| T4 aucun test de rendu | close au Run 3, etendu au Run 4 et au Run 5 |
| C2 derive de route | close au Run 4 : empreinte de preuve |
| D1 aucune surface proactive | close au Run 4 |
| A4 `getPlanningSuggestions` aliase | close au Run 5 : l'entree autonome disparait, l'intention reste servie par la meme analyse |
| C1 un seul type de suggestion | reste ouverte, assumee |
| B3 course en transaction | reste ouverte, assumee |

## Cycle de vie V1 d'une suggestion

Le cycle est **fonctionnel et sans état persistant** : aucun enum ni modèle en
base. Chaque étape recalcule depuis le planning.

| Étape | Source de vérité | Entrées requises | Validation | Écriture | Permission | Sortie |
| --- | --- | --- | --- | --- | --- | --- |
| `ANALYZED` | planning + snapshot du jour | `weekStart` | snapshot constructible | non | `dispatch.view` + module `INTELLIGENCE` | `PlanningSuggestionAnalysis` (`snapshotFingerprint`, `summary`, `diagnostics`) |
| `SUGGESTED` | `detectReassignmentEfficiency` | candidat courant valide + alternatives | compatibilité, temporalité, occupations, confiance, seuils économiques | non | idem | `GerardSuggestion[]`, `availableActions` |
| `SIMULATED` | réanalyse | `weekStart`, plus `(missionId, proposedPairRowId)` via la route ou `suggestionId` via l'assistant | la suggestion existe encore dans l'analyse fraîche ; aucune suggestion par défaut | non | idem | `status` `VALID`, `STALE` ou `UNDESIGNATED`, plus `suggestion` et `snapshotFingerprint` |
| `CONFIRMATION_REQUIRED` | serveur | suggestion `VALID` | `requiresExplicitConfirmation` ; l'action n'est émise qu'avec `dispatch.assign` | non | `dispatch.view` pour lire, `dispatch.assign` pour recevoir l'action | panneau : dialogue local + `idempotencyKey` client. Chat : action `CONFIRM_APPLY` signée, `idempotencyKey` serveur |
| `APPLIED` | transaction | `suggestionId`, `weekStart`, `snapshotFingerprint`, `idempotencyKey` — relus dans le jeton signé pour le chemin chat | réanalyse, empreinte, `updatedAt` de l'affectation, statuts ressources, occupations | **oui** | `dispatch.assign` + module `INTELLIGENCE` | `status` `APPLIED`, `missionId`, `assignmentId`, `applicationId` |

États terminaux, tels que déjà nommés dans le code
(`SuggestionApplicationStatus`) :

- `STALE` — le planning a changé (empreinte ou `updatedAt` divergents). HTTP 409.
- `CONFLICT` — ressource indisponible ou occupée, `P2034`, ou clé d'idempotence
  appartenant à un autre utilisateur. HTTP 409.
- `INVALID` — demande mal formée ou suggestion inconnue. HTTP 400.
- `ALREADY_APPLIED` — rejeu idempotent. HTTP 200.

Il n'existe pas d'état `REJECTED` : un refus utilisateur est purement client et
ne laisse aucune trace. Conservé tel quel pour V1.

Comportement en cas de péremption : refus explicite avec message invitant à
relancer l'analyse. Aucun repli silencieux, aucune application partielle.

## Contrat d'action de l'assistant

Le LLM n'autorise jamais une mutation. Il ne produit qu'une intention validée par
`parseModelIntent` ; le backend déterministe seul décide.

Contrat V1 (figé au Run 2) :

```ts
type GerardAssistantAction =
  | { type: 'SIMULATE'; label: string; suggestionId: string }
  | {
      type: 'CONFIRM_APPLY'
      label: string
      suggestionId: string
      missionReference: string // pour la question de confirmation
      snapshotFingerprint: string
      idempotencyKey: string
      summary: string
      /** Porteur autorisé des quatre valeurs ci-dessus, signé par le serveur. */
      token: string
    }
```

La confirmation renvoyée au serveur est `{ token: string }`, et rien d'autre.

Règles :

- Les champs lisibles de l'action servent uniquement à l'affichage. Le serveur
  relit `suggestionId`, `snapshotFingerprint`, `weekStart` et `idempotencyKey`
  dans le jeton : une action modifiée dans le navigateur ou reformulée par le
  modèle n'a aucun effet sur l'écriture.
- Le jeton est un HMAC `JWT_SECRET` lié à l'utilisateur et expirant en 15 minutes,
  sur le modèle de `auto-planning/token.ts`. Il ne transporte aucune organisation :
  la frontière tenant reste celle du contexte serveur.
- `idempotencyKey` est émis par le serveur pour le chemin chat. Le panneau de
  suggestions continue de la générer côté client, comportement inchangé.
- Une action `CONFIRM_APPLY` n'est émise que si l'appelant a `dispatch.assign` et
  le module `INTELLIGENCE`. La branche de confirmation de la route revérifie les
  deux explicitement, sans se reposer sur le `dispatch.view` de la lecture.
- Un texte libre (« Applique-la », « Vas-y », « Fais-le », « OK applique ») est
  reconnu comme une demande d'écriture par le routeur déterministe, et ne peut
  produire qu'une action confirmable sur la suggestion déjà désignée dans la
  conversation. Jamais une écriture.
- Le contexte conversationnel reste minimal :
  `{ missionReference?, suggestionId? }`, plus l'action en attente côté client.
  Aucun historique de conversation persistant.

## Invariants de sûreté

1. Aucune mutation métier depuis du texte libre de l'assistant.
2. Confirmation explicite de l'utilisateur obligatoire avant application.
3. L'application exige `dispatch.assign`.
4. L'application revérifie fraîcheur et contraintes métier juste avant l'écriture.
5. Péremption ou conflit → refus explicite, jamais de repli silencieux.
6. Le double envoi est idempotent.
7. La frontière tenant est imposée côté serveur, par défaut.
8. Un échec LLM ne peut pas affaiblir une règle métier.
9. Les défaillances de route ou de provider sont remontées dans les diagnostics.
10. Aucune application automatique en arrière-plan en V1.

## Contraintes dures

Une contrainte dure décide si un candidat a le **droit d'exister**. Elle est
appliquée avant tout score, dans `hasUsableAlternative`
(`lib/dispatch/suggestions/reassignment-efficiency.ts`), et n'est **jamais**
compensée par un bénéfice économique :

- compatibilité `COMPATIBLE` sans aucun autre code,
- faisabilité temporelle `FEASIBLE`,
- aucune occupation concurrente de chauffeur, camion ou remorque,
- aucune donnée manquante sur la mission, la compatibilité ou la temporalité,
- routes connues, de source fiable et de confiance non basse,
- confiance d'optimisation non basse, et au moins égale à celle de la baseline.

La baseline elle-même doit être exploitable (`hasUsableBaseline`), sinon aucune
comparaison n'est tentée. Un candidat écarté ici ne reçoit aucun score et
n'apparaît jamais, quelle que soit son économie apparente.

## Modèle de classement V1

Les critères souples classent uniquement des candidats déjà valides. Toutes les
composantes sont normalisées avant pondération : aucune grandeur brute, euro ou
kilomètre, ne peut écraser les autres. Poids et références sont centralisés dans
`lib/dispatch/suggestions/scoring.ts`.

```
score = 1.00 × distanceÀVide        (composante dans [-1, 1])
      + 0.50 × marge × amortissement (composante dans [-1, 1])
      + 0.20 × continuité            (composante dans [0, 1])
      − 0.25 × incertitude           (composante dans [0, 1])
```

| Composante | Calcul | Unité d'origine |
| --- | --- | --- |
| `EMPTY_DISTANCE` | `gainKm / max(kmÀVideActuels, 25)`, borné à [-1, 1] | kilomètres mesurés |
| `MARGIN` | `gainMarge / 150 €`, borné, puis multiplié par l'amortissement économique | euros estimés |
| `CONTINUITY` | part des ressources conservées parmi chauffeur, camion, remorque, moins 1/3 si un changement de remorque est planifié | identités observables |
| `UNCERTAINTY` | moyenne de trois pénalités : routes non Google/non hautes, confiances d'optimisation non hautes, base économique | — |

Amortissement économique : `MEASURED` 1,0 · `ESTIMATED` 0,6 · `UNAVAILABLE` 0.

Aujourd'hui Gerard ne dispose que de paramètres de coût constants
(`defaultOptimizationCostParameters` : 0,60 €/km, 25 €/h). Une marge disponible
est donc toujours `ESTIMATED`, jamais `MEASURED` : son poids effectif est
0,50 × 0,6 = **0,30**, contre 1,00 pour la distance à vide. Une estimation
économique ne peut pas renverser un avantage opérationnel net ; elle départage
des candidats proches.

Classement : score décroissant, puis gain de kilomètres, puis marge, puis score
du moteur d'optimisation, puis identifiant de candidat. L'ordre est total et
indépendant de l'ordre d'entrée.

Le contrat produit reste **une suggestion par mission**. Les trois meilleures
alternatives sont exposées dans `rankedAlternatives` comme métadonnée : aucune
expansion d'interface n'est imposée.

## Matérialité

Une réaffectation n'est proposée que si elle franchit **deux** filtres :

1. un seuil d'amélioration : `gainKm ≥ 20 km`, ou — seulement si la comparaison
   économique est disponible — `économieCoût ≥ 20 €` ou `gainMarge ≥ 20 €`
   (`defaultGerardApplication.policies.assignmentScoring`, surchargeable par une
   application Custom) ;
2. un gain composite minimal : `score ≥ 0,15`
   (`reassignmentScoringReferences.minimumScoreImprovement`).

Le second filtre est l'apport du Run 3. L'ancienne règle était un simple OU :
un candidat pouvait passer sur la seule économie estimée d'un gain de temps
valorisé au tarif par défaut, sans bénéfice opérationnel réel.

## Sémantique de la confiance

La confiance décrit la **fiabilité des données et de l'analyse**, pas une
probabilité que Gerard ait raison.

- `HIGH` — routes et entrées opérationnelles disponibles des deux côtés, aucune
  donnée manquante, comparaison économique disponible.
- `MEDIUM` — faisabilité opérationnelle vérifiée, mais une partie des entrées est
  estimée ou la comparaison économique manque.
- `LOW` — n'est jamais proposé : une entrée matérielle absente est une contrainte
  dure, donc le candidat est écarté en amont.

`scoreBreakdown.economicBasis` porte la nuance que la confiance seule ne dit
pas, et l'interface comme l'assistant l'énoncent : « économie estimée à partir
des paramètres de coût par défaut ».

## Explicabilité

`GerardSuggestion.scoreBreakdown` expose `total`, les quatre composantes avec
leur valeur normalisée, leur poids, leur contribution signée et une formulation
factuelle, plus `primaryReason`. `describeSuggestion` et la carte de suggestion
en dérivent leur texte : aucune explication n'est reconstruite à partir des
seuls chiffres d'impact, et le modèle de langage ne recalcule jamais le
classement.

Le score interne n'est pas affiché au répartiteur : un « 82/100 » n'aurait pas
de sens opérationnel.

## Critères différés

Gerard **n'optimise pas encore**, faute de données structurées fiables :

- préférence chauffeur ou client,
- qualité du temps de travail au-delà des contraintes réglementaires déjà dures,
- positionnement futur du véhicule pour les missions suivantes,
- coûts réels par ressource (consommation, coût horaire réel du chauffeur),
- équilibrage de charge entre chauffeurs sur la semaine,
- apprentissage des décisions du répartiteur.

Chacun exige une source de données ou une règle métier qui n'existe pas
aujourd'hui. Aucun n'est approximé par une heuristique inventée.

## Fraîcheur des routes

L'empreinte de snapshot ne couvre **pas** les résultats de route, et l'identité
d'une suggestion est purement structurelle
(`reassignment:<empreinte[0..16]>:<missionId>:<missionId:pairRowId:trailerId>`).
Or les kilomètres à vide, l'économie et donc le score dérivent entièrement des
routes, et les valeurs du cache de routes sont réécrites en place
(`routeCache.upsert`, script `routes:backfill-cache`).

Ce que la réanalyse serveur protégeait déjà : si la dérive rend le candidat
invalide, immatériel ou non premier, il n'est plus trouvé par son identifiant et
l'application sort en `STALE`. Restait un écart : une dérive qui laisse la
suggestion valide, matérielle et première, mais change l'ampleur du gain. Une
confirmation donnée sur « 137 km gagnés » pouvait s'appliquer sur « 25 km ».

Décision V1 : une seconde empreinte, `GerardSuggestion.evidenceFingerprint`,
couvre exactement les faits montrés et classés — kilomètres à vide, coût, marge,
score et routes des deux candidats. Elle est signée dans le jeton d'action et
revérifiée par `applyPlanningSuggestion` ; un écart sort en `STALE` avec un
message distinct. L'empreinte globale de planning n'est pas redéfinie.

## Contrat d'insight proactif

`lib/dispatch/intelligence/insights.ts` calcule, à la demande et sans rien
persister, un `GerardInsightReport` :

```ts
type GerardInsight = {
  id: string            // insight:<type>:<sujet>:<hash d'état>
  type: GerardInsightType
  severity: GerardInsightSeverity
  title: string         // une ligne
  summary: string       // une explication factuelle
  missionIds: string[]
  evidence: Array<{ code: string; label: string; value?: string | number | null }>
  confidence: 'HIGH' | 'MEDIUM'
  availableActions: GerardInsightAction[]   // OPEN_MISSION | SIMULATE
  occursAt: string | null
  score: number | null  // matérialité, pour les opportunités
}
```

Aucune logique métier nouvelle : chaque famille dérive d'un moteur existant.
Route : `POST /api/dispatch/intelligence/insights`, `dispatch.view` + module
`INTELLIGENCE`, lecture seule, sans appel au fournisseur de modèle.

## Types d'insight V1

| Type | Déclencheur | Preuve | Disparaît quand |
| --- | --- | --- | --- |
| `UNASSIGNED_MISSION` | mission `PENDING` de la semaine sans affectation | statut, date d'enlèvement | la mission est affectée ou sort de la semaine |
| `PLANNING_CONFLICT` | `findResourceOccupationConflicts` sur les affectations de la semaine | ressources partagées, fin d'occupation connue ou non | le chevauchement cesse |
| `OPTIMIZATION_OPPORTUNITY` | une suggestion du moteur du Run 3 | kilomètres évités, marge estimée, score | la suggestion est appliquée ou cesse d'être matérielle |
| `INCOMPLETE_CRITICAL_DATA` | mission affectée privée d'un champ exigé par l'analyse | la liste exacte des champs manquants | les champs sont renseignés |

`LOW_OR_NEGATIVE_MARGIN` est **exclu de la V1**. L'économie de Gerard repose
entièrement sur des paramètres de coût constants (0,60 €/km, 25 €/h) : une marge
« négative » serait un artefact de tarification par défaut, pas une observation.
L'annoncer comme un fait serait malhonnête. À reconsidérer quand
`economicBasis` pourra valoir `MEASURED`.

## Gravité et priorisation

`CRITICAL` l'exploitation est invalide ou bloquée · `ATTENTION` une action est
nécessaire · `OPPORTUNITY` une amélioration valide existe, le plan reste tenable
· `INFO` contexte sur des données incomplètes, sans défaillance immédiate.

La gravité dérive de faits structurés uniquement : une mission non affectée est
`ATTENTION`, et `CRITICAL` si son enlèvement est déjà passé. Le modèle de
langage ne choisit jamais une gravité.

Ordre : gravité, puis urgence opérationnelle (`occursAt`), puis matérialité
(`score`), puis identifiant. Total, stable, indépendant de l'ordre de calcul.
Cinq insights sont rendus par défaut (`insightDisplayLimit`) ; `total` reste
complet et l'interface propose « Voir tout ».

## Déduplication et rafraîchissement

L'identifiant encode le type, le sujet et un condensé de l'état : le même
problème dans le même état ne produit qu'un insight, et un changement d'état
change l'identifiant. Pour une opportunité, l'état est
`evidenceFingerprint`, donc l'insight suit exactement la suggestion annoncée. Un
chevauchement détecté dans les deux sens est réduit à une seule entrée. Aucune
persistance, aucun état de rejet : quand la cause disparaît, l'insight disparaît.

Le rafraîchissement réutilise les mécanismes existants : changement de semaine,
et `onApplied` des panneaux suggestion et assistant, qui incrémentent une clé de
rafraîchissement. Pas de sondage, pas de tâche de fond, pas de notification.

## Relation avec l'assistant

Les deux surfaces partagent les mêmes faits : `getPlanningInsights` vit dans la
façade et le résumé de planning de l'assistant en tire son nombre de points à
vérifier. Une opportunité proactive et la réponse à « qu'est-ce qu'il y a à
optimiser ? » proviennent de la même analyse. Le modèle reste cantonné à
l'intention et à la formulation.

Une action d'insight ne peut pas écrire : elle ouvre une mission ou lance la
**simulation existante**, qui mène ensuite à la confirmation explicite et à
`applyPlanningSuggestion`. Il n'existe aucun second chemin d'application.

## Limites de la surface proactive

- Aucune persistance, donc aucun rejet mémorisé : un insight réapparaît tant que
  sa cause existe.
- Le calcul est synchrone à l'ouverture de la semaine ; il n'existe ni analyse
  planifiée ni notification.
- `PLANNING_CONFLICT` ne couvre que les chevauchements de ressources entre deux
  affectations de la semaine analysée.
- `INCOMPLETE_CRITICAL_DATA` ne couvre que les champs exigés par l'analyse de
  réaffectation, pas l'exhaustivité métier d'une mission.

## Séparation avec l'affectation automatique

Les deux flux restent distincts, et c'est délibéré : l'auto-planification peut
toucher de nombreuses missions d'un coup, Gerard Intelligence applique **une**
suggestion à la fois après confirmation nominative.

| | Gerard Intelligence | Affectation automatique |
| --- | --- | --- |
| Déclenchement | proactif (lecture) ou question | action explicite de l'utilisateur |
| Portée d'écriture | une affectation, confirmée | un lot de missions |
| Jeton | `pending-action.ts` | `auto-planning/token.ts` |
| Écriture | `applyPlanningSuggestion` | `applyAutoPlanning` |

Aucun module Intelligence n'appelle `applyAutoPlanning`, `simulateAutoPlanning`
ni `persistValidatedAutoPlanning`, et aucun insight ne peut la déclencher —
vérifié par `tests/intelligence-entry-points.test.tsx` (cas G).

## Observabilité

Journaux structurés, une ligne par évènement, préfixe `[gerard.intelligence]`,
charge utile JSON. Aucun modèle de base ajouté :
`lib/dispatch/intelligence/observability.ts`.

| Évènement | Portée |
| --- | --- |
| `analysis.started` / `analysis.completed` / `analysis.failed` | durée, missions analysées, missions incomplètes, suggestions, métriques de routes |
| `insights.completed` | volume et répartition par gravité |
| `simulation.requested` / `simulation.completed` / `simulation.failed` | issue `VALID` ou `STALE` |
| `confirmation.offered` | action proposée, sans jeton ni clé |
| `application.attempted` / `application.completed` / `application.refused` / `application.failed` | issue `APPLIED`, `ALREADY_APPLIED`, `STALE`, `CONFLICT`, `INVALID` |
| `assistant.routed` | routage déterministe ou repli fournisseur |
| `provider.degraded` | panne ou sortie inexploitable du fournisseur (niveau `warn`) |

Chaque évènement porte l'organisation — lue dans le contexte serveur, jamais
fournie par l'appelant — et, selon le cas, la semaine, la suggestion, la
mission et l'utilisateur. Ne sont **jamais** journalisés : jetons, clés
d'idempotence, secrets, messages d'utilisateur, charges utiles de fournisseur.
Les métriques de routes viennent de l'opération déjà mesurée : aucun appel payant
n'est ajouté pour observer.

## Validation manuelle

`scripts/qa-intelligence-chat-apply.ts` monte une organisation jetable avec son
planning, son utilisateur et son cache de routes amorcé par un fournisseur
déterministe — utile parce qu'un poste local n'a pas de clé Google :

```bash
npm run qa:intelligence-chat:create   # --week=AAAA-MM-JJ pour choisir la semaine
npm run qa:intelligence-chat:verify
npm run qa:intelligence-chat:cleanup
```

Aucune donnée opérationnelle n'est touchée : tout porte le préfixe
`QA_CHAT_APPLY_` et vit dans sa propre organisation.

## Limites connues de la V1

- **Économie jamais mesurée.** Les coûts sont des constantes (0,60 €/km, 25 €/h),
  donc `economicBasis` vaut toujours `ESTIMATED`, la composante marge reste
  amortie et `LOW_OR_NEGATIVE_MARGIN` reste hors périmètre.
- **Course en transaction (B3)** non testée : voir ci-dessous.
- **Aucune persistance d'insight** : pas de rejet mémorisé, un insight
  réapparaît tant que sa cause existe.
- **Aucune exécution différée** : pas d'analyse planifiée, pas de notification,
  pas de tâche de fond. Tout est calculé à l'ouverture de la semaine.
- `PLANNING_CONFLICT` ne couvre que les chevauchements de ressources entre deux
  affectations de la semaine analysée.
- `INCOMPLETE_CRITICAL_DATA` ne couvre que les champs exigés par l'analyse de
  réaffectation, pas l'exhaustivité métier d'une mission.
- Un seul type de suggestion : `REASSIGNMENT_EFFICIENCY`.
- **Couverture d'interface légère** : rendu serveur et machine d'états, pas de
  simulation de clic réelle.
- L'observabilité est un journal structuré, sans agrégation ni tableau de bord.

## Reporté explicitement

Économie mesurée nécessitant un changement de modèle, insights de marge fondés
sur des estimations seules, persistance des rejets, notifications, tâches de
fond, apprentissage des décisions du répartiteur ou des préférences client,
application automatique, annulation, nouvelles familles de suggestions,
refonte d'interface, tableau de bord analytique.

## Course en transaction (B3) — risque résiduel assumé

Le `CONFLICT` de ressource pure n'est atteignable qu'entre la réanalyse serveur
et la transaction. Toute invalidation observable modifie aussi le snapshot
métier et sort donc en `STALE` avant d'atteindre ce contrôle. Le reproduire
exigerait une couture d'injection dans `applyPlanningSuggestion`, c'est-à-dire
de la complexité de production au seul service du test.

Décision : ne pas la forcer. La frontière reste l'isolation `Serializable`, le
verrou consultatif par organisation et semaine, la revérification des ressources
et des occupations dans la transaction, et la traduction explicite de `P2034` et
`P2002` en 409. Ce qui est couvert par test : les entrées du détecteur de
conflit, le refus sans écriture lors d'une invalidation métier, et le mappage
`P2002` → 409. Ce qui ne l'est pas : la fenêtre de course elle-même. Risque
résiduel assumé et documenté.

## Hors périmètre V1

Nouveaux types de suggestion, apprentissage ou scoring adaptatif, surface
proactive, tâches de fond, application automatique, annulation d'une
application, persistance des simulations ou de l'historique de conversation,
nouveaux modèles de base de données, système de notification, et toute
unification avec `lib/dispatch/auto-planning/`.
