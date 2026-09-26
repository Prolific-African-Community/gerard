// In-memory Vercel REST API for tests/staging-operator.integration.ts. Every mutating call is recorded so the test can
// prove that only the `staging` custom environment is ever written.
import { createServer } from 'node:http'

export function productionFixture() {
  const env = (id, key, target) => ({ id, key, type: 'sensitive', target, value: `production-${key}` })
  return {
    scope: { id: 'team_gerard', slug: 'jonathans-projects-e6d49b10' },
    customEnvironmentLimit: 1,
    projects: [
      { id: 'prj_gerard', name: 'gerard', accountId: 'team_gerard', customEnvironments: [], protectionBypass: {},
        envs: [env('env_g1', 'DATABASE_URL', ['production']), env('env_g2', 'JWT_SECRET', ['production', 'preview']), env('env_g3', 'GERARD_PLATFORM_INSTANCE_SHARED_SECRET', ['production'])],
        domains: [{ name: 'gerard-dispatch.vercel.app', customEnvironmentId: null, gitBranch: null }] },
      { id: 'prj_novotralux', name: 'novotralux-custom', accountId: 'team_gerard', customEnvironments: [], protectionBypass: {},
        // Existing Preview trust of the Gerard project, restricted to preview → preview.
        trustedSources: { enableVercelCiSameRepository: true, projects: { prj_gerard: { label: 'Gerard Preview', customAllow: [{ from: { slugs: ['preview'] }, to: { slugs: ['preview'] } }] } } },
        envs: [env('env_n1', 'NOVOTRALUX_CUSTOM_PRODUCTION_DATABASE_URL', ['production']), env('env_n2', 'NOVOTRALUX_CUSTOM_PREVIEW_DATABASE_URL', ['preview']), env('env_n3', 'GERARD_PLATFORM_INSTANCE_SHARED_SECRET', ['production'])],
        domains: [{ name: 'novotralux-custom.vercel.app', customEnvironmentId: null, gitBranch: null }, { name: 'www.novotralux.eu', customEnvironmentId: null, gitBranch: null }] },
      // Decoys: a lookup by Production hostname or of the legacy project would silently succeed; the test forbids both.
      { id: 'prj_decoy_hostname', name: 'gerard-dispatch', accountId: 'team_gerard', customEnvironments: [], protectionBypass: {}, envs: [], domains: [] },
      { id: 'prj_legacy_novotralux', name: 'novotralux', accountId: 'team_gerard', customEnvironments: [], protectionBypass: {}, envs: [], domains: [{ name: 'novotralux-legacy.vercel.app', customEnvironmentId: null, gitBranch: null }] },
    ],
  }
}

export async function startMockVercel(state) {
  const writes = []
  const calls = []
  let sequence = 0
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (req.headers.authorization !== 'Bearer test-vercel-token') return send(403, { error: { code: 'forbidden', message: 'bad token' } })
    calls.push(`${req.method} ${url.pathname}`)
    // As observed on the real account: listing teams is not authorized, and a call without the scope is refused.
    if (url.pathname === '/v2/teams') return send(403, { error: { code: 'forbidden', message: 'Not authorized' } })
    const scoped = url.searchParams.get('slug') === state.scope.slug || url.searchParams.get('teamId') === state.scope.id
    if (!scoped) return send(url.searchParams.get('slug') || url.searchParams.get('teamId') ? 404 : 403, { error: { code: 'forbidden', message: 'Not authorized' } })
    if (req.method !== 'GET') writes.push({ method: req.method, path: url.pathname, body })
    const parts = url.pathname.split('/').filter(Boolean)
    const project = state.projects.find((item) => item.id === parts[2] || item.name === decodeURIComponent(parts[2] ?? ''))
    if (!project) return send(404, { error: { code: 'not_found', message: 'project' } })
    const route = `${req.method} ${parts[0]}/${parts.slice(3).join('/')}`.replace(/\/env\/[^/]+$/, '/env/:id')
    const publicEnv = ({ value: _value, ...item }) => item
    switch (route) {
      case 'GET v9/': return send(200, { id: project.id, name: project.name, accountId: project.accountId, protectionBypass: project.protectionBypass, trustedSources: project.trustedSources ?? null })
      case 'PATCH v9/': { if (Object.keys(body).join() !== 'trustedSources') return send(400, { error: { code: 'bad_request', message: 'unexpected project update' } }); project.trustedSources = body.trustedSources; return send(200, {}) }
      case 'GET v9/custom-environments': return send(200, { accountLimit: { total: state.customEnvironmentLimit }, environments: project.customEnvironments })
      case 'POST v9/custom-environments': { const created = { id: `env_custom_${++sequence}`, slug: body.slug, type: 'preview' }; project.customEnvironments.push(created); return send(200, created) }
      case 'GET v10/env': return send(200, { envs: project.envs.map(publicEnv) })
      case 'POST v10/env': { const created = { id: `env_${++sequence}`, key: body.key, type: body.type, value: body.value, target: body.target, customEnvironmentIds: body.customEnvironmentIds }; project.envs.push(created); return send(200, publicEnv(created)) }
      case 'GET v1/env/:id': { const found = project.envs.find((item) => item.id === parts[4]); return found ? send(200, { ...publicEnv(found), value: found.type === 'sensitive' ? '' : found.value, decrypted: true }) : send(404, {}) }
      case 'PATCH v9/env/:id': { const found = project.envs.find((item) => item.id === parts[4]); if (!found) return send(404, {}); found.value = body.value; return send(200, publicEnv(found)) }
      case 'GET v9/domains': return send(200, { domains: project.domains })
      case 'POST v10/domains': { project.domains.push({ name: body.name, customEnvironmentId: body.customEnvironmentId ?? null, gitBranch: null }); return send(200, {}) }
      case 'PATCH v1/protection-bypass': { project.protectionBypass[`bypass-${project.name}-${++sequence}-000000000000`] = { scope: 'automation-bypass' }; return send(200, { protectionBypass: project.protectionBypass }) }
      default: return send(404, { error: { code: 'not_found', message: route } })
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, state, writes, calls, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }) }
}
