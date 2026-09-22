import { checkCoreCompatibility } from '@prolific/gerard-core'
import { manifest } from './manifest'

const result = checkCoreCompatibility(manifest.compatibleCore, manifest.coreVersion)
console.log(JSON.stringify(result, null, 2))
if (!result.compatible) process.exitCode = 1
