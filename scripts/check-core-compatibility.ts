import { GERARD_CORE_VERSION, checkCoreCompatibility } from '@prolific/gerard-core'
import { gerardStandardManifest } from '../lib/standard/application'

function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null }
const compatibleCore = option('--compatible-core') || gerardStandardManifest.compatibleCore
const coreVersion = option('--core-version') || GERARD_CORE_VERSION
const result = checkCoreCompatibility(compatibleCore, coreVersion)
console.log(JSON.stringify({ application: gerardStandardManifest.application, ...result }, null, 2))
if (!result.compatible) process.exitCode = 1
