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

`MAIL_INTAKE` is active on the preserved integration ID. Its non-sensitive IMAP configuration is tenant-scoped, `secretRef` is `NOVOTRALUX_MAIL`, and production validation confirmed secret resolution, authentication, and read-only mailbox access without importing or modifying messages.

`SL_AUTOMOTIVE` remains disabled and isolated. Its new Production-only secret-provider variables are retained, but the legacy production base URL is not HTTPS and failed the safe provider validation before any SL integration data was changed. The existing SL integration row therefore remains disabled with no secret reference until a verified HTTPS provider URL is supplied.

## Final Vercel environment

- Runtime/build: `DATABASE_URL`, `NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL`, application/organization/environment identity, and the public application definition are retained in Production.
- Auth, Blob, server Google, browser Google, and all integration credentials are Production-only.
- Preview has no production database, JWT, Blob, Google, mail, or SL credentials; only the non-sensitive dispatch base coordinates remain shared.
- Migration/staging aliases, demo database variables, bootstrap/reset credentials, development cleanup credentials, legacy mail variables, and superseded SL key variables were removed from the normal Custom runtime.
- `SL_AUTOMOTIVE_API_BASE_URL` is retained Production-only solely as the isolated unresolved provider configuration; it is not consumed by the disabled tenant integration.
- Google Maps/Routes variables remain configured, with the per-operation limit retained. No Google call was made during cleanup.

## Legacy fallback

The legacy repository, production database, final snapshot `pre-gerard-final-cutover-20260923-172829`, and legacy-only Vercel deployment `dpl_GiNTXWQehG7eEKrb7s64SmKwfBAq` are retained. The legacy runtime remains read-only. A rollback requires freezing Custom writes, reconciling any Custom-only deltas, then promoting the known legacy-only deployment; blind rollback is forbidden.

## Future Core updates

Update `@prolific/gerard-core` through the documented SemVer flow: verify the Custom compatibility range, apply Core migrations before any Custom migrations, run Core/Standard/Custom tests and builds, validate on a non-production deployment, then promote. Novotralux extensions must continue to use only the Core public API; Core source is never copied or patched in the Custom app.

## Final deployment

The final production deployment is `dpl_9otM8PwaVZGxDm9HJtAad9f3LCys`. It was built after environment cleanup and contains no temporary migration endpoint or token. Novotralux Custom remains the sole writable métier database; the legacy database, final snapshot, and legacy-only deployment remain available as read-only rollback references.

## Known debt

The `/api/dispatch/overview` response can exceed 4 MiB. It remains functional and is tracked separately from migration closure.
