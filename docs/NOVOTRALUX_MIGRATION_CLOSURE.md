# Novotralux migration closure

Status: `MIGRATION_CLOSED`

- Cutover completed: 2026-09-23T15:46:18Z
- Application: `novotralux` (`CUSTOM`)
- Gerard Core: `1.0.0` (`^1.0.0`, compatible)
- Organization: `org-novotralux`
- Public site: legacy remains the default application
- Operational surface: Novotralux Custom through the validated external rewrites
- Writable métier database: Novotralux Custom production only

## Migration integrity

- 29 tenant models validated
- 3,983 relations validated
- 0 critical orphan
- Critical identifiers and 17 password hashes preserved
- Final migrator result: `ALREADY_MIGRATED`
- No post-cutover count drift observed during stabilization

## Integrations

`MAIL_INTAKE` and `SL_AUTOMOTIVE` remain disabled. Their non-sensitive configuration exists, but no tenant `secretRef` is configured. They must only be enabled after their secrets are added through the server-side integration secret provider and a non-destructive connectivity check passes.

## Legacy fallback

The legacy repository, production database, final snapshot, and legacy-only Vercel deployment are retained. The legacy runtime remains read-only. A rollback requires freezing Custom writes, reconciling any Custom-only deltas, then promoting the known legacy-only deployment; blind rollback is forbidden.

## Known debt

The `/api/dispatch/overview` response can exceed 4 MiB. It remains functional and is tracked separately from migration closure.
