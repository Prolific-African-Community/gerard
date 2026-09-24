# Gerard administration

## Platform control plane

`/admin` is restricted to `SUPER_ADMIN` and read-only `PLATFORM_SUPPORT`. Its instance list comes from the central code registry (`lib/runtime/instance-registry.ts`), not from tenant business databases. Standard and Custom entries expose only trusted deployment metadata: identity, type, environment, organization ID, Core version, compatibility, status and public route.

The Standard organization drawer continues to administer organizations stored in the Gerard Standard database. Custom business metrics are deliberately absent from the platform aggregate.

## Organization administration

`/admin/organization` is a shared tenant-scoped surface for `ORG_ADMIN`. Every request resolves the active membership server-side and uses `runWithCurrentOrganization`; no organization ID supplied by the browser is trusted.

An `ORG_ADMIN` can search and filter members, create an account with a cryptographically generated one-time temporary password, change supported organization roles, enable or disable eligible tenant-only accounts, reset passwords, and invalidate sessions. New and reset accounts require a password change. Temporary plaintext is returned once, never persisted in audit metadata, and all existing sessions are revoked through `sessionVersion`.

The workspace also exposes tenant-scoped overview, safe integration health, read-only platform modules, appearance preview, and a sanitized activity history. Successful authentication updates `lastLoginAt`; no per-request presence tracking is performed. Accounts with a platform role and accounts shared across organizations remain platform-managed. The final active `ORG_ADMIN` cannot be removed, demoted, or disabled. The API never accepts or mutates `platformRole`. Safe organization branding/settings remain tenant scoped.

Gerard Standard and every Custom application, including Novotralux, consume the same route, APIs and guards. Custom applications never fork this administration feature.

## Boundaries

- `SUPER_ADMIN`: platform registry and Standard platform controls.
- `PLATFORM_SUPPORT`: read-only platform registry and controls.
- `ORG_ADMIN`: current organization only.
- Other organization roles: no organization administration.
- Custom databases remain isolated; the control plane does not query them for discovery or aggregate métier counts.
