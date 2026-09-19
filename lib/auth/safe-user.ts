import { Prisma } from '@prisma/client'

export const safeUserSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  firstName: true,
  lastName: true,
  name: true,
  username: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  passwordChangedAt: true,
  temporaryPasswordIssuedAt: true,
  createdAt: true,
  updatedAt: true,
  driverId: true,
})
