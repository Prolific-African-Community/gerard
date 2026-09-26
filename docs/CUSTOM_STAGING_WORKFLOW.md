# Gerard & Novotralux Staging — workflow

The single reference for the permanent Staging environments: architecture, one-time setup, daily work, promotion to
Production and troubleshooting. Flow:

```
feature/<scope> ──► npm run staging:deploy ──► Staging validation ──► merge to main ──► Production
```

## 1. Architecture

| | Gerard Staging (Standard / Platform) | Novotralux Staging (Custom) |
| --- | --- | --- |
| Vercel project / environment | `gerard-dispatch` / custom environment `staging` | `novotralux-custom` / custom environment `staging` |
| Stable URL | `https://gerard-dispatch-staging.vercel.app` | `https://novotralux-custom-staging.vercel.app` |
| Neon branch (project `lucky-wildflower-15424624`) | `gerard-staging` | `novotralux-custom-staging` |
| Database variable | `DATABASE_URL` | `NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL` |
| Production counterpart | `gerard-dispatch.vercel.app`, `br-patient-wildflower-zarmyqcq` | `www.novotralux.eu`, `br-cool-sea-zaufb5ng` |

- **Stable, not random.** Staging is a Vercel *custom environment* with its own domain, variables and deployments; its
  URL never changes and its database and QA accounts persist between deployments. Deployment Protection stays on.
- **Environment identity.** `resolveDeploymentEnvironment` (`packages/gerard-core/src/deployment-environment.ts`) decides
  the environment once from `GERARD_INSTANCE_ENVIRONMENT=staging` and Vercel (`VERCEL_TARGET_ENV=staging`); any
  contradiction throws at build and at runtime.
- **Database identity (fail closed).** The Neon endpoint id of the connection string is the identity
  (`apps/novotralux/scripts/database-target.mjs`). Production is an **allow-list**: it opens only the documented
  Production endpoints, so a new Staging branch needs no code change and can never be opened by Production. Every other
  environment refuses the Production endpoints; Staging also refuses the Preview branch. The check runs in every build
  (`scripts/staging-prepare.ts`) and in every runtime (`lib/prisma.ts` → `lib/runtime/database-guard.ts`): a wrong
  Production variable fails the deployment, not the live site.
- **Platform → Custom.** Gerard Staging reaches only `GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT`
  (HTTPS, `/api/internal/platform/configuration`); an endpoint on any Production Custom host (`novotralux-custom.vercel.app`,
  `www.novotralux.eu`, `novotralux.eu`) is refused, and there is no fallback to Preview or Production. Production reaches
  Production only (registry constant). HMAC, timestamp, nonce, expiry, replay protection, instance binding and tenant
  isolation are unchanged; Staging has its own shared secret. OIDC Trusted Sources is sent for every `VERCEL_ENV=preview`
  runtime, which includes the Staging custom environment.
- **Staging builds prepare themselves.** Each Staging build runs `prisma migrate deploy` on the Staging database and
  ensures the QA accounts (never resetting an existing one); outside Staging the step only verifies the Production
  database identity or logs `skipped`.

### Staging variables (written only by `staging:setup`, scoped to `staging` only)

| Variable | Gerard | Novotralux | Source |
| --- | --- | --- | --- |
| `GERARD_INSTANCE_ENVIRONMENT=staging` | ✔ | ✔ | fixed |
| `DATABASE_URL` / `NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL` | ✔ | ✔ | Neon Staging branch (direct connection, needed by migrations) |
| `JWT_SECRET` | ✔ | ✔ | generated, one per app |
| `GERARD_PLATFORM_INSTANCE_SHARED_SECRET` | ✔ | ✔ | generated, identical pair |
| `GERARD_PLATFORM_HOSTNAMES` | Staging domain | — | fixed |
| `GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT` / `…_DOMAIN` | ✔ | — | Novotralux Staging domain |
| `GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION=0` | ✔ | ✔ | fixed |
| `GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD` | ✔ | — | generated once |

