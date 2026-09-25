# Novotralux Custom Preview workflow

Review Custom changes on Preview before `main` and Production. Preview has its own synthetic database
(Neon branch `novotralux-custom-preview`, endpoint `ep-mute-poetry-za1swvwu`, see `ENVIRONMENT_ARCHITECTURE.md`)
and never reads or writes Production.

## Loop

1. Push the branch. The `novotralux-custom` Vercel project builds a Preview deployment for it; the URL appears on the
   commit/PR checks and in the Vercel dashboard. Preview deployments stay behind Vercel protection.
2. Log in with the stable QA account `preview.admin` (ORG_ADMIN of `org-novotralux`, synthetic, no platform role).
3. Review, approve, merge to `main`; Production deploys from `main` only.

## Commands (repository root)

One-time per machine, to fetch the Preview-scoped variables without copying them by hand:

```sh
npx vercel link --project novotralux-custom
npx vercel env pull .env.preview.local --environment=preview
```

`.env.preview.local` is git-ignored and holds Preview values only; no Production secret is needed locally.

| Command | Effect |
| --- | --- |
| `npm run novotralux:preview:check` | Read-only: confirms the Preview database, `org-novotralux`, and that `preview.admin` is an active ORG_ADMIN. |
| `npm run novotralux:preview:admin-reset` | Creates or resets `preview.admin` only: new random password (printed once), active, no forced change, no platform role, old sessions invalidated, audited. |

Both commands refuse to run unless `NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL` points at the Preview endpoint; the
Production endpoints are rejected explicitly. The database URL is never printed. Passwords are never stored in the
repository or in docs: reset and share the one printed.

`npm run preview:seed --workspace=@prolific/gerard-novotralux` rebuilds all synthetic fixtures and only runs on an
empty Preview database; use it for a new branch, not for day-to-day access.

## Guarantees

- Preview builds resolve `NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL` (`apps/novotralux/scripts/database-target.mjs`) and
  fail rather than fall back to Production.
- On a Preview platform runtime, the Custom configuration endpoint comes only from
  `GERARD_PLATFORM_INSTANCE_NOVOTRALUX_PREVIEW_CONFIGURATION_ENDPOINT`; the Production endpoint is never used
  (`lib/runtime/instance-registry.ts`).
