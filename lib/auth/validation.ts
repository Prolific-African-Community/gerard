import { UserRole } from '@prisma/client'

export const userRoles = Object.values(UserRole)

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && userRoles.includes(value as UserRole)
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase()
}

export function usernameError(value: string) {
  if (!value) return 'Le username est requis.'
  if (value.length > 80) return 'Le username est trop long.'
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value)) {
    return 'Le username accepte uniquement les lettres minuscules, chiffres, points, tirets et underscores, sans espace ni @.'
  }
  return null
}

export function passwordError(value: string) {
  if (value.length < 12) return 'Le mot de passe doit contenir au moins 12 caractères.'
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    return 'Le mot de passe doit contenir une minuscule, une majuscule, un chiffre et un symbole.'
  }
  return null
}
