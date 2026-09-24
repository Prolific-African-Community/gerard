# Novotralux migration closure

Status: `MIGRATION_CLOSED`

- Cutover completed: 2026-09-23T15:46:18Z
- Application: `novotralux` (`CUSTOM`)
- Gerard Core: `1.0.0` (`^1.0.0`, compatible)
- Organization: `org-novotralux`
- Production deployment: `dpl_7YmfV7zeo5CuzG2q4cyVogLTLn1d`
- Public site: legacy remains the default application
- Public operational route: `https://www.novotralux.eu/dispatch`
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

The legacy repository, production database, final snapshot `pre-gerard-final-cutover-20260923-172829`, and legacy-only Vercel deployment `dpl_GiNTXWQehG7eEKrb7s64SmKwfBAq` are retained. The legacy runtime remains read-only. A rollback requires freezing Custom writes, reconciling any Custom-only deltas, then promoting the known legacy-only deployment; blind rollback is forbidden.

## Future Core updates

Update `@prolific/gerard-core` through the documented SemVer flow: verify the Custom compatibility range, apply Core migrations before any Custom migrations, run Core/Standard/Custom tests and builds, validate on a non-production deployment, then promote. Novotralux extensions must continue to use only the Core public API; Core source is never copied or patched in the Custom app.

## Known debt

The `/api/dispatch/overview` response can exceed 4 MiB. It remains functional and is tracked separately from migration closure.
