import {
  getWeekEndDate,
  getWeekStartDate,
  parseWeekStartParam,
} from './date-utils'
import { prisma } from '../prisma'
import { requireActiveOrganizationId } from '../auth/organization-context'

export type MissingDataItem = {
  missionId: string
  reference: string
  label: string
  field: string
}

export type ProfitabilityMission = {
  missionId: string
  reference: string
  clientName: string
  /**
   * Champs recopiés tels quels depuis la mission pour la recherche et le tri
   * de l'onglet Rentabilité. Ils n'entrent dans aucun calcul.
   */
  clientReference: string | null
  cmrNumber: string | null
  deliveryNoteNumber: string | null
  scheduledDate: string | null
  pickupCity: string
  deliveryCity: string
  driverId: string | null
  driverName: string | null
  truckId: string | null
  truckPlateNumber: string | null
  trailerId: string | null
  trailerPlateNumber: string | null
  revenue: number
  currency: string
  missionKm: number
  approachKm: number
  returnToBaseKm: number
  totalKm: number
  missionHours: number
  approachHours: number
  returnToBaseHours: number
  totalHours: number
  fuelCost: number
  driverHourlyCost: number
  driverCost: number
  operationalMargin: number
  marginRate: number | null
  missingFields: string[]
  optionalMissingFields: string[]
}

export type ProfitabilityGroup = {
  id: string
  label: string
  missionCount: number
  revenueTotal: number
  totalKm: number
  totalHours: number
  fuelCostTotal: number
  driverCostTotal: number
  operationalMarginTotal: number
  marginRate: number | null
}

export type ProfitabilityParameters = {
  fuelPricePerLiter: number
  defaultConsumptionL100: number
  defaultDriverHourlyCost: number
  currency: string
}

export type ProfitabilityResult = {
  parameters: ProfitabilityParameters
  summary: {
    revenueTotal: number
    fuelCostTotal: number
    driverCostTotal: number
    tollCostAmount: number
    operatingCostTotal: number
    grossProfitBeforeTolls: number
    netProfitAfterTolls: number
    marginBeforeTolls: number | null
    marginAfterTolls: number | null
    operationalMarginTotal: number
    marginRate: number | null
    totalKm: number
    missionKm: number
    approachKm: number
    returnToBaseKm: number
    totalHours: number
    missionHours: number
    approachHours: number
    returnToBaseHours: number
    missionCount: number
  }
  byMission: ProfitabilityMission[]
  byTruck: Array<ProfitabilityGroup & { truckId: string; plateNumber: string }>
  byDriver: Array<
    ProfitabilityGroup & {
      driverId: string
      name: string
      hourlyCostAmount: number | null
      hourlyCostCurrency: string
    }
  >
  byTrailer: Array<
    ProfitabilityGroup & { trailerId: string; plateNumber: string }
  >
  /**
   * Agrégat par client, construit avec le même `addGroupMission()` que les
   * autres dimensions : aucune formule spécifique.
   */
  byClient: Array<ProfitabilityGroup & { clientKey: string; name: string }>
  missingData: {
    critical: MissingDataItem[]
    optional: MissingDataItem[]
  }
}

export function getNumberParam(
  value: string | string[] | undefined,
  fallback: number
) {
  if (typeof value !== 'string') {
    return fallback
  }

  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) && parsedValue >= 0
    ? parsedValue
    : fallback
}

export function getBodyMoneyValue(value: unknown) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return 0
  }

  const normalizedValue =
    typeof value === 'string' ? value.replace(',', '.') : value
  const parsedValue = Number(normalizedValue)

  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : null
}

export function getRequestedWeekStartDate(
  queryValue: string | string[] | undefined
) {
  if (typeof queryValue === 'undefined') {
    return getWeekStartDate()
  }

  if (Array.isArray(queryValue)) {
    return null
  }

  return parseWeekStartParam(queryValue)
}

function metersToKm(value: number | null | undefined) {
  return typeof value === 'number' ? value / 1000 : 0
}

