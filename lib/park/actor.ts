type ActorUser = {
  firstName: string
  lastName: string
  username: string
}

/** Nom lisible d'un acteur pour l'historique des mouvements. */
export function actorName(user: ActorUser): string {
  const full = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
  return full || user.username
}
