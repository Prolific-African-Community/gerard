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

`DATABASE_URL` must point at a development database: the Production endpoints are refused before any connection is opened. `npm run db:check` reports what the current configuration resolves to.

## Checks

```bash
npx tsc --noEmit
npm test
npm run novotralux:test
npm run novotralux:check
```

## Production

Pushing to `main` deploys the Vercel projects `gerard` and `novotralux-custom` against their Production Neon databases. Every build runs the Production database identity check first.
