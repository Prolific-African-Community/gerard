# Novotralux Custom

Cette application est le premier consumer réel de Gerard Custom. Elle consomme `@prolific/gerard-core` `1.0.0` (`^1.0.0`) et ne copie ni ne patche le moteur.

- Définition et manifest : `application.tsx`, `manifest.ts`.
- Extensions : `extensions/`; configuration tenant : branding et `OrganizationIntegration`.
- Base dédiée : `LEGACY_TARGET_DATABASE_URL`, injectée comme `DATABASE_URL` seulement par le lanceur local. La source legacy et la base Gerard Standard sont refusées.
- Lancer : `npm run novotralux:dev` depuis la racine.
- Tester/build : `npm run novotralux:test`, `npm run novotralux:check`, `npm run novotralux:build`.
- Mettre à jour le Core : modifier la dépendance et le manifest, lancer le check de compatibilité, appliquer les migrations Core puis Custom sur une copie, puis tous les tests/builds.

Une fonctionnalité générique vit dans le Core. Une différence exclusivement Novotralux vit ici et passe uniquement par un point d'extension public.
