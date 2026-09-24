# Environment Architecture

`LOCAL != PREVIEW != PRODUCTION`. Production credentials are never copied into
normal local files, and Preview must not inherit credentials capable of reading
or mutating Production.

## Ownership

| Surface | Owns | Environment and database | Secrets |
| --- | --- | --- | --- |
| Gerard Core | Shared contracts, tenant security, business services and integration abstractions | No client runtime database | No client credentials |
| Gerard Standard | The standard multi-tenant product | Its own Vercel project and `DATABASE_URL`; local work uses a development database | Its own Production-only auth/provider credentials |
| Novotralux Custom | Operational Novotralux application and `org-novotralux` | `novotralux-custom`; `DATABASE_URL` is the runtime connection. The deployment wrapper may select the dedicated Custom URL before exposing it as `DATABASE_URL` | Production-only auth, Blob, Google server and integration-secret variables |
| Novotralux legacy | Public website and read-only fallback | `novotralux`; approved read-only fallback `DATABASE_URL` | Only credentials required to render public/fallback reads; no mail polling, SL mutation or server-side route-provider credentials |

## Runtime conventions

- Local Gerard uses a local/development database, development credentials and
  integrations disabled by default. Google provider calls default to `0`.
- Preview uses Preview-specific disposable resources. When none exist, the
  sensitive variable is absent rather than inherited from Production.
- Production secrets live in the owning Vercel project and Production scope.
  Local `.env.local` is not the normal transport for them.
- Migration URLs, bootstrap passwords and cleanup tokens are supplied only for
  the explicit maintenance command that needs them; they are not permanent
  application runtime configuration.
- `NEXT_PUBLIC_*` values are browser-visible build configuration, never secrets.

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
