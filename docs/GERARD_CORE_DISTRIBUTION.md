# Gerard Core distribution

## Core package

`packages/gerard-core` est le workspace privé `@prolific/gerard-core`. Son export racine contient uniquement les contrats applicatifs, la version, la compatibilité, les manifests et la registry d'intégrations. `./react` expose le provider et `./intelligence` les façades sélectionnées du moteur. Le package reste privé pendant 8B.

Carte actuelle : le package applicatif pur ne dépend que de React; Standard dépend de sa frontière publique; les services métier restent sous `lib/dispatch`, sans import depuis `pages`, `components` ou `lib/standard`. Le sous-export `./intelligence` est la façade temporaire vers ces services jusqu'à leur extraction physique, afin d'éviter un déplacement massif en 8B.

## Versioning

La version SemVer du `package.json` Core est l'unique source de vérité et devient `GERARD_CORE_VERSION` au runtime. Toute évolution compatible incrémente minor/patch; une rupture de contrat public incrémente major.

## Standard consumer

Gerard Standard importe `defaultGerardApplication`, le provider et le manifest via `@prolific/gerard-core`, comme une application externe. Il ne dispose d'aucun export privé supplémentaire.

## Custom consumer

`templates/gerard-custom-app` fournit un consumer fictif : définition applicative, branding/env, navigation, slot UI, policy de scoring, intégration et manifest. Il ne contient aucune donnée client réelle.

`apps/novotralux` est le premier consumer Custom réel. Il compose le shell partagé avec sa définition, son branding tenant et son registre d'intégrations, tout en conservant les pages, APIs, permissions et moteurs dans Gerard Core/Standard partagé. Son lanceur n'accepte que `LEGACY_TARGET_DATABASE_URL` et isole le build dans `.next-novotralux`.

## Compatibility

Chaque manifest déclare `compatibleCore`. `checkCoreCompatibility` accepte une version exacte ou une plage caret simple et distingue version trop ancienne, major incompatible et plage invalide. `npm run core:check` vérifie Standard; `npm run core:update-check -- --core-version X.Y.Z` prépare une mise à jour.

## Core migrations

Chaque instance utilise une DB dédiée. Les migrations `prisma/migrations` livrées avec la version Core sont appliquées en premier. `_prisma_migrations` fournit la dernière migration Core appliquée; le manifest et `GerardInstanceMigrationState` fournissent la version et la liste Custom. Aucune table metadata supplémentaire n'est nécessaire.

## Custom migrations

Les migrations Custom vivent dans le dépôt Custom, séparément des migrations Core, et s'appliquent ensuite. Elles ajoutent uniquement leurs propres structures par défaut. Toute altération destructive d'une table Core exige une évolution Core versionnée et une revue explicite.

## Update flow

1. Mettre à jour la dépendance Core et le `coreVersion` du manifest.
2. Exécuter le check de compatibilité.
3. Appliquer les migrations Core sur une copie isolée, puis les migrations Custom.
4. Exécuter tests Core, tests Standard/Custom, typecheck et build.
5. Déployer progressivement; enregistrer le résultat dans le futur registry d'instances.

## Legacy compatibility

Les nouvelles configurations utilisent `GERARD_DISPATCH_OPTIMIZATION`. La lecture accepte encore `NOVOTRALUX_DISPATCH_OPTIMIZATION` et le canonicalise, sans réécriture des anciens snapshots.
