# Platform-to-Custom configuration channel

The platform control plane may send narrowly scoped configuration commands to a registered Custom instance. The caller must be a `SUPER_ADMIN`; `PLATFORM_SUPPORT` and tenant users cannot issue commands.

Requests use `POST /api/internal/platform/configuration` with a shared deployment secret (`GERARD_PLATFORM_INSTANCE_SHARED_SECRET`) held only by the platform and target server environments. The HMAC covers the version, application, organization, action, payload, timestamp and nonce. The Custom endpoint verifies the expected application and organization from its own runtime identity, rejects expired requests (five-minute window), and rejects a nonce replay within that window.

The public contract is exported by `@prolific/gerard-core`. Supported actions are `updateIdentity`, `updateBranding`, `updateModules`, `updateIntegrationConfig` and `updateIntegrationEnabled`. Payloads are allow-listed; passwords, API keys, webhook secrets, secret references, database URLs, model names and arbitrary organization IDs are never accepted.

The Custom instance updates only its own local organization database using the existing organization services. Integration secret values remain in the Custom secret provider. The central registry stores the trusted Custom configuration endpoint separately from tenant configuration. No platform code opens a Prisma connection to a Custom database.

The channel secret must be configured independently in each platform/Custom environment before enabling a deployment. It is intentionally not present in source control, browser bundles, or organization configuration.
