import { MissionPreparationStatus } from '@prisma/client'

import { getWeekEndDate } from '../date-utils'
import { prepareMission } from '../mission-preparation/service'
import { ensurePlanningRowsForWeek } from '../planning-rows'
import { prisma } from '../../prisma'
import { classifyPlanningMissions } from './mission-scope'

export async function prepareAutoPlanningWeek(input: {
  weekStartDate: Date
  includeExistingForced: boolean
}) {
  const planningRows = await ensurePlanningRowsForWeek(input.weekStartDate)
  const missions = await prisma.mission.findMany({
    orderBy: [{ pickupDate: 'asc' }, { id: 'asc' }],
    include: {
      assignment: {
        select: { scheduledDate: true, plannedEndAt: true },
      },
    },
  })
  const scope = classifyPlanningMissions({
    missions,
    periodStart: input.weekStartDate,
    periodEnd: getWeekEndDate(input.weekStartDate),
    includeExistingForced: input.includeExistingForced,
  })
  const included = new Set(scope.includedMissionIds)
  const toPrepare = missions.filter(
    (mission) =>
      included.has(mission.id) &&
      mission.preparationStatus !== MissionPreparationStatus.READY
  )
  let missionsPrepared = 0
  let missionsRequiringReview = 0
  let preparationFailures = 0

  for (const mission of toPrepare) {
    try {
      const prepared = await prepareMission(mission.id)
      if (prepared.preparationStatus === MissionPreparationStatus.READY) {
        missionsPrepared += 1
      } else if (
        prepared.preparationStatus === MissionPreparationStatus.REVIEW_REQUIRED
      ) {
        missionsRequiringReview += 1
      } else {
        preparationFailures += 1
      }
    } catch {
      preparationFailures += 1
    }
  }

  return {
    planningRowsCreated: planningRows.createdRowCount,
    missionsPrepared,
    missionsRequiringReview,
    preparationFailures,
  }
}
