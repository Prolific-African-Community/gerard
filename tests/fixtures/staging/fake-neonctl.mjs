// Test double of `neonctl` for tests/staging-operator.integration.ts. Branches live in a JSON state file; each branch is
// a database on a local PostgreSQL server that enforces passwords. Like Neon: a new root branch is refused ("root
// branches limit exceeded"); a child branch starts as a full copy of its parent (CREATE DATABASE … TEMPLATE) and inherits
// the parent's owner role WITH its password (emulated by a per-branch owner role created with the parent's password, so
// that changing it on the child cannot change the parent). `connection-string` returns the control plane's password (the
// inherited one), like Neon after an SQL password change. Production parents are only used as templates.
import { readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'

const file = process.env.FAKE_STAGING_STATE
const state = JSON.parse(readFileSync(file, 'utf8'))
const args = process.argv.slice(2)
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const save = () => writeFileSync(file, JSON.stringify(state, null, 2))
state.neonCalls.push(args.filter((arg) => !arg.startsWith('postgres')).join(' ')); save()
const die = (message, code = 1) => { console.error(`ERROR: ${message}`); process.exit(code) }
if (option('--project-id') && option('--project-id') !== state.neonProject) die('project not found')
const [group, command] = args
const branchOf = (value) => state.branches.find((item) => item.id === value || item.name === value)
const admin = async (work) => { const client = new pg.Client({ connectionString: state.adminUrl }); await client.connect(); try { return await work(client) } finally { await client.end() } }

if (group === 'me') { if (state.neonUnauthenticated) die('not authenticated'); console.log(JSON.stringify({ email: 'operator@example.invalid' })); process.exit(0) }
if (group === 'auth') process.exit(1)
if (group === 'branches' && command === 'list') { console.log(JSON.stringify(state.branches)); process.exit(0) }
if (group === 'branches' && command === 'create') {
  const parent = option('--parent')
  if (args.includes('--schema-only') || !parent) die('root branches limit exceeded')
  const parentBranch = branchOf(parent) ?? die('parent branch not found')
  const name = option('--name')
  const url = state.urls[name] ?? die('unknown branch')
  const database = new URL(url).pathname.slice(1)
  const owner = `owner_${name.replace(/-/g, '_')}`
  const parentOwner = state.owners[parentBranch.id]
  await admin(async (client) => {
    await client.query(`drop database if exists "${database}" with (force)`)
    if ((await client.query('select 1 from pg_roles where rolname = $1', [owner])).rowCount) await client.query(`alter role "${owner}" password '${state.productionPassword}'`)
    else await client.query(`create role "${owner}" login password '${state.productionPassword}'`)
    await client.query(`create database "${database}" template "${state.parentDatabases[parentBranch.id]}"`)
    await client.query(`alter database "${database}" owner to "${owner}"`)
  })
  const child = new pg.Client({ connectionString: Object.assign(new URL(state.adminUrl), { pathname: `/${database}` }).toString() }); await child.connect()
  await child.query(`reassign owned by "${parentOwner}" to "${owner}"`); await child.end()
  state.owners[`br-${name}`] = owner
  const branch = { id: `br-${name}`, name, parent_id: parentBranch.id, default: false }
  state.branches.push(branch); save()
  console.log(JSON.stringify({ branch, endpoints: [{ id: `ep-${name}`, type: 'read_write' }] }))
  process.exit(0)
}
if (group === 'roles') die('roles are not managed by the Staging tooling (fake guard)', 2)
// Neon's official API through the CLI session: branch-scoped role password reset (the control plane changes the password
// on that branch only and records it for connection-string) and operation status.
if (group === 'api') {
  const reset = /^\/projects\/([^/]+)\/branches\/([^/]+)\/roles\/([^/]+)\/reset_password$/.exec(command ?? '')
  if (reset) {
    if (option('-X') !== 'POST' || reset[1] !== state.neonProject) die('bad reset request', 2)
    const branch = branchOf(reset[2]) ?? die('branch not found')
    if (state.parentDatabases[branch.id]) die('fake guard: password reset on a Production branch')
    const role = decodeURIComponent(reset[3])
    if (role !== state.owners[branch.id]) die('role not found')
    const password = `neon-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    await admin((client) => client.query(`alter role "${role}" password '${password}'`))
    state.passwords = { ...(state.passwords ?? {}), [branch.id]: password }; save()
    console.log(JSON.stringify({ role: { name: role, password }, operations: [{ id: `op-${branch.id}`, action: 'apply_config', status: 'running' }] }))
    process.exit(0)
  }
  if (/^\/projects\/[^/]+\/operations\/[^/]+$/.test(command ?? '')) { console.log(JSON.stringify({ operation: { id: command.split('/').pop(), status: 'finished' } })); process.exit(0) }
  die(`fake neonctl api: unsupported ${command}`, 2)
}
if (group === 'databases' && command === 'list') { const branch = branchOf(option('--branch')) ?? die('branch not found'); console.log(JSON.stringify([{ name: 'neondb', owner_name: state.owners[branch.id] }])); process.exit(0) }
if (group === 'connection-string') {
  const branch = branchOf(command) ?? die('branch not found')
  const url = new URL(state.urls[branch.name] ?? state.parentUrls?.[branch.name] ?? die('branch has no database'))
  const role = option('--role-name')
  if (role !== state.owners[branch.id]) die('role not found')
  url.username = role
  url.password = state.passwords?.[branch.id] ?? state.productionPassword
  console.log(url.toString()); process.exit(0)
}
die(`fake neonctl: unsupported ${args.join(' ')}`, 2)
