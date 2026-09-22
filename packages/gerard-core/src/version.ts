import packageMetadata from '../package.json'

export const GERARD_CORE_VERSION = packageMetadata.version

type Version = { major: number; minor: number; patch: number }
export type CoreCompatibilityStatus = 'COMPATIBLE' | 'CORE_TOO_OLD' | 'INCOMPATIBLE_MAJOR' | 'INCOMPATIBLE_VERSION' | 'INVALID_RANGE'
export type CoreCompatibilityResult = { compatible: boolean; status: CoreCompatibilityStatus; coreVersion: string; compatibleCore: string }

function parseVersion(value: string): Version | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null
}
function compare(left: Version, right: Version) { return left.major - right.major || left.minor - right.minor || left.patch - right.patch }

export function checkCoreCompatibility(compatibleCore: string, coreVersion = GERARD_CORE_VERSION): CoreCompatibilityResult {
  const core = parseVersion(coreVersion)
  const caret = compatibleCore.startsWith('^')
  const requested = parseVersion(caret ? compatibleCore.slice(1) : compatibleCore)
  if (!core || !requested) return { compatible: false, status: 'INVALID_RANGE', coreVersion, compatibleCore }
  if (core.major !== requested.major) return { compatible: false, status: 'INCOMPATIBLE_MAJOR', coreVersion, compatibleCore }
  if (compare(core, requested) < 0) return { compatible: false, status: 'CORE_TOO_OLD', coreVersion, compatibleCore }
  const compatible = caret || compare(core, requested) === 0
  return { compatible, status: compatible ? 'COMPATIBLE' : 'INCOMPATIBLE_VERSION', coreVersion, compatibleCore }
}
