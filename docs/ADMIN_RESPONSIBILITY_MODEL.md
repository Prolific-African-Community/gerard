# Gerard administration responsibility model

## Responsibilities

| Action | SUPER_ADMIN | PLATFORM_SUPPORT | ORG_ADMIN | DISPATCHER / MANAGER / others |
| --- | --- | --- | --- | --- |
| View registered instances | Yes | Read-only | No | No |
| Configure Standard organization identity, branding and status | Yes | No | No | No |
| Configure Standard modules and integrations | Yes | No | No | No |
| View Custom instance metadata | Yes | Read-only | No | No |
| Mutate a Custom tenant database directly | No | No | No | No |
| List members of the current organization | In tenant context | No | Yes | No |
| Create a user in the current organization | In tenant context | No | Yes | No |
| Edit a manageable member identity | In tenant context | No | Yes | No |
| Change an organization role | In tenant context | No | Yes | No |
| Reset a member password or sessions | In tenant context | No | Yes | No |
| Disable or reactivate member access | In tenant context | No | Yes | No |
| Create a métier Driver resource | By métier permission | No | By métier permission | By métier permission |
| Create a Driver login account | In tenant context | No | Yes | No |

## Boundaries

`/admin` is the platform control plane. It owns product and organization configuration for Standard tenants. The central instance registry exposes safe Custom metadata but never opens arbitrary cross-database Prisma connections. A future Custom configuration mutation must use an explicit, authenticated, instance-targeted and auditable command exposed by that Custom application.

`/admin/organization` is limited to users and access in the server-resolved current organization. It cannot mutate organization identity, branding, modules, integrations, status, domains, Core version or instance metadata.

A Driver is a métier resource. Creating or editing it does not grant login access. Only an ORG_ADMIN (or a platform administrator acting through a tenant-scoped lifecycle) provisions the linked User and OrganizationUser membership.

## Safeguards and audit

Platform and multi-organization accounts are protected from organization-level identity, password and status changes. The final active ORG_ADMIN cannot be demoted or disabled. User creation, role changes, identity changes, password resets, status changes and session invalidation are audited without secrets or plaintext passwords.
