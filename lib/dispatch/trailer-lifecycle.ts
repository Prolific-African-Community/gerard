export type TrailerRemovalFacts = {
  attachedTruckPlate?: string | null
  activeMissionReferences: string[]
  activeMaintenanceCount: number
  activePlanningCount: number
  historicalAssignmentCount: number
  custodyEventCount: number
  maintenanceCount: number
  inspectionCount: number
  movementCount: number
  missionEventCount: number
  historicalPlanningCount: number
}

export type TrailerRemovalDecision =
  | { action: 'BLOCK'; reason: string }
  | { action: 'DELETE'; reason: null }

export function decideTrailerRemoval(
  facts: TrailerRemovalFacts
): TrailerRemovalDecision {
  if (facts.attachedTruckPlate) {
    return {
      action: 'BLOCK',
      reason: `Impossible de supprimer : cette remorque est attelée au camion ${facts.attachedTruckPlate}.`,
    }
  }
  if (facts.activeMissionReferences.length) {
    return {
      action: 'BLOCK',
      reason: `Impossible de supprimer : cette remorque est liée à ${
        facts.activeMissionReferences.length
      } mission(s) active(s) (${facts.activeMissionReferences.join(', ')}).`,
    }
  }
  if (facts.activePlanningCount > 0) {
    return {
      action: 'BLOCK',
      reason: `Impossible de supprimer : cette remorque est utilisée par ${facts.activePlanningCount} ligne(s) de planning active(s).`,
    }
  }
  if (facts.activeMaintenanceCount > 0) {
    return {
      action: 'BLOCK',
      reason: `Impossible de supprimer : cette remorque possède ${facts.activeMaintenanceCount} intervention(s) de maintenance active(s).`,
    }
  }
  // Historical references do not keep an explicitly deleted fleet resource
  // alive. The API preserves the business records and removes/detaches only
  // their nullable trailer link.
  return { action: 'DELETE', reason: null }
}

/** Detach durable history and remove trailer-only history in one transaction. */
export async function hardDeleteTrailer(tx: Prisma.TransactionClient, trailerId: string) {
  await tx.parkSpot.updateMany({ where: { trailerId }, data: { trailerId: null, occupiedAt: null, placedById: null } })
  await tx.planningRow.updateMany({ where: { trailerId }, data: { trailerId: null } })
  await tx.missionAssignment.updateMany({ where: { trailerId }, data: { trailerId: null, trailerChangePlanned: false } })
  await tx.missionEvent.updateMany({ where: { trailerId }, data: { trailerId: null } })
  await tx.maintenanceRequest.updateMany({ where: { trailerId }, data: { trailerId: null } })
  await tx.parkInspection.updateMany({ where: { trailerId }, data: { trailerId: null } })
  await tx.parkMovement.updateMany({ where: { trailerId }, data: { trailerId: null } })
  await tx.trailerCustodyEvent.deleteMany({ where: { trailerId } })
  await tx.trailer.delete({ where: { id: trailerId } })
}
import type { Prisma } from '@prisma/client'
