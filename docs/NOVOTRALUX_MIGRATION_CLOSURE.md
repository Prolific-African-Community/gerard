# Novotralux migration closure

Status: `MIGRATION_CLOSED`

- Cutover completed: 2026-09-23T15:46:18Z
- Application: `novotralux` (`CUSTOM`)
- Gerard Core: `1.0.0` (`^1.0.0`, compatible)
- Organization: `org-novotralux`
- Production deployment: stable alias `https://novotralux-custom.vercel.app`
- Public site: legacy remains the default application
- Public operational route: `https://www.novotralux.eu/dispatch`
- Operational surface: Novotralux Custom through the validated external rewrites
- Writable métier database: Novotralux Custom production only
- Production database: Neon `lucky-wildflower-15424624`, branch `br-cool-sea-zaufb5ng`, database `neondb`, host prefix `ep-ancient-surf-zav7xo37`
- Gerard Standard database: Neon `lucky-wildflower-15424624`, branch `br-patient-wildflower-zarmyqcq`, database `neondb`, host prefix `ep-ancient-block-za26cw6e`

## Migration integrity

- 29 tenant models validated
- 3,983 relations validated
- 0 critical orphan
- Critical identifiers and 17 password hashes preserved
- Final migrator result: `ALREADY_MIGRATED`
- No post-cutover count drift observed during stabilization
- Prisma migration state: 58/58 applied, 0 unfinished, 0 rolled back; schema up to date

## Integrations

`MAIL_INTAKE` is active on the preserved integration ID. Its non-sensitive IMAP configuration is tenant-scoped, `secretRef` is `NOVOTRALUX_MAIL`, and production validation confirmed secret resolution, authentication, and read-only mailbox access without importing or modifying messages.

`SL_AUTOMOTIVE` remains disabled and isolated. Its new Production-only secret-provider variables are retained, but the legacy production base URL is not HTTPS and failed the safe provider validation before any SL integration data was changed. The existing SL integration row therefore remains disabled with no secret reference until a verified HTTPS provider URL is supplied.

## Final Vercel environment

- Runtime/build: `DATABASE_URL`, `NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL`, application/organization/environment identity, and the public application definition are retained in Production.
- Auth, Blob, server Google, browser Google, and all integration credentials are Production-only.
- Local development has no production database, JWT, Blob, Google, mail, or SL credentials; only the non-sensitive dispatch base coordinates remain shared.
- Obsolete migration aliases, demo database variables, bootstrap/reset credentials, development cleanup credentials, legacy mail variables, and superseded SL key variables were removed from the normal Custom runtime.
- `SL_AUTOMOTIVE_API_BASE_URL` is retained Production-only solely as the isolated unresolved provider configuration; it is not consumed by the disabled tenant integration.
- Google Maps/Routes variables remain configured, with the per-operation limit retained. No Google call was made during cleanup.

## Legacy fallback

The legacy repository, production database, final snapshot `pre-gerard-final-cutover-20260923-172829`, and legacy-only Vercel deployment are retained. The fallback runtime connects with the dedicated `legacy_fallback_reader` role: transactions default to read-only, `SELECT` is granted, and métier `INSERT` is denied. Mail polling, SL credentials, server-side Google credentials, and non-production access to Production DB/JWT/Blob credentials were removed from the legacy Vercel project. A rollback requires freezing Custom writes, reconciling any Custom-only deltas, deliberately restoring a writable credential, then promoting the known legacy-only deployment; blind rollback is forbidden.

## Future Core updates

Update `@prolific/gerard-core` through the documented SemVer flow: verify the Custom compatibility range, apply Core migrations before any Custom migrations, run Core/Standard/Custom tests and builds, validate on a non-production deployment, then promote. Novotralux extensions must continue to use only the Core public API; Core source is never copied or patched in the Custom app.

## Final deployment

The final production deployment is published through the stable `novotralux-custom.vercel.app` Production alias from the Gerard `main` branch. It is built after environment cleanup and contains no temporary migration endpoint or token. Novotralux Custom remains the sole writable métier database; the legacy database, final snapshot, and legacy-only deployment remain available as read-only rollback references.

## Known debt

The `/api/dispatch/overview` response can exceed 4 MiB. It remains functional and is tracked separately from migration closure.

## Final production repair — 2026-09-24

- `MAIL_INTAKE` now serves the Imports panel through the canonical tenant integration, `secretRef`, and `IntegrationSecretProvider` path. The runtime no longer depends on legacy `MAIL_IMPORT_*` variables; production IMAP validation is read-only and connected.
- The Google Maps browser configuration now uses only `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`. Vercel stores this intentionally public browser key as Production Config so it is available to the build, while `GOOGLE_MAPS_API_KEY` remains server-only.
- Public validation on `www.novotralux.eu` confirmed connected mail imports, direct map refresh, Google map rendering, vehicle positions, and the operational mission panel without Google Routes calls.
- Final validated Custom deployment: `dpl_2GT4JoSfw8uVYPTkVH6JLU4vT88P`.
