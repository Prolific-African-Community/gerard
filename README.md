# Gerard

Multi-tenant dispatch platform: Gerard Core (`packages/gerard-core`), Gerard Standard (repository root) and the Custom applications (`apps/`, currently Novotralux).

## Two environments

Gerard has **LOCAL DEVELOPMENT** and **PRODUCTION**, and nothing else. See [docs/ENVIRONMENT_ARCHITECTURE.md](docs/ENVIRONMENT_ARCHITECTURE.md).

## Local development

```bash
npm install
npm run dev              # Gerard Standard
npm run novotralux:dev   # Novotralux Custom
```

Local development runs against the two real application databases: `DATABASE_URL` (root `.env`/`.env.local`) for Gerard Standard, and `NOVOTRALUX_CUSTOM_DATABASE_URL` (`apps/novotralux/.env.local`) for Novotralux Custom. Neither local env file is committed. `npm run db:check` verifies what a Production build would resolve to.

## Checks

```bash
npx tsc --noEmit
npm test
npm run novotralux:test
npm run novotralux:check
```

## Production

Pushing to `main` deploys the Vercel projects `gerard` and `novotralux-custom` against their Production Neon databases. Every build first verifies that it resolves to its own application database, so the two can never be swapped.
