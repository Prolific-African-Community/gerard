function sanitizeReferenceInput(value: string) {
  const withoutQuery = value.trim().split(/[?#]/)[0] ?? ''
  const lastPathSegment =
    withoutQuery
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .pop() ?? withoutQuery
  const withoutExtension = lastPathSegment.replace(/\.[A-Z0-9]+$/i, '')

  return withoutExtension.toUpperCase().replace(/[^A-Z0-9-]/g, '-')
}

function getLastMeaningfulBlock(value: string) {
  const parts = value
    .split('-')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^\d{6,8}$/.test(part))

  return parts.at(-1) ?? null
}

function getFallbackReference(fallbackId?: string) {
  if (!fallbackId?.trim()) {
    return null
  }

  const normalizedFallback = fallbackId.toUpperCase().replace(/[^A-Z0-9]/g, '')

  if (!normalizedFallback) {
    return null
  }

  return `EXT-${normalizedFallback.slice(-6)}`
}

export function normalizeSlExternalInvoiceReference(
  value: string | null | undefined,
  fallbackId?: string
) {
  if (!value?.trim()) {
    return getFallbackReference(fallbackId)
  }

  const normalizedValue = sanitizeReferenceInput(value)

  if (!normalizedValue) {
    return getFallbackReference(fallbackId)
  }

  if (normalizedValue.startsWith('EXT-')) {
    const extBlock = getLastMeaningfulBlock(normalizedValue)
    return extBlock ? `EXT-${extBlock}` : getFallbackReference(fallbackId)
  }

  const referenceBlock = getLastMeaningfulBlock(normalizedValue)

  if (referenceBlock) {
    return `EXT-${referenceBlock}`
  }

  return getFallbackReference(fallbackId)
}