Staging values are *encrypted* (not *sensitive*) so the operator commands can compare them in memory; they are
Staging-only and never printed. Production and Preview variables are never read or written.

## 2. One-time setup (operator machine)

Prerequisites: Node 20+, this repository on the feature branch, access to the Vercel team and to the Neon project.

```bash
npm ci
npm run staging:setup     # logs you in to Vercel and Neon if needed, creates/reuses everything, deploys both apps
npm run staging:check     # PASS/FAIL readiness report
```

`staging:setup` is idempotent (a second run changes nothing) and does, in order:

1. checks `vercel whoami` and `neonctl me`; if either is not authenticated it opens `vercel login` / `neonctl auth`;
2. finds both Vercel projects (all teams of your login) and creates the `staging` custom environment if missing;
3. creates the Neon branches `gerard-staging` and `novotralux-custom-staging` **schema-only** (no row copied) and, only
   while a branch is fresh (no migration history, no user), rebuilds its schema from this repository's migrations;
4. writes the Staging variables above (creates missing ones, aligns setup-owned values, keeps existing secrets);
5. attaches the two stable domains to the `staging` environment;
6. generates a Deployment Protection *automation bypass* if the project has none (protection itself is unchanged);
7. applies migrations and creates the QA accounts (`scripts/staging-prepare.ts`);
8. deploys both apps with `vercel deploy --target=staging`.

It refuses: a `staging` environment of Production type, a Staging domain that is a Production host or already attached
to another environment, a Neon branch that is the default/Production/Preview branch or served by one of their endpoints,
a variable shared with Production or Preview, and two Staging apps on one database.

