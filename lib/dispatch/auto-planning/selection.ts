import type {
  DispatchOptimizationResult,
  PairProposal,
  ProposedMission,
} from '../optimization'

export class AutoPlanningSelectionError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export type SelectedAutoPlanningItem = {
  proposal: PairProposal
  mission: ProposedMission
}

export function validateAutoPlanningSelection(
  result: DispatchOptimizationResult,
  selectedMissionIds: string[],
  confirmedConditionalMissionIds: string[] = [],
  adjustedMissionIds: string[] = []
): SelectedAutoPlanningItem[] {
  if (
    selectedMissionIds.length === 0 ||
    new Set(selectedMissionIds).size !== selectedMissionIds.length
  ) {
    throw new AutoPlanningSelectionError(
      'INVALID_SELECTION',
      'La sélection est vide ou contient une mission en double.'
    )
  }

  const confirmedByMissionId = new Map<string, SelectedAutoPlanningItem>()
  const conditionalByMissionId = new Map<string, SelectedAutoPlanningItem>()
  for (const proposal of result.confirmedProposals) {
    for (const mission of proposal.missions) {
      if (confirmedByMissionId.has(mission.missionId)) {
        throw new AutoPlanningSelectionError(
          'DUPLICATE_PROPOSAL',
          'Une mission confirmée apparaît dans plusieurs propositions.'
        )
      }
      confirmedByMissionId.set(mission.missionId, { proposal, mission })
    }
  }
  for (const proposal of result.conditionalProposals) {
    for (const mission of proposal.missions) {
      if (
        confirmedByMissionId.has(mission.missionId) ||
        conditionalByMissionId.has(mission.missionId)
      ) {
        throw new AutoPlanningSelectionError(
          'DUPLICATE_PROPOSAL',
          'Une mission apparaît dans plusieurs propositions.'
        )
      }
      conditionalByMissionId.set(mission.missionId, { proposal, mission })
    }
  }
  const confirmedConditionalSet = new Set(confirmedConditionalMissionIds)
  const adjustedMissionSet = new Set(adjustedMissionIds)
  if (
    confirmedConditionalSet.size !== confirmedConditionalMissionIds.length ||
    confirmedConditionalMissionIds.some(
      (missionId) => !conditionalByMissionId.has(missionId)
    )
  ) {
    throw new AutoPlanningSelectionError(
      'INVALID_CONDITIONAL_CONFIRMATION',
      'La confirmation conditionnelle est invalide.'
    )
  }

  for (const missionId of selectedMissionIds) {
    if (
      !confirmedByMissionId.has(missionId) &&
      !(
        conditionalByMissionId.has(missionId) &&
        (confirmedConditionalSet.has(missionId) ||
          adjustedMissionSet.has(missionId))
      )
    ) {
      throw new AutoPlanningSelectionError(
        'CONDITIONAL_OR_UNKNOWN_SELECTION',
        'Une proposition conditionnelle ou inconnue ne peut pas être appliquée.'
      )
    }
  }

  const selectedSet = new Set(selectedMissionIds)
  for (const proposal of result.confirmedProposals) {
    const selectedCount = proposal.missions.filter((mission) =>
      selectedSet.has(mission.missionId)
    ).length
    if (selectedCount > 0 && selectedCount !== proposal.missions.length) {
      throw new AutoPlanningSelectionError(
        'SEQUENCE_DEPENDENCY',
        'Une séquence dépendante doit être appliquée entièrement.'
      )
    }
  }
  for (const proposal of result.conditionalProposals) {
    const selectedCount = proposal.missions.filter((mission) =>
      selectedSet.has(mission.missionId)
    ).length
    if (selectedCount > 0 && selectedCount !== proposal.missions.length) {
      throw new AutoPlanningSelectionError(
        'SEQUENCE_DEPENDENCY',
        'Une séquence conditionnelle doit être confirmée entièrement.'
      )
    }
  }

  return selectedMissionIds.map(
    (missionId) =>
      (confirmedByMissionId.get(missionId) ??
        conditionalByMissionId.get(missionId)) as SelectedAutoPlanningItem
  )
}
