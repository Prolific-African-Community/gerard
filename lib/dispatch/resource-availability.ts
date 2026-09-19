export type ResourceOccupation = {
  missionId: string
  driverId: string | null
  truckId: string | null
  trailerId: string | null
  startsAt: string | Date
  endsAt: string | Date | null
}

export type ResourceConflictKind = 'DRIVER' | 'TRUCK' | 'TRAILER'

export type ResourceConflict = {
  proposedMissionId: string
  occupiedMissionId: string
  kinds: ResourceConflictKind[]
  availabilityUnknown: boolean
}

function date(value: string | Date) {
  return value instanceof Date ? value : new Date(value)
}

export function sharedResourceKinds(
  left: ResourceOccupation,
  right: ResourceOccupation
) {
  const kinds: ResourceConflictKind[] = []
  if (left.driverId && left.driverId === right.driverId) kinds.push('DRIVER')
  if (left.truckId && left.truckId === right.truckId) kinds.push('TRUCK')
  if (left.trailerId && left.trailerId === right.trailerId) kinds.push('TRAILER')
  return kinds
}

export function findResourceOccupationConflicts(input: {
  proposed: ResourceOccupation[]
  occupied: ResourceOccupation[]
}) {
  const conflicts: ResourceConflict[] = []
  for (const proposed of input.proposed) {
    const proposedStart = date(proposed.startsAt)
    const proposedEnd = proposed.endsAt ? date(proposed.endsAt) : null
    if (!proposedEnd) continue
    for (const occupied of input.occupied) {
      if (proposed.missionId === occupied.missionId) continue
      const kinds = sharedResourceKinds(proposed, occupied)
      if (!kinds.length) continue
      const occupiedStart = date(occupied.startsAt)
      const occupiedEnd = occupied.endsAt ? date(occupied.endsAt) : null
      const overlap = occupiedEnd
        ? proposedStart < occupiedEnd && occupiedStart < proposedEnd
        : occupiedStart < proposedEnd
      if (!overlap) continue
      conflicts.push({
        proposedMissionId: proposed.missionId,
        occupiedMissionId: occupied.missionId,
        kinds,
        availabilityUnknown: occupiedEnd === null,
      })
    }
  }
  return conflicts
}
