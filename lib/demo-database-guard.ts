const GERARD_DEMO_ID = 'gerard-demo'

/**
 * Demo scripts must use the URL returned here. Deliberately do not fall back to
 * DATABASE_URL: a demo-data command must opt in to its target explicitly.
 */
export function requireGerardDemoDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (environment.GERARD_DEMO_DATABASE_ID !== GERARD_DEMO_ID) {
    throw new Error(
      `Refus d'executer le script de demo : GERARD_DEMO_DATABASE_ID doit valoir "${GERARD_DEMO_ID}".`,
    )
  }

  const rawUrl = environment.GERARD_DEMO_DATABASE_URL?.trim()
  if (!rawUrl) {
    throw new Error(
      "Refus d'executer le script de demo : GERARD_DEMO_DATABASE_URL est obligatoire (aucun fallback vers DATABASE_URL).",
    )
  }

  const expectedHost = environment.GERARD_DEMO_DATABASE_HOST?.trim().toLowerCase()
  if (!expectedHost) {
    throw new Error(
      "Refus d'executer le script de demo : GERARD_DEMO_DATABASE_HOST est obligatoire.",
    )
  }

  let databaseUrl: URL
  try {
    databaseUrl = new URL(rawUrl)
  } catch {
    throw new Error(
      "Refus d'executer le script de demo : GERARD_DEMO_DATABASE_URL est invalide.",
    )
  }

  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error(
      "Refus d'executer le script de demo : seule une URL PostgreSQL explicite est acceptee.",
    )
  }

  if (databaseUrl.hostname.toLowerCase() !== expectedHost) {
    throw new Error(
      "Refus d'executer le script de demo : l'hote de GERARD_DEMO_DATABASE_URL ne correspond pas a GERARD_DEMO_DATABASE_HOST.",
    )
  }

  if (!databaseUrl.pathname || databaseUrl.pathname === '/') {
    throw new Error(
      "Refus d'executer le script de demo : le nom de la base PostgreSQL est obligatoire.",
    )
  }

  return rawUrl
}
