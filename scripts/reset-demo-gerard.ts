import 'dotenv/config'

import { createGerardDemoPrisma, getGerardDemoCounts, replaceGerardDemoData } from './demo/gerard-demo-data'

const prisma = createGerardDemoPrisma()

replaceGerardDemoData(prisma)
  .then(async () => console.info(JSON.stringify(await getGerardDemoCounts(prisma))))
  .finally(async () => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
