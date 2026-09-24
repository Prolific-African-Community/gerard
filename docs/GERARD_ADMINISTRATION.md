# Gerard administration

## Platform control plane

`/admin` is restricted to `SUPER_ADMIN` and read-only `PLATFORM_SUPPORT`. Its instance list comes from the central code registry (`lib/runtime/instance-registry.ts`), not from tenant business databases. Standard and Custom entries expose only trusted deployment metadata: identity, type, environment, organization ID, Core version, compatibility, status and public route.

The Standard organization drawer continues to administer organizations stored in the Gerard Standard database. Custom business metrics are deliberately absent from the platform aggregate.

## Organization administration

`/admin/organization` is a shared tenant-scoped surface for `ORG_ADMIN`. Every request resolves the active membership server-side and uses `runWithCurrentOrganization`; no organization ID supplied by the browser is trusted.

An `ORG_ADMIN` can list its members, create an account with a cryptographically generated one-time temporary password, and change organization roles. New accounts require a password change. The API never accepts or mutates `platformRole`. Modules are visible but platform-controlled and read-only. Safe organization branding/settings remain tenant scoped.

Gerard Standard and every Custom application, including Novotralux, consume the same route, APIs and guards. Custom applications never fork this administration feature.

## Boundaries

- `SUPER_ADMIN`: platform registry and Standard platform controls.
- `PLATFORM_SUPPORT`: read-only platform registry and controls.
- `ORG_ADMIN`: current organization only.
- Other organization roles: no organization administration.
- Custom databases remain isolated; the control plane does not query them for discovery or aggregate métier counts.
