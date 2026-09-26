import { resetPreviewAdmin } from '../preview-admin'
import { PREVIEW_ORGANIZATION_ID, connectPreviewDatabase } from './preview-database'

async function main() {
  const { prisma, endpoint } = connectPreviewDatabase()
  try {
    const result = await resetPreviewAdmin(prisma, { source: 'PREVIEW_QA_RESET' })
    console.log(JSON.stringify({ database: endpoint, organization: PREVIEW_ORGANIZATION_ID, user: result.username, userId: result.userId, role: 'ORG_ADMIN' }))
    // Printed once for the reviewer; only the hash is stored.
    console.log(`Temporary password (shown once): ${result.password}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'PREVIEW_ADMIN_RESET_FAILED'); process.exitCode = 1 })
