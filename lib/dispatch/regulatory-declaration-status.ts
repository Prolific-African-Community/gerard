/**
 * Classification de l'état réglementaire d'un chauffeur, à partir de sa
 * déclaration la plus récente. Séparée de la route API pour être testable sans
 * base de données (correctif fonctionnel §5 et §13).
 *
 *  - ABSENT     : aucune déclaration ;
 *  - VALID      : déclaration effective (référence passée) et non expirée ;
 *  - EXPIRED    : déclaration dont la validité est dépassée à la date de référence ;
 *  - INCOMPLETE : déclaration existante mais non encore effective (référence future).
 *
 * On ne transforme jamais un état inconnu (ABSENT) en état valide, et une
 * déclaration expirée reste affichée comme expirée (§12).
 */
export type RegulatoryDeclarationStatus =
  | 'ABSENT'
  | 'VALID'
  | 'EXPIRED'
  | 'INCOMPLETE'

export function classifyRegulatoryDeclaration(
  declaration: { referenceAt: Date; validUntil: Date | null } | null,
  at: Date
): RegulatoryDeclarationStatus {
  if (!declaration) return 'ABSENT'
  if (declaration.referenceAt.getTime() > at.getTime()) return 'INCOMPLETE'
  if (
    declaration.validUntil &&
    declaration.validUntil.getTime() < at.getTime()
  ) {
    return 'EXPIRED'
  }
  return 'VALID'
}

export const regulatoryDeclarationStatusLabels: Record<
  RegulatoryDeclarationStatus,
  string
> = {
  ABSENT: 'Non renseigné',
  VALID: 'Valide',
  EXPIRED: 'Expiré',
  INCOMPLETE: 'Action requise',
}
