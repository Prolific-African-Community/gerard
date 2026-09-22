/**
 * Reconstruction destructive du jeu de donnees initial sur DATABASE_URL.
 *
 * Supprime les missions GRD-*, leurs dependances et les ressources creees par
 * le bootstrap, puis les recree. Reserve a un usage QA explicite : jamais
 * automatique, jamais pendant un build ou un deploiement.
 *
 * Exige --force pour s'executer.
 */
import 'dotenv/config'

import {
  createGerardPrisma,
  getGerardDataCounts,
  replaceGerardBootstrapData,
} from './bootstrap/gerard-initial-data'

if (!process.argv.includes('--force')) {
  console.error(
    [
      'Refus : ce script supprime des donnees Gerard existantes.',
      'Relancer avec --force si c est bien l intention :',
      '  npm run data:reset -- --force',
    ].join('\n'),
  )
  process.exit(1)
}

const prisma = createGerardPrisma()

async function main() {
  const before = await getGerardDataCounts(prisma)
  console.info(`Avant reset : ${JSON.stringify(before)}`)
  await replaceGerardBootstrapData(prisma)
  console.info(`Apres reset : ${JSON.stringify(await getGerardDataCounts(prisma))}`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
