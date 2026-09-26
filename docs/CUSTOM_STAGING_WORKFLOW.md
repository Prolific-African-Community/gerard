# Gerard & Novotralux Staging — workflow

The single reference for the permanent Staging environments. Final architecture: two dedicated Vercel **projects**, one
per application, next to the Production projects.

```
feature/<scope> ──► npm run staging:deploy ──► npm run staging:check + manual validation ──► merge to main ──► Production
```

## 1. Architecture

| | Production | Staging |
| --- | --- | --- |
| Gerard Platform (Standard) | Vercel project `gerard` | Vercel project `gerard-staging` |
| Novotralux Custom | Vercel project `novotralux-custom` | Vercel project `novotralux-custom-staging` |
| Stable URLs | `gerard-dispatch.vercel.app`, `www.novotralux.eu` | `https://gerard-staging.vercel.app`, `https://novotralux-custom-staging.vercel.app` (or the production `*.vercel.app` host Vercel assigned to the project; setup reads it) |
| Databases (Neon project `lucky-wildflower-15424624`) | `br-patient-wildflower-zarmyqcq`, `br-cool-sea-zaufb5ng` | child branches `gerard-staging` (parent `br-patient-wildflower-zarmyqcq`) and `novotralux-custom-staging` (parent `br-cool-sea-zaufb5ng`), sanitized, persistent |

All projects live in the Vercel scope `jonathans-projects-e6d49b10`. The legacy project `novotralux` is never used.
Project names are fixed in `scripts/staging/lib.ts`; they are never derived from a URL.

- **Staging projects deploy as Vercel "production".** Their variables therefore live in the *Production* scope of the
  Staging projects — intentionally. `GERARD_INSTANCE_ENVIRONMENT=staging` declares them Staging:
  `resolveDeploymentEnvironment` (`packages/gerard-core/src/deployment-environment.ts`) resolves Vercel production +
  declared `staging` to Staging; any other contradiction throws.
- **Database identity (fail closed).** The Neon endpoint id of the connection string is the identity
  (`apps/novotralux/scripts/database-target.mjs`). Production opens only the documented Production endpoints
  (allow-list), so a new Staging branch needs no code change and Production can never open it. Staging refuses the
  Production (and Preview) endpoints. Checked in every build (`scripts/staging-prepare.ts`) and every runtime
  (`lib/prisma.ts`). Mislabelling fails closed: a Production project declared `staging` refuses its Production
  database; a Staging project missing the declaration is treated as Production and refuses its Staging database.
- **Platform → Custom.** Gerard Staging reaches only
  `GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT` =
  `https://<Novotralux Staging host>/api/internal/platform/configuration` (HTTPS; any Production Custom host is refused;
  no fallback). Production reaches Production only (registry constant). HMAC, timestamp, nonce, expiry, replay
  protection, instance binding, `getConfiguration`, `getOrgAdmins`, SUPER_ADMIN recovery and tenant isolation are
  unchanged; Staging has its own shared secret. The Staging production URLs are public (Deployment Protection covers
  preview URLs only), so no OIDC is needed: the channel stays HMAC-authenticated.
- **Staging builds prepare themselves.** Each Staging build runs `prisma migrate deploy` on the Staging database and
  ensures the QA accounts, never resetting an existing one.

### Staging variables (written by `staging:setup` to the Staging projects only)

| Variable | `gerard-staging` | `novotralux-custom-staging` |
| --- | --- | --- |
| `GERARD_INSTANCE_ENVIRONMENT` | `staging` | `staging` |
| `DATABASE_URL` | Gerard Staging branch | Novotralux Staging branch (runtime) |
| `NOVOTRALUX_CUSTOM_STAGING_DATABASE_URL` | — | Novotralux Staging branch (build wrapper) |
| `GERARD_APPLICATION_ID` / `GERARD_INSTANCE_ORGANIZATION_ID` / `NEXT_PUBLIC_GERARD_APPLICATION` | — | `novotralux` / `org-novotralux` / `novotralux` |
| `JWT_SECRET` | generated, Staging-only | generated, Staging-only |
| `GERARD_PLATFORM_INSTANCE_SHARED_SECRET` | generated pair | same value |
| `GERARD_PLATFORM_HOSTNAMES` | Gerard Staging host | — |
| `GERARD_PLATFORM_INSTANCE_NOVOTRALUX_STAGING_CONFIGURATION_ENDPOINT` / `…_DOMAIN` | Novotralux Staging endpoint / host | — |
| `GOOGLE_ROUTES_MAX_CALLS_PER_OPERATION` | `0` | `0` |
| `GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD` | generated while the account does not exist | — |

