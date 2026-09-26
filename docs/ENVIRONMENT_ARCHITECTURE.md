# Environment Architecture

## GERARD HAS TWO ENVIRONMENTS

There is **no official Staging** and **no official Preview**. Both architectures
were abandoned and removed from the repository.

### LOCAL DEVELOPMENT

- Developer machine, a plain local Next.js process.
- Works against the two real application databases, exactly like the other
  projects on this machine:
  - Gerard Standard: `DATABASE_URL` (root `.env` / `.env.local`).
  - Novotralux Custom: `NOVOTRALUX_CUSTOM_DATABASE_URL`
    (`apps/novotralux/.env.local`), required and never inherited from
    `DATABASE_URL`.
- `npm run dev` — Gerard Standard.
- `npm run novotralux:dev` — Novotralux Custom.
- Local env files: root `.env.local` for Gerard,
  `apps/novotralux/.env.local` for Novotralux Custom. The launcher loads the
  application-specific file first, so its keys win. Neither is committed.
- Mail intake is disabled locally (`MAIL_IMPORT_PROVIDER=disabled`) so a
  development process never polls the live mailbox into the application data.

### PRODUCTION

- `main` branch.
- Vercel projects `gerard` and `novotralux-custom`.
- Production Neon databases (see the identity table below).

`resolveDeploymentEnvironment` (`packages/gerard-core/src/deployment-environment.ts`,
mirrored for the build wrapper in `apps/novotralux/scripts/database-target.mjs`)
returns `development` or `production` and nothing else. `production` means Vercel
Production; everything else, including a local `next build`, is `development`.
`GERARD_INSTANCE_ENVIRONMENT` is optional and accepts only those two values; it
must agree with Vercel, and any unknown value or contradiction fails closed. No
`VERCEL_TARGET_ENV`, Preview or Staging variable is used anywhere. Local
development never declares itself as Production.

## Production database validation

Local development is deliberately unrestricted: it uses the real application
databases. The guard constrains **Production deployments only**, so each one
reaches its own application database and nothing else.

`assertRuntimeDatabase` (`lib/runtime/database-guard.ts`) runs where the Prisma
client is created, so it fires before any connection. Database identity is the
Neon endpoint id, so a pooled host is the same identity and no variable or
environment *name* is trusted. The application is `GERARD_APPLICATION_ID`
(absent means Gerard Standard).

| Runtime | Rule |
| --- | --- |
| local development | No restriction. |
| Production `gerard` | Must resolve to `ep-ancient-block-za26cw6e`, else `PRODUCTION_DATABASE_MISMATCH`. |
| Production `novotralux-custom` | Must resolve to `ep-ancient-surf-zav7xo37`, else `PRODUCTION_DATABASE_MISMATCH`. |
| Production, unknown application | `PRODUCTION_DATABASE_UNDECLARED`. |

So a Production deployment cannot swap the two application databases, and cannot
open an undocumented endpoint without a code change.

`npm run build` runs `scripts/check-production-database.ts`, a static identity
check with no connection: a Production build whose `DATABASE_URL` is not that
application's documented database fails the deployment instead of the running
site. It is a no-op locally. Run it on demand with `npm run db:check`.

## Ownership
| Surface | Owns | Environment and database | Secrets |
| --- | --- | --- | --- |
| Gerard Core | Shared contracts, tenant security, business services and integration abstractions | No client runtime database | No client credentials |
| Gerard Standard | The standard multi-tenant product | Its own Vercel project and `DATABASE_URL`; local work uses a development database | Its own Production-only auth/provider credentials |
| Novotralux Custom | Operational Novotralux application and `org-novotralux` | `novotralux-custom`; the wrapper resolves the Production URL in Production and the local URL in development, and exposes only that value as `DATABASE_URL` | Production-only auth, Blob, Google server and integration-secret variables |
| Novotralux legacy | Public website and read-only fallback | `novotralux`; approved read-only fallback `DATABASE_URL` | Only credentials required to render public/fallback reads; no mail polling, SL mutation or server-side route-provider credentials |

## Production database identities

| Runtime | Neon project | Branch | Database | Host prefix | Role |
| --- | --- | --- | --- | --- | --- |
| Gerard Standard | `lucky-wildflower-15424624` | `br-patient-wildflower-zarmyqcq` (`production`) | `neondb` | `ep-ancient-block-za26cw6e` | writable Standard runtime |
| Novotralux Custom | `lucky-wildflower-15424624` | `br-cool-sea-zaufb5ng` (`novotralux-custom-production`) | `neondb` | `ep-ancient-surf-zav7xo37` | sole writable Novotralux métier runtime |
| Novotralux legacy | `noisy-cloud-70722717` | `br-blue-tree-al34k8hl` (`production`) | `neondb` | Neon legacy endpoint | `legacy_fallback_reader` (read-only) |

The branches are the isolation boundary even when two applications share a
Neon project. `novotralux-custom-production` is not a generic migration target;
it is the active Custom production database. Maintenance commands must pass the
branch positionally to `neonctl connection-string`; the command has no
`--branch-id` option and otherwise falls back to the project default branch.

## Runtime conventions

- Local Gerard uses the Gerard Standard application database, and mail intake is
  disabled. Google provider calls are capped locally for Novotralux Custom.
- Novotralux local development requires `NOVOTRALUX_CUSTOM_DATABASE_URL`. There is
  no fallback to the Gerard Standard `DATABASE_URL`.
- Novotralux Production requires `NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL`, and
  Vercel Production also maps `DATABASE_URL` to the same branch because
  serverless functions do not inherit variables calculated by the build wrapper.
- `LEGACY_TARGET_DATABASE_URL` is an obsolete migration variable and is not a
  Custom runtime input.
- Vercel stores every Production variable of both projects as a sensitive value,
  so `vercel env pull` returns `[SENSITIVE]` and cannot seed a local file. Local
  values are maintained by hand in the two `.env.local` files.
- Migration URLs, bootstrap passwords and cleanup tokens are supplied only for
  the explicit maintenance command that needs them; they are not permanent
  application runtime configuration.
- `NEXT_PUBLIC_*` values are browser-visible build configuration, never secrets.
- On this Windows host, Prisma's Rust schema engine selects an unreachable Neon
  IPv6 address. Migration status can be checked with an ephemeral IPv4 direct
  URL that retains the Neon endpoint option; runtime connection strings remain
  unchanged.

## Custom integration convention

For a client `CLIENT_X`, non-sensitive integration configuration lives in
`OrganizationIntegration.configJson`. The row points to secrets by reference;
Gerard Core never embeds client credentials.

Example mail wiring:

```text
secretRef = CLIENT_X_MAIL
GERARD_INTEGRATION_SECRET_CLIENT_X_MAIL_USERNAME
GERARD_INTEGRATION_SECRET_CLIENT_X_MAIL_PASSWORD
```

Provider implementations resolve the reference through
`IntegrationSecretProvider`. A large shared Gerard Standard deployment should
eventually back this provider with an external secret store rather than an
unbounded collection of Vercel environment variables.

## Novotralux operational boundaries

- Custom is the sole writable business runtime.
- Legacy remains deployed for the public website and emergency read-only
  fallback. Its mail import, SL webhook/outbound and background operational
  credentials are not part of the fallback contract.
- Legacy snapshots, database branches and rollback deployments remain retained;
  environment cleanup never deletes those resources.
