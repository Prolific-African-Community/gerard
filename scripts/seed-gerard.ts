/**
 * Bootstrap initial des donnees Gerard (DATABASE_URL).
 *
 * Non destructif : si la base contient deja des donnees d'exploitation, le
 * script s'arrete sans rien ecrire. Il ne doit jamais etre branche sur un
 * install, un postinstall, un build ou un deploiement.
 *
 * Pour repartir volontairement d'un jeu de donnees propre :
 *   npm run data:reset -- --force
 */
import 'dotenv/config'

import {
  createGerardPrisma,
  getGerardDataCounts,
  replaceGerardBootstrapData,
} from './bootstrap/gerard-initial-data'

const prisma = createGerardPrisma()

async function main() {
  const counts = await getGerardDataCounts(prisma)
  const existing = counts.missions + counts.drivers + counts.trucks

  if (existing > 0) {
    console.info(
      [
        'Base Gerard deja peuplee : aucune ecriture.',
        JSON.stringify(counts),
        'Utiliser "npm run data:reset -- --force" pour reconstruire volontairement le jeu initial.',
      ].join('\n'),
    )
    return
  }

  await replaceGerardBootstrapData(prisma)
  console.info(JSON.stringify(await getGerardDataCounts(prisma)))
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
