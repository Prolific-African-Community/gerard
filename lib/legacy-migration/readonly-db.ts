import { createHash } from 'node:crypto'
import { Client } from 'pg'
import type { Dataset, Row } from './analyzer'

function quote(identifier: string) { return `"${identifier.replace(/"/g, '""')}"` }

export class ReadonlyDatabase {
  private client: Client
  constructor(connectionString: string, private label: string) {
    if (!connectionString) throw new Error(`${label}_DATABASE_URL_REQUIRED`)
    this.client = new Client({ connectionString, application_name: `gerard-legacy-dry-run-${label}`, options: '-c default_transaction_read_only=on' })
  }
  async connect() { await this.client.connect(); await this.client.query('BEGIN READ ONLY'); const check = await this.client.query<{ transaction_read_only: string }>('SHOW transaction_read_only'); if (check.rows[0]?.transaction_read_only !== 'on') throw new Error(`${this.label}_NOT_READ_ONLY`) }
  async availableTables() { const result = await this.client.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`); return new Set(result.rows.map((row) => row.table_name)) }
  async readDataset(requested: readonly string[]): Promise<Dataset> { const available = await this.availableTables(); const data: Dataset = {}; for (const table of requested) data[table] = available.has(table) ? (await this.client.query<Row>(`SELECT * FROM ${quote(table)} ORDER BY "id"`)).rows : []; return data }
  async fingerprint(tables: readonly string[]) { const available = await this.availableTables(); const parts: string[] = []; for (const table of Array.from(tables).sort()) { if (!available.has(table)) { parts.push(`${table}:MISSING`); continue } const result = await this.client.query<{ digest: string }>(`SELECT md5(COALESCE(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS digest FROM ${quote(table)} t`); parts.push(`${table}:${result.rows[0]?.digest || ''}`) } return createHash('sha256').update(parts.join('|')).digest('hex') }
  async close() { try { await this.client.query('ROLLBACK') } finally { await this.client.end() } }
}
