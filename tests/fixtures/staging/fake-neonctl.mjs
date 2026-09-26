// Test double of `neonctl` for tests/staging-operator.integration.ts: branches live in a JSON state file and each
// Staging branch is a database on a local PostgreSQL server. A created branch mimics Neon's schema-only copy (tables
// present, no rows, no migration history).
import { readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'

const file = process.env.FAKE_STAGING_STATE
const state = JSON.parse(readFileSync(file, 'utf8'))
const args = process.argv.slice(2)
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const save = () => writeFileSync(file, JSON.stringify(state, null, 2))
state.neonCalls.push(args.filter((arg) => !arg.startsWith('postgres')).join(' ')); save()
if (option('--project-id') && option('--project-id') !== state.neonProject) { console.error('project not found'); process.exit(1) }
const [group, command] = args

if (group === 'me') { if (state.neonUnauthenticated) { console.error('not authenticated'); process.exit(1) } console.log(JSON.stringify({ email: 'operator@example.invalid' })); process.exit(0) }
if (group === 'auth') process.exit(1)
if (group === 'branches' && command === 'list') { console.log(JSON.stringify(state.branches)); process.exit(0) }
if (group === 'branches' && command === 'create') {
  if (!args.includes('--schema-only')) { console.error('schema-only required by the fake'); process.exit(2) }
  const name = option('--name')
  const url = state.urls[name]
  if (!url) { console.error('unknown branch'); process.exit(2) }
  const admin = new pg.Client({ connectionString: state.adminUrl }); await admin.connect()
  const database = new URL(url).pathname.slice(1)
  await admin.query(`drop database if exists "${database}" with (force)`); await admin.query(`create database "${database}"`); await admin.end()
  const client = new pg.Client({ connectionString: url }); await client.connect()
  await client.query('create table public._prisma_migrations (id text primary key, finished_at timestamptz, rolled_back_at timestamptz); create table public."User" (id text primary key)'); await client.end()
  const branch = { id: `br-${name}`, name, parent_id: option('--parent'), default: false }
  state.branches.push(branch); save()
  console.log(JSON.stringify({ branch, endpoints: [], connection_uris: [{ connection_uri: url }] }))
  process.exit(0)
}
if (group === 'databases' && command === 'list') { console.log(JSON.stringify([{ name: 'neondb', owner_name: 'postgres' }])); process.exit(0) }
if (group === 'connection-string') {
  const branch = state.branches.find((item) => item.id === command || item.name === command)
  if (!branch || !state.urls[branch.name]) { console.error('branch not found'); process.exit(1) }
  console.log(state.urls[branch.name]); process.exit(0)
}
console.error(`fake neonctl: unsupported ${args.join(' ')}`); process.exit(2)
