# Gerard Intelligence — contrat V1

Figé au Run 1 (2026-09-27), étendu au Run 2 (2026-09-27) : l'assistant peut
désormais appliquer une suggestion, uniquement après confirmation structurée. Ce
document décrit l'état réel du code, pas une cible produit. Toute évolution passe
par un Run explicite.

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

Routes (`pages/api/dispatch/intelligence/`) : `analyze`, `simulate`, `assistant`,
`apply`. Toutes sous `withTenantApiRoute`.

UI : `components/dispatch/intelligence/GerardSuggestionsPanel.tsx` et
`GerardAssistantPanel.tsx` suivent tous deux analyse → simulation →
confirmation explicite → application, montés par `WeeklyDispatchBoard.tsx` et
`MobileDispatchView.tsx`. Les deux rafraîchissent le planning via `onApplied`.

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

## Lacunes actuelles

**A. Intégration assistant** — A1, A2, A3 et B1 sont fermées par le Run 2.

- A4 — `getPlanningSuggestions` est un alias de `getPlanningSummary` : l'intention
  suggestions et l'intention résumé exécutent la même analyse.
- A5 — la route `/api/dispatch/intelligence/apply` et la confirmation depuis le
  chat sont deux entrées vers le même `applyPlanningSuggestion`. C'est voulu (le
  panneau de suggestions reste inchangé), mais la clé d'idempotence est générée
  côté client sur la première et côté serveur sur la seconde.

**B. Sûreté**

- B2 — une `DispatchOptimizationApplication` dont `resultSummary` n'est pas
  `APPLIED` fait échouer le rejeu en 500 (violation d'unicité) au lieu d'un statut
  explicite.
- B3 — le `CONFLICT` de ressource pure n'est atteignable qu'en course entre la
  réanalyse serveur et la transaction : toute invalidation observable modifie
  aussi le snapshot et sort donc en `STALE`. Le code est couvert par la
  vérification en transaction, pas par un test de course dédié.

**C. Règles métier**

- C1 — un seul type de suggestion ; aucune détection de mission non affectée, de
  risque réglementaire ou de rotation remorque côté Intelligence.
- C2 — l'empreinte Intelligence exclut volontairement les routes ; une
  suggestion peut donc rester « valide » alors que ses distances ont changé.

**D. UX** — D2 est fermée par le Run 2.

- D1 — aucune surface proactive : l'analyse est toujours déclenchée manuellement.
- D3 — dans le panneau de suggestions, un `ALREADY_APPLIED` s'affiche comme un
  succès sans indiquer le rejeu. Le chat, lui, le dit explicitement.

**E. Observabilité** — E1 et E2 sont fermées par le Run 2.

- E3 — aucune métrique de durée d'analyse ni de consommation de routes exposée
  aux appelants.

**F. Tests** — T1 est fermée par le Run 2.

- T2 — `getMissionContext` / `getResourceAvailability` ne sont testés qu'à
  travers l'assistant, sur le jeu de données `gerard` (test sauté si absent).
- T3 — aucun test de la route `simulate` elle-même ; sa logique de sélection
  `(missionId, proposedPairRowId)` n'est couverte qu'indirectement.
- T4 — aucun test de rendu React : le parcours d'interface a été validé
  manuellement (voir `scripts/qa-intelligence-chat-apply.ts`).

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

## Périmètre du Run 3

1. T3 : couvrir la route `simulate`, y compris sa sélection par
   `(missionId, proposedPairRowId)` et son nouveau statut d'erreur.
2. A5 : unifier l'émission de la clé d'idempotence entre le panneau de
   suggestions et le chat, ou documenter définitivement l'écart.
3. B2 : rendre explicite le rejeu d'une application dont `resultSummary` est
   incomplète, au lieu d'une violation d'unicité en 500.
4. D3 : distinguer un rejeu d'un succès dans le panneau de suggestions.
5. T4 : première couverture de rendu pour le bloc de confirmation du chat.

## Hors périmètre V1

Nouveaux types de suggestion, apprentissage ou scoring adaptatif, surface
proactive, tâches de fond, application automatique, annulation d'une
application, persistance des simulations ou de l'historique de conversation,
nouveaux modèles de base de données, système de notification, et toute
unification avec `lib/dispatch/auto-planning/`.
