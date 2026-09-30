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
  | { action: 'ARCHIVE'; reason: string }
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
  const history =
    facts.historicalAssignmentCount +
    facts.custodyEventCount +
    facts.maintenanceCount +
    facts.inspectionCount +
    facts.movementCount +
    facts.missionEventCount +
    facts.historicalPlanningCount
  if (history > 0) {
    return {
      action: 'ARCHIVE',
      reason: `Remorque retirée du parc actif : ${history} relation(s) historique(s) ont été conservées.`,
    }
  }
  return { action: 'DELETE', reason: null }
}
