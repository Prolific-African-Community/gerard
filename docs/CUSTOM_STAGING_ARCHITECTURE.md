# Custom Staging architecture

Permanent, stable non-production environments for Gerard and Novotralux Custom. Flow:
feature branch → Gerard Staging / Novotralux Staging → validation → `main` → Production.

## URLs

| App | Staging URL | Production URL |
| --- | --- | --- |
| Gerard Platform (Standard) | *to assign*: stable domain on the Vercel `staging` custom environment of the Gerard project | `gerard-dispatch.vercel.app` |
| Novotralux Custom | *to assign*: stable domain on the Vercel `staging` custom environment of `novotralux-custom` | `www.novotralux.eu` |

Staging uses stable domains, never deployment-specific Preview hosts. Update this table when the domains exist.

## Environment model

`resolveDeploymentEnvironment` (`packages/gerard-core/src/deployment-environment.ts`) decides the environment once:
`GERARD_INSTANCE_ENVIRONMENT` declares it and must agree with Vercel (`VERCEL_ENV`, `VERCEL_TARGET_ENV=staging` for the
custom environment). A contradiction or unknown value throws, at build and at runtime.

| | Production | Staging | Preview |
| --- | --- | --- | --- |
| Gerard `DATABASE_URL` | Standard production branch | dedicated Gerard Staging database | — |
| Novotralux database variable | `NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL` | `NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL` | `NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL` |
| `JWT_SECRET` | production | Staging-only | Preview-only |
| `GERARD_PLATFORM_INSTANCE_SHARED_SECRET` | production pair | Staging pair, identical in both Staging apps | Preview pair |
| Gerard → Novotralux endpoint | registry constant (Production host) | `GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT` | `…_PREVIEW_CONFIGURATION_ENDPOINT` |
| Instance link shown in `/admin` | registry domain | `GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_DOMAIN` | registry domain |
| Platform login hosts | `GERARD_PLATFORM_HOSTNAMES` | Staging Gerard domain in `GERARD_PLATFORM_HOSTNAMES` (build **and** runtime) | deployment host |

Databases are Neon branches created **schema-only** (no Production data). Every Staging build runs
`scripts/staging-prepare.ts`, which applies migrations, maps the `GERARD_PLATFORM_HOSTNAMES` domains to
`org-gerard-default` (sessions are bound to the request domain) and ensures the QA accounts. It never resets an existing
account; outside Staging it only logs `skipped`.

## Accounts

| Account | App | Role | How to get in |
| --- | --- | --- | --- |
| `gerard.staging.superadmin` | Gerard Staging | SUPER_ADMIN; VIEWER of `org-gerard-default` only, which a session requires | Created once from the Staging-only `GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD`; changed at first login. Never reset by builds. |
| `novotralux.staging.admin` | Novotralux Staging | ORG_ADMIN of `org-novotralux`, no platform role | Gerard Staging → `/admin` → Novotralux → Accès administrateurs → Réinitialiser le mot de passe. |

No password is stored in the repository or in this document.

## Platform → Custom routing

- Production Platform → Production Custom only (registry constant); Staging/Preview endpoint variables are ignored.
- Staging Platform → the Staging endpoint only; no fallback to Preview or Production; an endpoint on the Production
  Custom host is rejected; HTTPS required.
- Preview Platform → the Preview endpoint only.
- Local development → only an explicit `…_DEVELOPMENT_CONFIGURATION_ENDPOINT` (it no longer defaults to Production).

HMAC, timestamp, nonce, expiry, replay protection and instance binding are unchanged. Each environment has its own
shared secret, so a request signed in one environment is rejected by the others. OIDC Trusted Sources is sent whenever
`VERCEL_ENV=preview`, which includes Vercel custom environments; keep it if Staging stays behind Deployment Protection.

## Safety rules (fail closed)

- A runtime refuses a documented Production database endpoint outside Production, and a documented non-production
  endpoint in Production (`lib/prisma.ts` → `lib/runtime/database-guard.ts`). Staging also refuses the Preview branch.
- The Novotralux build wrapper reads only its environment's database variable and refuses one equal to another
  environment's.
- Add each new Staging database endpoint to `NON_PRODUCTION_DATABASE_ENDPOINTS` in
  `apps/novotralux/scripts/database-target.mjs` so Production can never open it.
- Local maintenance against Production must declare `GERARD_INSTANCE_ENVIRONMENT=production`.

## How Staging differs from Production

- Synthetic data only; no Production copy.
- No integration is created in Staging (mail intake, SL Automotive, webhooks stay off); do not add Production mail, SL
  or Blob credentials to the Staging scope.
- Google Routes calls are capped to 0 in Staging builds; Vercel crons run only on Production deployments.
- Staging secrets are independent from Production and Preview.
- `/admin` labels a Staging instance *Préproduction*, links to its Staging domain and hides Production-only
  metadata (deployment reference, cut-over date).

## One-time setup (infrastructure)

1. Neon: create schema-only branches for Gerard Staging and Novotralux Staging; record their endpoint prefixes here and
   in `NON_PRODUCTION_DATABASE_ENDPOINTS`.
2. Vercel, both projects: create the `staging` custom environment tracking the chosen branch, attach a stable domain,
   and set its variables per the table above (plus `GERARD_INSTANCE_ENVIRONMENT=staging`).
3. Gerard Staging only: set `GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD` once; deploy; log in and change it.
