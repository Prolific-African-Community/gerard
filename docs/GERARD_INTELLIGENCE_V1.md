# Gerard Intelligence — contrat V1

Figé au Run 1 (2026-09-27). Ce document décrit l'état réel du code, pas une cible
produit. Toute évolution passe par un Run explicite.

## Architecture actuelle

Distribution : `@prolific/gerard-core/intelligence`
(`packages/gerard-core/src/intelligence.ts`) est une façade de réexport pure. Les
routes API n'importent jamais `lib/` directement — contrainte vérifiée par
`tests/core-boundaries.test.ts`.

| Couche | Fichier | Rôle |
| --- | --- | --- |
| Routeur déterministe | `lib/dispatch/intelligence/intent-router.ts` | Regex FR → intention + entités. Valide aussi la sortie du modèle (`parseModelIntent`). |
| Routeur LLM | `lib/dispatch/intelligence/llm-router.ts` | OpenAI `/v1/responses`, `json_schema` strict, timeout 8 s. Classe une intention, ne produit aucun fait. |
| Assistant | `lib/dispatch/intelligence/assistant.ts` | Orchestration lecture seule, formulation des réponses. |
| Façade métier | `lib/dispatch/intelligence/facade.ts` | Contextes planning / mission / ressource, simulation, explication. |
| Moteur de suggestions | `lib/dispatch/suggestions/planning-service.ts`, `planning-analysis.ts`, `reassignment-efficiency.ts` | Analyse, candidats, seuils, classement. |
| Application | `lib/dispatch/suggestions/application.ts` | Seule écriture métier du périmètre Intelligence. |
| Snapshot partagé | `lib/dispatch/auto-planning/snapshot.ts` | `buildAutoPlanningSnapshot` + `fingerprintSnapshot`, réutilisés tels quels. |

Routes (`pages/api/dispatch/intelligence/`) : `analyze`, `simulate`, `assistant`,
`apply`. Toutes sous `withTenantApiRoute`.

UI : `components/dispatch/intelligence/GerardSuggestionsPanel.tsx` (analyse →
simulation → confirmation → application) et `GerardAssistantPanel.tsx` (chat
lecture seule), montés par `WeeklyDispatchBoard.tsx` et `MobileDispatchView.tsx`.

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
  `(missionId, proposedPairRowId)`. Elle revalide donc bien l'état courant, mais
  ne produit aucune information absente de l'analyse.
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
| Suggestion périmée non applicable | VERIFIED | triple garde : réanalyse + comparaison d'empreinte, `buildMutationPlan`, revérification `updatedAt` dans la transaction | — (couvert indirectement ; voir lacune T1) |
| Application idempotente | VERIFIED | `@@unique([organizationId, idempotencyKey])` + relecture `resultSummary` avant et dans la transaction | — (lacune T1) |
| Application transactionnelle | VERIFIED | `$transaction` `Serializable` + `pg_advisory_xact_lock` | — (lacune T1) |
| Contraintes métier revalidées juste avant écriture | VERIFIED | statuts chauffeur/camion/remorque, cohérence `PlanningRow`, `findResourceOccupationConflicts` | — (lacune T1) |
| Événement et audit écrits | VERIFIED | `MissionEvent` (`origin: GERARD_INTELLIGENCE`) + `DispatchOptimizationApplication` dans la même transaction | — (lacune T1) |
| Conflit de concurrence signalé, jamais avalé | VERIFIED | `SuggestionApplicationError` + `P2034` → HTTP 409 | — (lacune T1) |
| Confirmation explicite avant application | VERIFIED | `applicability.requiresExplicitConfirmation` ; UI à double étape | `tests/intelligence-apply-contract.test.ts` (B) |
| L'assistant n'écrit rien | VERIFIED | `requestsMutation` → refus ; aucune écriture dans `assistant.ts` / `facade.ts` | `tests/intelligence-assistant.test.ts` (J, L) |
| Échec LLM sans effet sur les règles métier | VERIFIED | le LLM ne produit qu'une intention, validée par `parseModelIntent` ; repli `FALLBACK` | `tests/intelligence-assistant.test.ts` (routeur, TIMEOUT, INVALID_OUTPUT) |
| Réversibilité d'une application | **MISSING** | aucun chemin d'annulation ; l'état précédent n'est conservé que dans `MissionEvent.metadata.previousAssignment` | — |
| Traçabilité d'une simulation | **MISSING** | aucune persistance : une simulation ne laisse aucune trace | — |

## Lacunes actuelles

**A. Intégration assistant**

- A1 — l'assistant reconnaît `requestsMutation` mais ne produit jamais d'action
  confirmable : il répond un refus statique (`assistant.ts:40`).
- A2 — `GerardAssistantAction` n'expose que `type: 'SIMULATE'` et ne porte ni
  `snapshotFingerprint` ni `idempotencyKey` : la chaîne chat → application est
  structurellement impossible aujourd'hui.
- A3 — `SIMULATE_SUGGESTION` sans `suggestionId` retombe sur
  `analysis.suggestions[0]` (`facade.ts:138`) : l'assistant peut simuler une
  suggestion que l'utilisateur n'a pas désignée.
- A4 — `getPlanningSuggestions` est un alias de `getPlanningSummary` : l'intention
  suggestions et l'intention résumé exécutent la même analyse.

**B. Sûreté**

- B1 — l'application Intelligence n'a pas d'équivalent du jeton HMAC
  d'auto-planning (`auto-planning/token.ts`) : la fraîcheur repose sur
  `suggestionId` + `snapshotFingerprint` transmis par le client, sans liaison
  cryptographique à l'utilisateur ni expiration. Compensé par la réanalyse
  serveur, donc non exploitable, mais asymétrique.