function secondsToHours(value: number | null | undefined) {
  return typeof value === 'number' ? value / 3600 : 0
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function roundMeasure(value: number) {
  return Math.round(value * 10) / 10
}

function getMarginRate(margin: number, revenue: number) {
  return revenue > 0 ? margin / revenue : null
}

export async function saveWeeklyProfitabilityAdjustment({
  tollCostAmount,
  weekStartDate,
}: {
  weekStartDate: Date
  tollCostAmount: number
}) {
  const organizationId = requireActiveOrganizationId()
  return prisma.weeklyProfitabilityAdjustment.upsert({
    where: {
      organizationId_weekStartDate: { organizationId, weekStartDate },
    },
    create: {
      weekStartDate,
      tollCostAmount,
    },
    update: {
      tollCostAmount,
    },
  })
}

function addMissing(
  target: MissingDataItem[],
  mission: { id: string; reference: string },
  field: string,
  label: string
) {
  target.push({
    missionId: mission.id,
    reference: mission.reference,
    field,
    label,
  })
}

function addGroupMission(
  groups: Map<string, ProfitabilityGroup>,
  id: string | null | undefined,
  label: string | null | undefined,
  mission: ProfitabilityMission
) {
  if (!id || !label) {
    return
  }

  const current = groups.get(id) ?? {
    id,
    label,
    missionCount: 0,
    revenueTotal: 0,
    totalKm: 0,
    totalHours: 0,
    fuelCostTotal: 0,
    driverCostTotal: 0,
    operationalMarginTotal: 0,
    marginRate: null,
  }

  current.missionCount += 1
  current.revenueTotal += mission.revenue
  current.totalKm += mission.totalKm
  current.totalHours += mission.totalHours
  current.fuelCostTotal += mission.fuelCost
  current.driverCostTotal += mission.driverCost
  current.operationalMarginTotal += mission.operationalMargin
  current.marginRate = getMarginRate(
    current.operationalMarginTotal,
    current.revenueTotal
  )
  groups.set(id, current)
}

function finalizeGroup(group: ProfitabilityGroup) {
  return {
    ...group,
    revenueTotal: roundMoney(group.revenueTotal),
    totalKm: roundMeasure(group.totalKm),
    totalHours: roundMeasure(group.totalHours),
    fuelCostTotal: roundMoney(group.fuelCostTotal),
    driverCostTotal: roundMoney(group.driverCostTotal),
    operationalMarginTotal: roundMoney(group.operationalMarginTotal),
  }
}

export async function computeWeeklyProfitability({
  defaultConsumptionL100,
  defaultDriverHourlyCost,
  fuelPricePerLiter,
  weekStartDate,
}: {
  weekStartDate: Date
  fuelPricePerLiter: number
  defaultConsumptionL100: number
  defaultDriverHourlyCost: number
}): Promise<ProfitabilityResult> {
  const [assignments, weeklyAdjustment] = await Promise.all([
    prisma.missionAssignment.findMany({
      where: {
        scheduledDate: {
          gte: weekStartDate,
          lte: getWeekEndDate(weekStartDate),
        },
      },
      orderBy: [
        {
          scheduledDate: 'asc',
        },
        {
          sortOrder: 'asc',
        },
      ],
      include: {
        mission: true,
        driver: true,
        truck: {
          include: {
            trailers: true,
          },
        },
        planningRow: {
          include: {
            trailer: true,
          },
        },
      },
    }),
    prisma.weeklyProfitabilityAdjustment.findFirst({
      where: {
        weekStartDate,
      },
    }),
  ])

  const missingCritical: MissingDataItem[] = []
  const missingOptional: MissingDataItem[] = []
  const byTruckGroups = new Map<string, ProfitabilityGroup>()
  const byDriverGroups = new Map<string, ProfitabilityGroup>()
  const byTrailerGroups = new Map<string, ProfitabilityGroup>()
  const byClientGroups = new Map<string, ProfitabilityGroup>()

  const byMission: ProfitabilityMission[] = assignments.map((assignment) => {
    const { mission } = assignment
    const driver = assignment.driver
    const truck = assignment.truck
    const trailer =
      assignment.planningRow?.trailer ?? assignment.truck?.trailers[0] ?? null
    const missingFields: string[] = []
    const optionalMissingFields: string[] = []

    if (typeof mission.priceAmount !== 'number') {
      missingFields.push('priceAmount')
      addMissing(missingCritical, mission, 'priceAmount', 'Prix mission absent')
    }

    if (typeof mission.routeDistanceMeters !== 'number') {
      missingFields.push('routeDistanceMeters')
      addMissing(
        missingCritical,
        mission,
        'routeDistanceMeters',
        'Distance mission absente'
      )
    }

    if (typeof mission.routeDurationSeconds !== 'number') {
      missingFields.push('routeDurationSeconds')
      addMissing(
        missingCritical,
        mission,
        'routeDurationSeconds',
        'Durée mission absente'
      )
    }

    if (!driver) {
      missingFields.push('driverId')
      addMissing(missingCritical, mission, 'driverId', 'Chauffeur absent')
    }

    if (!truck) {
      missingFields.push('truckId')
      addMissing(missingCritical, mission, 'truckId', 'Camion absent')
    }

    if (typeof assignment.approachDistanceMeters !== 'number') {
      missingFields.push('approachDistanceMeters')
      addMissing(
        missingCritical,
        mission,
        'approachDistanceMeters',
        'Approche camion absente'
      )
    }

    if (typeof truck?.returnToBaseDistanceMeters !== 'number') {
      optionalMissingFields.push('returnToBaseDistanceMeters')
      addMissing(
        missingOptional,
        mission,
        'returnToBaseDistanceMeters',
        'Retour base absent'
      )
    }

    if (typeof driver?.hourlyCostAmount !== 'number') {
      optionalMissingFields.push('driverHourlyCost')
      addMissing(
        missingOptional,
        mission,
        'driverHourlyCost',
        'Coût horaire chauffeur par défaut utilisé'
      )
    }

    if (!trailer) {
      optionalMissingFields.push('trailerId')
      addMissing(missingOptional, mission, 'trailerId', 'Remorque absente')
    }

    const missionKm = metersToKm(mission.routeDistanceMeters)
    const approachKm = metersToKm(assignment.approachDistanceMeters)
    const returnToBaseKm = metersToKm(truck?.returnToBaseDistanceMeters)
    const totalKm = missionKm + approachKm + returnToBaseKm
    const missionHours = secondsToHours(mission.routeDurationSeconds)
    const approachHours = secondsToHours(assignment.approachDurationSeconds)
    const returnToBaseHours = secondsToHours(truck?.returnToBaseDurationSeconds)
    const totalHours = missionHours + approachHours + returnToBaseHours
    const revenue = mission.priceAmount ?? 0
    const fuelCost =
      totalKm * (defaultConsumptionL100 / 100) * fuelPricePerLiter
    const driverHourlyCost = driver?.hourlyCostAmount ?? defaultDriverHourlyCost
    const driverCost = totalHours * driverHourlyCost
    const operationalMargin = revenue - fuelCost - driverCost

    const clientName = mission.clientName ?? 'Client à compléter'

    const item: ProfitabilityMission = {
      missionId: mission.id,
      reference: mission.reference,
      clientName,
      clientReference: mission.clientReference ?? null,
      cmrNumber: mission.cmrNumber ?? null,
      deliveryNoteNumber: mission.deliveryNoteNumber ?? null,
      scheduledDate: assignment.scheduledDate.toISOString(),
      pickupCity: mission.pickupCity ?? 'À compléter',
      deliveryCity: mission.deliveryCity ?? 'À compléter',
      driverId: driver?.id ?? null,
      driverName: driver?.name ?? null,
      truckId: truck?.id ?? null,
      truckPlateNumber: truck?.plateNumber ?? null,
      trailerId: trailer?.id ?? null,
      trailerPlateNumber: trailer?.plateNumber ?? null,
      revenue: roundMoney(revenue),
      currency: mission.priceCurrency ?? 'EUR',
      missionKm: roundMeasure(missionKm),
      approachKm: roundMeasure(approachKm),
      returnToBaseKm: roundMeasure(returnToBaseKm),
      totalKm: roundMeasure(totalKm),
      missionHours: roundMeasure(missionHours),
      approachHours: roundMeasure(approachHours),
      returnToBaseHours: roundMeasure(returnToBaseHours),
      totalHours: roundMeasure(totalHours),
      fuelCost: roundMoney(fuelCost),
      driverHourlyCost: roundMoney(driverHourlyCost),
      driverCost: roundMoney(driverCost),
      operationalMargin: roundMoney(operationalMargin),
      marginRate: getMarginRate(operationalMargin, revenue),
      missingFields,
      optionalMissingFields,
    }

    addGroupMission(byTruckGroups, truck?.id, truck?.plateNumber, item)
    addGroupMission(byDriverGroups, driver?.id, driver?.name, item)
    addGroupMission(byTrailerGroups, trailer?.id, trailer?.plateNumber, item)
    // La clé client est le nom lui-même : le schéma ne porte pas d'entité
    // Client, et en inventer une ici dépasserait le périmètre.
    addGroupMission(byClientGroups, clientName, clientName, item)

    return item
  })

  const summary = byMission.reduce(
    (totals, mission) => ({
      revenueTotal: totals.revenueTotal + mission.revenue,
      fuelCostTotal: totals.fuelCostTotal + mission.fuelCost,
      driverCostTotal: totals.driverCostTotal + mission.driverCost,
      operationalMarginTotal:
        totals.operationalMarginTotal + mission.operationalMargin,
      totalKm: totals.totalKm + mission.totalKm,
      missionKm: totals.missionKm + mission.missionKm,
      approachKm: totals.approachKm + mission.approachKm,
      returnToBaseKm: totals.returnToBaseKm + mission.returnToBaseKm,
      totalHours: totals.totalHours + mission.totalHours,
      missionHours: totals.missionHours + mission.missionHours,
      approachHours: totals.approachHours + mission.approachHours,
      returnToBaseHours: totals.returnToBaseHours + mission.returnToBaseHours,
      missionCount: totals.missionCount + 1,
    }),
    {
      revenueTotal: 0,
      fuelCostTotal: 0,
      driverCostTotal: 0,
      operationalMarginTotal: 0,
      totalKm: 0,
      missionKm: 0,
      approachKm: 0,
      returnToBaseKm: 0,
      totalHours: 0,
      missionHours: 0,
      approachHours: 0,
      returnToBaseHours: 0,
      missionCount: 0,
    }
  )

  const tollCostAmount = roundMoney(weeklyAdjustment?.tollCostAmount ?? 0)
  const grossProfitBeforeTolls = summary.operationalMarginTotal
  const netProfitAfterTolls = grossProfitBeforeTolls - tollCostAmount
  const operatingCostTotal =
    summary.fuelCostTotal + summary.driverCostTotal + tollCostAmount

  return {
    parameters: {
      fuelPricePerLiter,
      defaultConsumptionL100,
      defaultDriverHourlyCost,
      currency: 'EUR',
    },
    summary: {
      ...summary,
      revenueTotal: roundMoney(summary.revenueTotal),
      fuelCostTotal: roundMoney(summary.fuelCostTotal),
      driverCostTotal: roundMoney(summary.driverCostTotal),
      tollCostAmount,
      operatingCostTotal: roundMoney(operatingCostTotal),
      grossProfitBeforeTolls: roundMoney(grossProfitBeforeTolls),
      netProfitAfterTolls: roundMoney(netProfitAfterTolls),
      marginBeforeTolls: getMarginRate(
        grossProfitBeforeTolls,
        summary.revenueTotal
      ),
      marginAfterTolls: getMarginRate(
        netProfitAfterTolls,
        summary.revenueTotal
      ),
      operationalMarginTotal: roundMoney(summary.operationalMarginTotal),
      marginRate: getMarginRate(
        summary.operationalMarginTotal,
        summary.revenueTotal
      ),
      totalKm: roundMeasure(summary.totalKm),
      missionKm: roundMeasure(summary.missionKm),
      approachKm: roundMeasure(summary.approachKm),
      returnToBaseKm: roundMeasure(summary.returnToBaseKm),
      totalHours: roundMeasure(summary.totalHours),
      missionHours: roundMeasure(summary.missionHours),
      approachHours: roundMeasure(summary.approachHours),
      returnToBaseHours: roundMeasure(summary.returnToBaseHours),
    },
    byMission,
    byTruck: Array.from(byTruckGroups.values()).map((group) => ({
      ...finalizeGroup(group),
      truckId: group.id,
      plateNumber: group.label,
    })),
    byDriver: Array.from(byDriverGroups.values()).map((group) => {
      const driver = assignments.find(
        (assignment) => assignment.driver?.id === group.id
      )?.driver

      return {
        ...finalizeGroup(group),
        driverId: group.id,
        name: group.label,
        hourlyCostAmount: driver?.hourlyCostAmount ?? null,
        hourlyCostCurrency: driver?.hourlyCostCurrency ?? 'EUR',
      }
    }),
    byTrailer: Array.from(byTrailerGroups.values()).map((group) => ({
      ...finalizeGroup(group),
      trailerId: group.id,
      plateNumber: group.label,
    })),
    byClient: Array.from(byClientGroups.values()).map((group) => ({
      ...finalizeGroup(group),
      clientKey: group.id,
      name: group.label,
    })),
    missingData: {
      critical: missingCritical,
      optional: missingOptional,
    },
  }
}
