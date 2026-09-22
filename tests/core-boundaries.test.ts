import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd())
const corePublic = readFileSync(path.join(root, 'packages/gerard-core/src/index.ts'), 'utf8')
assert.doesNotMatch(corePublic, /prisma|pages\/|components\//i)

const applicationFiles = ['types.ts', 'definition.ts', 'default.ts', 'resolver.ts', 'index.ts']
for (const file of applicationFiles) {
  const source = readFileSync(path.join(root, 'packages/gerard-core/src/application', file), 'utf8')
  assert.doesNotMatch(source, /\.\.\/\.\.\/\.\.\/|lib\/standard|pages\/|components\//, `Core application boundary leaked through ${file}`)
}

for (const file of ['lib/dispatch/optimization/engine.ts', 'lib/dispatch/intelligence/assistant.ts', 'lib/dispatch/suggestions/application.ts']) {
  const source = readFileSync(path.join(root, file), 'utf8')
  assert.doesNotMatch(source, /lib\/standard|pages\/|components\//, `Core métier depends on Standard UI: ${file}`)
}
console.log('Core public boundary and métier-to-Standard dependency audit: OK')
