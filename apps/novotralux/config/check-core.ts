import { GERARD_CORE_VERSION, checkCoreCompatibility } from '@prolific/gerard-core'
import { novotraluxManifest } from '../manifest'

const result = checkCoreCompatibility(novotraluxManifest.compatibleCore, GERARD_CORE_VERSION)
console.log(JSON.stringify({ application: novotraluxManifest.application, ...result }, null, 2))
if (!result.compatible) process.exitCode = 1