Values are stored as *config* (not *sensitive*) so the tooling can compare them inside `vercel env run`; they are
Staging-only and never printed. No Production secret, mail, SL Automotive, webhook, Blob, OpenAI or Google Maps
credential is ever set on a Staging project, and no integration is enabled in the Staging databases.

## 2. One-time setup (your Windows machine)

Prerequisites: Node 20+, `npm ci` done, a Vercel account with access to `jonathans-projects-e6d49b10`, Neon access to
`lucky-wildflower-15424624`.

```bash
npm run staging:setup
npm run staging:check
```

`staging:setup` uses only the Vercel CLI and the Neon CLI (`npx vercel@latest`, `npx neonctl@latest`); their own login
sessions authenticate every call, and it opens `vercel login` / `neonctl auth` when needed. Idempotent — a second run
changes nothing. In order it:

1. checks both logins and the scope (`vercel project ls --scope jonathans-projects-e6d49b10`);
2. creates `gerard-staging` / `novotralux-custom-staging` if missing (`vercel project add`) and mirrors the build
   settings of `gerard` / `novotralux-custom` (`vercel project inspect` read-only → `vercel project update` on Staging);
3. creates each Neon Staging branch as a **child** of its own Production branch (never a root branch; the parent is
   only read) and, before any Staging project receives its URL: **reuses unchanged** the `DATABASE_URL` already stored
   in the Staging project when it is valid for the child (checked inside `vercel env run`: expected child endpoint, not
   Production, authenticates, resolves as Staging, and is the credential Neon holds for the child); otherwise **resets
   the owner role's password on the child branch only with Neon's official branch-scoped reset** (`neonctl api
   /projects/{project}/branches/{child}/roles/{owner}/reset_password -X POST`, waiting for Neon's operations) and reads
   the new credential from `neonctl connection-string`. Production credentials are never read; **sanitizes** a branch not yet marked — one `TRUNCATE` of every `public`
   table except `_prisma_migrations` and `Organization`, then every `Organization` row deleted except `org-gerard-default`
   / `org-novotralux`, then the schema is marked `gerard-staging-sanitized` (rows outside `public` → refused); applies
   the migrations and creates the QA accounts; and **verifies, fail-closed**: right parent, Staging endpoint, `staging`
   resolution, marker, no inherited row beyond the allow-list and the QA bootstrap, no enabled integration or integration
   secret, QA account active. An existing branch with another parent, or failing verification, stops setup;
4. writes the Staging variables (`vercel env add … production --project <staging project>`, value on stdin);
5. deploys both Staging projects and aligns Gerard's variables if Vercel assigned different stable hosts.

It refuses any Production or legacy project, a Neon branch that is (or is served by) Production or Preview, and two
Staging apps on one database. `--no-deploy` stops before deploying.

Limit of the child-branch model: rows deleted by the sanitization stay reachable through the Staging branch's own
point-in-time history (Neon restore / time travel) until Neon's history-retention window has passed. The Staging
applications never see them, but anyone with Neon console access to the project can; keep Neon access limited to the
people who already have Production access.

## 3. Daily workflow

```bash
git switch -c feature/<scope>
# … code, commit …
npm run staging:deploy               # Core or shared change: both Staging projects
npm run novotralux:staging:deploy    # Novotralux-only change
npm run gerard:staging:deploy        # Platform-only change
npm run staging:check                # read-only PASS/FAIL
```

Deploy commands deploy the **current commit** from a clean temporary `git worktree` (so `.env` files, build output and
other local files never reach Staging) to the Staging projects only, with `vercel deploy --prod`. Uncommitted source
changes are refused (generated `next-env.d.ts` / `*.tsbuildinfo` are ignored); `--allow-dirty` deploys the commit
anyway, without the local changes. The repository's own `.vercel` link is neither used nor changed. URLs, databases and
QA accounts persist.

### `staging:check`

Read-only: CLI metadata, a probe inside `vercel env run` (read-only database transactions and the existing signed reads
`getConfiguration` / `getOrgAdmins`), and HTTP requests to the stable URLs. PASS/FAIL only, never a secret or database
URL; exit code 1 on any FAIL.

1. Gerard Staging reachable · 2. Novotralux Staging reachable · 3. Gerard Staging DB is not Production ·
4. Novotralux Staging DB is not Production (both on their own Neon Staging branch, distinct, migrated) ·
5. Platform endpoint targets Novotralux Staging only (plus `staging` declared, same shared secret) ·
6. `getConfiguration` · 7. `getOrgAdmins` · 8. QA accounts · 9. Integrations safe · 10. No Production host leakage.

## 4. QA accounts

| Account | App | Role | Access |
| --- | --- | --- | --- |
| `gerard.staging.superadmin` | Gerard Staging | SUPER_ADMIN (+ VIEWER of `org-gerard-default`, needed for a session) | Initial password shown **once** by the `staging:setup` run that creates it (else written to `~/.gerard-staging-credentials.txt`, owner-only — delete it after use). Changed at first login. |
| `novotralux.staging.admin` | Novotralux Staging | ORG_ADMIN of `org-novotralux` | Gerard Staging → `/admin` → Novotralux → Accès administrateurs → Réinitialiser le mot de passe. |

Created only if missing; builds and deploys never reset them. No password is stored in the repository.

## 5. Standard vs Custom changes

- **Novotralux-only** (`apps/novotralux/**`): `novotralux:staging:deploy`, validate on Novotralux Staging.
- **Core / shared** (`packages/gerard-core`, `lib/`, `pages/`, `components/`, `prisma/`): ships in both apps. Deploy
  both with `staging:deploy`; validate Gerard Staging **and** Novotralux Staging, including `/admin` → Novotralux.
- **Migrations** are additive; each Staging build applies them to Staging first.

## 6. Promotion to Production

1. `npm run staging:check` → PASS (10/10), and manual validation on the Staging URLs.
2. Pull request `feature/<scope>` → `main`; merge after review.
3. `main` deploys the Production projects `gerard` and `novotralux-custom` through their existing Git integration
   (unchanged). The Production build verifies the Production database identity before building.

Nothing in the Staging tooling writes to `gerard`, `novotralux-custom` or `novotralux`.

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Vercel CLI is not authenticated` / `Neon CLI is not authenticated` | `npx vercel@latest login` / `npx neonctl@latest auth`, retry |
| `Production project … not found in scope` | the login lacks access to `jonathans-projects-e6d49b10` |
| `could not read its Staging variables` | the team enforces *sensitive* variables: allow config variables for the Staging projects, or rerun `staging:setup` after changing that policy |
| `Neon branch … refused` / `is not a child of` | a branch with a Staging name has the wrong parent or is Production/Preview: rename it in Neon (setup never deletes branches) |
| `… failed verification … NOT exported to Vercel` | the Staging database holds an enabled integration, an integration secret or inherited rows: fix it on the Staging branch, rerun |
| build fails `DATABASE_ENVIRONMENT_MISMATCH` | a project's database variable points at another environment: rerun `staging:setup` |
| build fails `STAGING_MIGRATION_FAILED` | read the (host-redacted) migration output in the Vercel build log |
| `getConfiguration` FAIL with `401` | the deployed Novotralux Staging predates the current secret: `npm run staging:deploy` |
| `Uncommitted changes` | commit or stash; or `--allow-dirty` to deploy the commit without them |
| lost the initial superadmin password before first login | Vercel → `gerard-staging` → Settings → Environment Variables → `GERARD_STAGING_SUPERADMIN_INITIAL_PASSWORD` |

## 8. Tests

- `tests/deployment-environment.test.ts` — environment resolution (incl. Staging projects), routing, database identity.
- `npm run test:staging-operator` — the operator commands against fake `vercel`/`neonctl` CLIs and a disposable local
  PostgreSQL (`STAGING_OPERATOR_TEST_ADMIN_URL`). The fakes pin the tooling's contract; they do not prove real Vercel or
  Neon behaviour — the first `staging:setup` on the operator machine does.
