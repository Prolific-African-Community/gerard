import 'dotenv/config'

import { requireGerardDemoDatabaseUrl } from '../lib/demo-database-guard'

const databaseUrl = new URL(requireGerardDemoDatabaseUrl())

console.info(
  `Cible de demo validee : ${databaseUrl.hostname}/${databaseUrl.pathname.slice(1)}`,
)
