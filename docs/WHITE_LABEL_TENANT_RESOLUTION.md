# Résolution white-label

Le domaine ne constitue jamais une autorisation. Il sélectionne le branding et l'organisation attendue ; l'accès métier exige ensuite une session signée, une adhésion `OrganizationUser` active et la même organisation active.

## Source du hostname

- Sur Vercel (`VERCEL=1`), `x-vercel-forwarded-host` est utilisé en priorité car il est posé par l'infrastructure. Le header client générique `x-forwarded-host` est ignoré.
- Hors Vercel, le header HTTP `Host` est utilisé directement.
- Le hostname est mis en minuscules, converti en ASCII, débarrassé du port et du point terminal.
- `localhost`, `127.0.0.1`, `::1` et `*.localhost` activent uniquement en développement le fallback explicite vers l'organisation de la session.
- En production, un domaine absent ou inconnu ne sélectionne jamais Gerard silencieusement. Les hôtes plateforme autorisés doivent être listés dans `GERARD_PLATFORM_HOSTNAMES` ; les hôtes tenant sont enregistrés dans `OrganizationDomain`.

Les préfixes sont normalisés sous la forme `/dispatch`, sans slash terminal. Le mapping actif au préfixe correspondant le plus long est retenu.
