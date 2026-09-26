# Novotralux Custom Preview workflow

Review Custom changes on Preview before `main` and Production. Preview has its own synthetic database
(Neon branch `novotralux-custom-preview`, endpoint `ep-mute-poetry-za1swvwu`, see `ENVIRONMENT_ARCHITECTURE.md`)
and never reads or writes Production.

## Loop

1. Push the branch. The `novotralux-custom` Vercel project builds a Preview deployment for it (and the Gerard Platform
   project builds its own Preview); URLs appear on the commit/PR checks and in the Vercel dashboard. Preview
   deployments stay behind Vercel protection.
2. Log in to the Novotralux Preview with the stable synthetic ORG_ADMIN `preview.admin` (`org-novotralux`, no platform
   role). Every Preview deployment shares the persistent Preview database, so the account and its password carry over.
3. Password unknown or account locked? Recover it in the product, never in the database:
   Gerard Platform Preview → `/admin` (SUPER_ADMIN) → Novotralux → Aperçu → **Accès administrateurs** →
   *Réinitialiser le mot de passe*. The temporary password is generated inside the Custom Preview, shown once, and
   must be changed at the next login. *Déconnecter les sessions* and *Réactiver* are available there too.
4. Open `/admin/organization`, review, approve, merge to `main`; Production deploys from `main` only.

No database URL, seed rerun, Vercel secret or reset route is involved.

## Commands (repository root)

`npm run novotralux:preview:check` is a read-only readiness check (Preview database, `org-novotralux`, `preview.admin`
active ORG_ADMIN). It needs `NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL` locally and refuses any database other than the
Preview endpoint; the URL is never printed. Because that variable is a Vercel *sensitive* value, `vercel env pull`
cannot provide it: use the SUPER_ADMIN recovery above for day-to-day access.

`npm run preview:seed --workspace=@prolific/gerard-novotralux` rebuilds all synthetic fixtures and only runs on an
empty Preview database; use it for a brand-new Preview branch, not for access.

## Guarantees

- Preview builds resolve `NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL` (`apps/novotralux/scripts/database-target.mjs`) and
  fail rather than fall back to Production.
- On a Preview platform runtime, the Custom configuration endpoint comes only from
  `GERARD_PLATFORM_INSTANCE_NOVOTRALUX_PREVIEW_CONFIGURATION_ENDPOINT`; the Production endpoint is never used
  (`lib/runtime/instance-registry.ts`).
