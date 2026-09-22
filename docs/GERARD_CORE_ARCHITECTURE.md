# Gerard Core architecture

## Gerard Core

Le Core contient les invariants partagés : auth et sécurité, organisations et memberships, permissions, missions, planning, chauffeurs, véhicules, carte et tracking, parc, facturation, rentabilité, maintenance, documents, RouteCache, Gerard Intelligence, Assistant et audit. Les contrôles serveur, le scope tenant et les transactions restent toujours dans le Core.

## Gerard Standard

Gerard Standard est l'application SaaS générique livrée par défaut. `defaultGerardApplication` décrit son identité, sa terminologie, ses références mission, sa navigation et ses paramètres de scoring. Sans définition Custom, le resolver retourne exclusivement cette application et conserve le comportement actuel.

## Tenant Config

La configuration persistée par organisation couvre le branding, les modules, les domaines, la configuration légale et les `OrganizationIntegration`. Elle personnalise une organisation sans introduire de code client ni contourner les permissions.

## Custom Extensions

Une application dédiée est définie avec `defineGerardApplication`. Elle peut ajuster la terminologie, les références mission, ajouter une navigation soumise aux capacités existantes, remplacer les slots ciblés `MissionCardHeader`, `MissionCardReference`, `MissionCardFooter` et `DashboardAddition`, et fournir des paramètres de scoring contrôlés. Il n'existe ni loader dynamique, ni marketplace, ni fork du moteur.

## Golden Rule

Extensions may override Core behavior only through documented extension points. Extensions never patch Core source directly.

## Examples

- Mission reference : choisir `reference` ou `clientReference` comme référence principale avec fallback déterministe.
- UI slot : remplacer uniquement la référence ou l'en-tête d'une carte mission.
- Intelligence policy : ajuster les seuils de gain d'une suggestion sans remplacer le moteur, le cache ou les contrôles réglementaires.
- Custom integration : conserver `OrganizationIntegration`, `secretRef`, l'activation et le scope tenant dans le Core, puis brancher une implémentation fournisseur dédiée.

L'identifiant historique `NOVOTRALUX_DISPATCH_OPTIMIZATION` reste temporairement inchangé car il participe aux empreintes de snapshots existantes. Ce nom est une dette de séparation pour 8B, pas une condition runtime client.
