const truckCategoryAliases: Record<string, string> = {
  bache: 'CURTAINSIDER',
  'bache covered truck': 'CURTAINSIDER',
  curtainsider: 'CURTAINSIDER',
  tautliner: 'CURTAINSIDER',
  plateau: 'FLATBED',
  flatbed: 'FLATBED',
  fourgon: 'BOX',
  box: 'BOX',
  frigorifique: 'REFRIGERATED',
  refrigerated: 'REFRIGERATED',
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function normalizeTruckCategory(value: string | null | undefined) {
  if (!value) return null
  const normalized = normalize(value)
  return truckCategoryAliases[normalized] ?? value.trim().toUpperCase()
}