Flags: `--no-deploy` (stop before deploying), `--allow-dirty` (deploy uncommitted changes).
Overrides (environment variables, only if the defaults don't match your accounts): `GERARD_STAGING_VERCEL_TEAM`,
`GERARD_STAGING_VERCEL_PROJECT_GERARD`, `GERARD_STAGING_VERCEL_PROJECT_NOVOTRALUX`, `GERARD_STAGING_DOMAIN_GERARD`,
`GERARD_STAGING_DOMAIN_NOVOTRALUX`, `GERARD_STAGING_NEON_PROJECT`, `GERARD_STAGING_NEON_PARENT_BRANCH`.

## 3. QA accounts

| Account | App | Role | Access |
| --- | --- | --- | --- |
| `gerard.staging.superadmin` | Gerard Staging | SUPER_ADMIN (+ VIEWER of `org-gerard-default`, needed for a session) | Initial password shown **once** by the `staging:setup` run that creates it (in a terminal; otherwise written to `~/.gerard-staging-credentials.txt`, owner-only — delete it after use). Changed at first login. |
| `novotralux.staging.admin` | Novotralux Staging | ORG_ADMIN of `org-novotralux` | Gerard Staging → `/admin` → Novotralux → Accès administrateurs → Réinitialiser le mot de passe. |

Builds never reset an existing account. No password is stored in the repository.

## 4. Daily workflow

```bash
git switch -c feature/<scope>
# … code, commit …
npm run staging:deploy               # Core or shared change: both apps
npm run novotralux:staging:deploy    # Novotralux-only change
npm run gerard:staging:deploy        # Gerard-only change
npm run staging:check                # read-only PASS/FAIL
```

Deploy commands deploy the current commit (they refuse uncommitted changes unless `--allow-dirty`) to the `staging`
target only; they cannot create a Production or Preview deployment. The Staging URL stays the same; the database and QA
accounts persist.

### `staging:check`

Read-only (Vercel metadata, read-only database transactions, and the existing signed channel reads `getConfiguration` and
`getOrgAdmins`). Prints only PASS/FAIL, never a secret or database URL; exit code 1 on any FAIL.

| Item | Passes when |
| --- | --- |
| Gerard Staging DB | branch `gerard-staging` exists, is not Production/Preview, `DATABASE_URL` points at it, migrations applied |
| Novotralux Staging DB | same for `novotralux-custom-staging` / `NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL` |
| Production DB overlap | no Staging database is a Production/Preview endpoint, variables are Staging-only, the two apps use distinct databases |
| Custom endpoint | Gerard Staging targets `https://<Novotralux Staging domain>/api/internal/platform/configuration`; both domains attached to `staging`; platform hostnames set |
| Production endpoint leakage | no Staging value points at a Production host; `GERARD_INSTANCE_ENVIRONMENT=staging` on both; no Staging variable in Production/Preview |
| Channel | identical Staging secret on both sides; Novotralux Staging answers a signed `getConfiguration`; Gerard Staging answers |
| QA accounts | both accounts exist, are active, with the expected roles |
| Integration safety | no enabled integration in either Staging database; no Production/integration credential in Staging; Google Routes capped to 0 |

## 5. Standard vs Custom changes

- **Novotralux-only** (`apps/novotralux/**`, Novotralux branding/extensions): `novotralux:staging:deploy`, validate on
  Novotralux Staging.
- **Core / shared** (`packages/gerard-core`, `lib/`, `pages/`, `components/`, `prisma/`): these ship in *both* apps.
  Deploy both with `staging:deploy` and validate Gerard Staging **and** Novotralux Staging, including the Platform →
  Custom administration (`/admin` → Novotralux). A Core contract change must keep old and new Platform/Custom
  compatible (`CUSTOM_INSTANCE_OUTDATED` is reported if a Custom instance lags).
- **Migrations** are additive; each Staging build applies them to Staging first. Never write a destructive migration.

## 6. Promotion to Production

1. `npm run staging:check` → all PASS, and manual validation on the Staging URLs.
2. Open a pull request from `feature/<scope>` to `main`; merge after review.
3. `main` deploys Production through the existing Vercel Git integration (unchanged). The Production build verifies the
   Production database identity before building.
4. Staging keeps running the last feature deployment until the next `staging:deploy`.

Nothing in this workflow writes Production variables, domains, branches or data.

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Vercel CLI is not authenticated` / `Neon CLI is not authenticated` | run `npx vercel login` / `npx neonctl auth`, retry |
| `credentials file was not found` | set `VERCEL_TOKEN` in the current shell (vercel.com/account/tokens), retry |
| `projects … not found together` | set `GERARD_STAGING_VERCEL_TEAM` and/or the project-name overrides |
| domain attach fails (`domain_taken`) | choose another `*.vercel.app` name via `GERARD_STAGING_DOMAIN_*`, rerun setup |
| `Neon branch … refused` | a branch with the Staging name points at Production/Preview: rename that branch in Neon |
| build fails `DATABASE_ENVIRONMENT_MISMATCH` | the environment's database variable points at another environment's database; rerun `staging:setup` |
| build fails `STAGING_MIGRATION_FAILED` | read the migration output in the Vercel build log (host redacted); fix the migration, redeploy |
| Channel FAIL `answered 401 INVALID_SIGNATURE` | the running deployment predates the current secret: `npm run staging:deploy` |
| Channel FAIL `answered 401/403` from Vercel | Deployment Protection bypass missing: rerun `staging:setup` |
| QA accounts FAIL (superadmin missing) | rerun `staging:setup` (creates it and shows the credential once) |
| creating the `staging` environment fails (plan limit) | Vercel custom environments require a Pro/Enterprise team; one per project is enough |
| a Staging deployment builds the wrong app | deploys reuse each project's own Build Command / Root Directory (as Production); check them in Vercel project settings |
| lost the initial superadmin password before first login | Vercel → `gerard-dispatch` → Settings → Environment Variables → `staging` → `GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD` |

## 8. Tests

- `tests/deployment-environment.test.ts` — environment resolution, routing, database identity (in `npm test`).
- `npm run test:staging-operator` — the operator commands end to end against a mock Vercel API, fake `vercel`/`neonctl`
  CLIs and a disposable local PostgreSQL (`STAGING_OPERATOR_TEST_ADMIN_URL`): Production refusals, Staging-only writes,
  idempotency, one-time credential, read-only check, no secret in output.