- B2 — une `DispatchOptimizationApplication` dont `resultSummary` n'est pas
  `APPLIED` fait échouer le rejeu en 500 (violation d'unicité) au lieu d'un statut
  explicite.

**C. Règles métier**

- C1 — un seul type de suggestion ; aucune détection de mission non affectée, de
  risque réglementaire ou de rotation remorque côté Intelligence.
- C2 — l'empreinte Intelligence exclut volontairement les routes ; une
  suggestion peut donc rester « valide » alors que ses distances ont changé.

**D. UX**

- D1 — aucune surface proactive : l'analyse est toujours déclenchée manuellement.
- D2 — l'assistant n'offre pas de bouton d'application, même après simulation.
- D3 — un `ALREADY_APPLIED` s'affiche comme un succès sans indiquer le rejeu.

**E. Observabilité**

- E1 — `pages/api/dispatch/intelligence/simulate.ts` n'a pas de `try/catch` :
  une erreur d'analyse remonte en 500 non structuré.
- E2 — le statut du provider LLM n'est qu'un `console.warn` ; il n'apparaît pas
  dans la réponse `routing`.
- E3 — aucune métrique de durée d'analyse ni de consommation de routes exposée
  aux appelants.

**F. Tests**

- T1 — `applyPlanningSuggestion` n'a aucun test couvrant le chemin d'écriture :
  idempotence, péremption, conflit de ressource et contenu de l'audit reposent
  uniquement sur la relecture de code. Le Run 1 n'a couvert que les gardes
  atteintes avant le premier accès base.
- T2 — `getMissionContext` / `getResourceAvailability` ne sont testés qu'à
  travers l'assistant, sur le jeu de données `gerard` (test sauté si absent).
- T3 — aucun test de la route `simulate`.

## Cycle de vie V1 d'une suggestion

Le cycle est **fonctionnel et sans état persistant** : aucun enum ni modèle en
base. Chaque étape recalcule depuis le planning.

| Étape | Source de vérité | Entrées requises | Validation | Écriture | Permission | Sortie |
| --- | --- | --- | --- | --- | --- | --- |
| `ANALYZED` | planning + snapshot du jour | `weekStart` | snapshot constructible | non | `dispatch.view` + module `INTELLIGENCE` | `PlanningSuggestionAnalysis` (`snapshotFingerprint`, `summary`, `diagnostics`) |
| `SUGGESTED` | `detectReassignmentEfficiency` | candidat courant valide + alternatives | compatibilité, temporalité, occupations, confiance, seuils économiques | non | idem | `GerardSuggestion[]`, `availableActions` |
| `SIMULATED` | réanalyse | `weekStart`, `missionId`, `proposedPairRowId` | la suggestion existe encore dans l'analyse fraîche | non | idem | `status` `VALID` ou `STALE`, plus `suggestion` et `snapshotFingerprint` |
| `CONFIRMATION_REQUIRED` | client | suggestion `VALID` | `requiresExplicitConfirmation` | non | idem | intention utilisateur + `idempotencyKey` généré côté client |
| `APPLIED` | transaction | `suggestionId`, `weekStart`, `snapshotFingerprint`, `idempotencyKey` | réanalyse, empreinte, `updatedAt` de l'affectation, statuts ressources, occupations | **oui** | `dispatch.assign` + module `INTELLIGENCE` | `status` `APPLIED`, `missionId`, `assignmentId`, `applicationId` |

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

État V1 (figé) :

```ts
type GerardAssistantAction = { type: 'SIMULATE'; label: string; suggestionId: string }
```

Forme visée pour le Run 2 — à implémenter alors, pas avant :

```ts
type GerardAssistantAction =
  | { type: 'SIMULATE'; label: string; suggestionId: string }
  | {
      type: 'CONFIRM_APPLY'
      label: string
      suggestionId: string
      snapshotFingerprint: string // rendu par le serveur, jamais par le LLM
      idempotencyKey: string // émis par le serveur à la confirmation
      summary: string // impact à afficher avant confirmation
    }
```

Règles de portage :

- `suggestionId` est déjà lié au snapshot par construction ; il reste l'unique
  désignation d'une suggestion.
- `snapshotFingerprint` n'est jamais accepté depuis le LLM : le serveur le lit sur
  la suggestion fraîchement analysée.
- `idempotencyKey` passe côté serveur pour le chemin chat (le panneau de
  suggestions continue de le générer côté client, comportement inchangé).
- Une confirmation explicite est représentée par un second appel portant
  `action.type === 'CONFIRM_APPLY'` et la clé émise, jamais par du texte libre.
- Le contexte conversationnel reste minimal :
  `{ missionReference?, suggestionId? }`, plus l'action en attente. Aucun
  historique de conversation persistant.

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

## Périmètre du Run 2

1. Fermer T1 : couverture du chemin d'écriture de `applyPlanningSuggestion` sur
   données de test jetables (application, rejeu idempotent, péremption,
   conflit de ressource, contenu de l'audit).
2. A2 + A1 : étendre `GerardAssistantAction` à `CONFIRM_APPLY` et brancher la
   confirmation explicite sur `applyPlanningSuggestion` existant.
3. A3 : exiger un `suggestionId` désigné pour `SIMULATE_SUGGESTION`.
4. E1 + E2 : structurer les erreurs de `simulate` et exposer le statut provider.
5. D2 : action d'application dans l'assistant, après simulation et confirmation.

## Hors périmètre V1

Nouveaux types de suggestion, apprentissage ou scoring adaptatif, surface
proactive, tâches de fond, application automatique, annulation d'une
application, persistance des simulations, nouveaux modèles de base de données,
et toute unification avec `lib/dispatch/auto-planning/`.
