// Test double of `neonctl` for tests/staging-operator.integration.ts. Branches live in a JSON state file; each branch is
// a database on a local PostgreSQL server. Like Neon: a new root branch is refused ("root branches limit exceeded"), and a
// child branch starts as a full copy of its parent (CREATE DATABASE … TEMPLATE <parent database>). Roles are listed per
// branch; `roles create` makes a login role. Production parents are only ever used as templates (never written).
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
state.roles ??= {}

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
  await admin(async (client) => { await client.query(`drop database if exists "${database}" with (force)`); await client.query(`create database "${database}" template "${state.parentDatabases[parentBranch.id]}"`) })
  const branch = { id: `br-${name}`, name, parent_id: parentBranch.id, default: false }
  state.branches.push(branch); save()
  console.log(JSON.stringify({ branch, endpoints: [{ id: `ep-${name}`, type: 'read_write' }] }))
  process.exit(0)
}
if (group === 'roles' && command === 'list') { const branch = branchOf(option('--branch')) ?? die('branch not found'); console.log(JSON.stringify(['postgres', ...(state.roles[branch.id] ?? [])].map((name) => ({ name })))); process.exit(0) }
if (group === 'roles' && command === 'create') {
  const branch = branchOf(option('--branch')) ?? die('branch not found')
  if (state.parentDatabases[branch.id]) die('refusing to create a role on a Production branch (fake guard)')
  const name = option('--name')
  await admin(async (client) => { if (!(await client.query('select 1 from pg_roles where rolname = $1', [name])).rowCount) await client.query(`create role "${name}" login password 'staging-role-password'`) })
  state.roles[branch.id] = [...(state.roles[branch.id] ?? []), name]; save()
  console.log(JSON.stringify({ role: { name } }))
  process.exit(0)
}
if (group === 'databases' && command === 'list') { console.log(JSON.stringify([{ name: 'neondb', owner_name: 'postgres' }])); process.exit(0) }
if (group === 'connection-string') {
  const branch = branchOf(command) ?? die('branch not found')
  const url = new URL(state.urls[branch.name] ?? die('branch has no database'))
  const role = option('--role-name')
  if (role !== 'postgres' && !(state.roles[branch.id] ?? []).includes(role)) die('role not found')
  url.username = role
  url.password = role === 'postgres' ? '' : 'staging-role-password'
  console.log(url.toString()); process.exit(0)
}
die(`fake neonctl: unsupported ${args.join(' ')}`, 2)
