import {
  MaintenanceInterventionType,
  MaintenanceRequestStatus,
  MaintenanceUrgency,
  ParkInspectionItemStatus,
  ParkInspectionOverallResult,
  ParkInspectionStatus,
  ParkVehicleType,
  Prisma,
} from '@prisma/client'

import { actorName } from './actor'
import {
  inspectionTemplate,
  inspectionTemplateItemMap,
  isPressureItemKey,
} from './inspection-template'
import type {
  ParkInspectionDTO,
  ParkInspectionInput,
  ParkInspectionResultInput,
  ParkInspectionSummaryDTO,
} from './inspection-types'
import { prisma } from '../prisma'

const inspectionInclude = Prisma.validator<Prisma.ParkInspectionInclude>()({
  truck: { select: { id: true, plateNumber: true } },
  trailer: { select: { id: true, plateNumber: true } },
  results: { orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] },
})

type InspectionWithRelations = Prisma.ParkInspectionGetPayload<{
  include: typeof inspectionInclude
}>

export class ParkInspectionError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message)
    this.name = 'ParkInspectionError'
  }
}

function cleanOptionalText(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new ParkInspectionError('Texte invalide.', 400)
  const normalized = value.trim()
  if (normalized.length > maxLength) {
    throw new ParkInspectionError(`Le texte est limité à ${maxLength} caractères.`, 400)
  }
  return normalized || null
}

function parseInspectedAt(value: unknown) {
  if (typeof value !== 'string') {
    throw new ParkInspectionError('Date de contrôle invalide.', 400)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new ParkInspectionError('Date de contrôle invalide.', 400)
  }
  const minimum = new Date('2000-01-01T00:00:00.000Z')
  const maximum = new Date(Date.now() + 24 * 60 * 60 * 1000)
  if (date < minimum || date > maximum) {
    throw new ParkInspectionError('La date de contrôle est hors limites.', 400)
  }
  return date
}

function normalizeMileage(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 10_000_000) {
    throw new ParkInspectionError('Kilométrage invalide.', 400)
  }
  return value as number
}

function normalizeResult(
  result: ParkInspectionResultInput,
  vehicleType: ParkVehicleType,
  index: number
) {
  if (!result || typeof result !== 'object') {
    throw new ParkInspectionError('Résultat de contrôle invalide.', 400)
  }
  if (!Object.values(ParkInspectionItemStatus).includes(result.status)) {
    throw new ParkInspectionError('Statut de contrôle invalide.', 400)
  }
  if (typeof result.itemKey !== 'string' || result.itemKey.length > 100) {
    throw new ParkInspectionError('Élément de contrôle invalide.', 400)
  }
  const templateItem = inspectionTemplateItemMap(vehicleType).get(result.itemKey)
  const pressure = isPressureItemKey(result.itemKey)
  if (!templateItem && !pressure) {
    throw new ParkInspectionError(`Élément inconnu : ${result.itemKey}.`, 400)
  }

  let numericValue: number | null = null
  let unit: string | null = null
  if (pressure) {
    if (
      typeof result.numericValue !== 'number' ||
      !Number.isFinite(result.numericValue) ||
      result.numericValue < 0.1 ||
      result.numericValue > 20
    ) {
      throw new ParkInspectionError('La pression doit être comprise entre 0,1 et 20 bar.', 400)
    }
    numericValue = Math.round(result.numericValue * 10) / 10
    unit = 'bar'
  } else if (result.numericValue !== undefined && result.numericValue !== null) {
    throw new ParkInspectionError('Valeur numérique inattendue.', 400)
  }

  const category = templateItem?.category ?? 'TIRES'
  const label = templateItem?.label ?? cleanOptionalText(result.label, 80)
  if (!label) throw new ParkInspectionError('Libellé de mesure requis.', 400)

  return {
    category,
    itemKey: result.itemKey,
    label,
    status: result.status,
    numericValue,
    unit,
    comment: cleanOptionalText(result.comment, 1000),
    sortOrder: pressure ? 100 + index : templateItem?.sortOrder ?? index,
  }
}

export function parseInspectionInput(body: unknown): ParkInspectionInput {
  if (!body || typeof body !== 'object') {
    throw new ParkInspectionError('Requête invalide.', 400)
  }
  const input = body as Record<string, unknown>
  if (!Object.values(ParkVehicleType).includes(input.vehicleType as ParkVehicleType)) {
    throw new ParkInspectionError('Type de véhicule invalide.', 400)
  }
  if (typeof input.vehicleId !== 'string' || !input.vehicleId.trim()) {
    throw new ParkInspectionError('Véhicule requis.', 400)
  }
  if (!Array.isArray(input.results) || input.results.length > 80) {
    throw new ParkInspectionError('Résultats de contrôle invalides.', 400)
  }
  const vehicleType = input.vehicleType as ParkVehicleType
  const results = input.results.map((result, index) =>
    normalizeResult(result as ParkInspectionResultInput, vehicleType, index)
  )
  if (new Set(results.map((result) => result.itemKey)).size !== results.length) {
    throw new ParkInspectionError('Un élément de contrôle est présent plusieurs fois.', 400)
  }
  return {
    vehicleType,
    vehicleId: input.vehicleId.trim(),
    inspectedAt: parseInspectedAt(input.inspectedAt).toISOString(),
    mileage: normalizeMileage(input.mileage),
    generalComment: cleanOptionalText(input.generalComment, 2000),
    results,
  }
}

async function validateVehicle(vehicleType: ParkVehicleType, vehicleId: string) {
  if (vehicleType === ParkVehicleType.TRUCK) {
    const truck = await prisma.truck.findUnique({
      where: { id: vehicleId },
      select: { id: true, plateNumber: true },
    })
    if (!truck) throw new ParkInspectionError('Camion introuvable.', 404)
    return { truckId: truck.id, trailerId: null, plateNumber: truck.plateNumber }
  }
  const trailer = await prisma.trailer.findUnique({
    where: { id: vehicleId },
    select: { id: true, plateNumber: true },
  })
  if (!trailer) throw new ParkInspectionError('Remorque introuvable.', 404)
  return { truckId: null, trailerId: trailer.id, plateNumber: trailer.plateNumber }
}

function resultCreateData(results: ParkInspectionInput['results']) {
  return results.map((result) => ({
    category: result.category,
    itemKey: result.itemKey,
    label: result.label ?? result.itemKey,
    status: result.status,
    numericValue: result.numericValue ?? null,
    unit: result.unit ?? null,
    comment: result.comment ?? null,
    sortOrder: result.sortOrder ?? 0,
  }))
}

export function serializeInspection(inspection: InspectionWithRelations): ParkInspectionDTO {
  const vehicle = inspection.truck ?? inspection.trailer
  if (!vehicle) throw new ParkInspectionError('Véhicule du contrôle introuvable.', 409)
  return {
    id: inspection.id,
    vehicleType: inspection.vehicleType,
    vehicleId: vehicle.id,
    plateNumber: vehicle.plateNumber,
    inspectedAt: inspection.inspectedAt.toISOString(),
    inspectorName: inspection.inspectorName,
    status: inspection.status,
    overallResult: inspection.overallResult,
    mileage: inspection.mileage,
    generalComment: inspection.generalComment,
    finalizedAt: inspection.finalizedAt?.toISOString() ?? null,
    createdAt: inspection.createdAt.toISOString(),
    updatedAt: inspection.updatedAt.toISOString(),
    results: inspection.results.map((result) => ({
      id: result.id,
      category: result.category,
      itemKey: result.itemKey,
      label: result.label,
      status: result.status,
      numericValue: result.numericValue,
      unit: result.unit,
      comment: result.comment,
      sortOrder: result.sortOrder,
      maintenanceRequestId: result.maintenanceRequestId,
    })),
  }
}

export async function createInspectionDraft(
  input: ParkInspectionInput,
  user: { id: string; firstName: string; lastName: string; username: string }
) {
  const vehicle = await validateVehicle(input.vehicleType, input.vehicleId)
  const existingDraft = await prisma.parkInspection.findFirst({
    where: {
      status: ParkInspectionStatus.DRAFT,
      ...(input.vehicleType === ParkVehicleType.TRUCK
        ? { truckId: input.vehicleId }
        : { trailerId: input.vehicleId }),
    },
    include: inspectionInclude,
  })
  if (existingDraft) {
    throw new ParkInspectionError('Un brouillon existe déjà pour ce véhicule.', 409)
  }
  const created = await prisma.parkInspection.create({
    data: {
      vehicleType: input.vehicleType,
      truckId: vehicle.truckId,
      trailerId: vehicle.trailerId,
      inspectedAt: new Date(input.inspectedAt),
      inspectorId: user.id,
      inspectorName: actorName(user),
      mileage: input.mileage ?? null,
      generalComment: input.generalComment ?? null,
      results: { create: resultCreateData(input.results) },
    },
    include: inspectionInclude,
  })
  return serializeInspection(created)
}

export async function updateInspectionDraft(id: string, input: ParkInspectionInput) {
  const current = await prisma.parkInspection.findUnique({ where: { id } })
  if (!current) throw new ParkInspectionError('Contrôle introuvable.', 404)
  if (current.status !== ParkInspectionStatus.DRAFT) {
    throw new ParkInspectionError('Un contrôle finalisé ne peut plus être modifié.', 409)
  }
  const currentVehicleId = current.truckId ?? current.trailerId
  if (current.vehicleType !== input.vehicleType || currentVehicleId !== input.vehicleId) {
    throw new ParkInspectionError('Le véhicule d’un brouillon ne peut pas être remplacé.', 409)
  }
  const updated = await prisma.$transaction(async (tx) => {
    await tx.parkInspectionResult.deleteMany({ where: { inspectionId: id } })
    return tx.parkInspection.update({
      where: { id },
      data: {
        inspectedAt: new Date(input.inspectedAt),
        mileage: input.mileage ?? null,
        generalComment: input.generalComment ?? null,
        results: { create: resultCreateData(input.results) },
      },
      include: inspectionInclude,
    })
  })
  return serializeInspection(updated)
}

function computeOverallResult(statuses: ParkInspectionItemStatus[]) {
  if (statuses.includes(ParkInspectionItemStatus.CRITICAL)) {
    return ParkInspectionOverallResult.INTERVENTION_REQUIRED
  }
  if (statuses.includes(ParkInspectionItemStatus.WATCH)) {
    return ParkInspectionOverallResult.WATCH
  }
  return ParkInspectionOverallResult.COMPLIANT
}

export async function finalizeInspection(id: string) {
  const current = await prisma.parkInspection.findUnique({
    where: { id },
    include: inspectionInclude,
  })
  if (!current) throw new ParkInspectionError('Contrôle introuvable.', 404)
  if (current.status !== ParkInspectionStatus.DRAFT) {
    throw new ParkInspectionError('Ce contrôle est déjà finalisé.', 409)
  }
  const requiredKeys = inspectionTemplate(current.vehicleType)
    .flatMap((section) => section.items)
    .filter((item) => item.required)
    .map((item) => item.key)
  const completedKeys = new Set(current.results.map((result) => result.itemKey))
  const missing = requiredKeys.filter((key) => !completedKeys.has(key))
  if (missing.length) {
    throw new ParkInspectionError(`Checklist incomplète : ${missing.length} élément(s) restant(s).`, 409)
  }
  const overallResult = computeOverallResult(
    current.results.map((result) => result.status)
  )
  const finalized = await prisma.parkInspection.update({
    where: { id },
    data: {
      status: ParkInspectionStatus.FINALIZED,
      overallResult,
      finalizedAt: new Date(),
    },
    include: inspectionInclude,
  })
  return serializeInspection(finalized)
}

export async function getInspection(id: string) {
  const inspection = await prisma.parkInspection.findUnique({
    where: { id },
    include: inspectionInclude,
  })
  if (!inspection) throw new ParkInspectionError('Contrôle introuvable.', 404)
  return serializeInspection(inspection)
}

type InspectionFilters = {
  vehicleType?: ParkVehicleType
  vehicleId?: string
  status?: ParkInspectionStatus
  overallResult?: ParkInspectionOverallResult
  from?: Date
  to?: Date
  limit?: number
}

export async function listInspections(filters: InspectionFilters) {
  const inspections = await prisma.parkInspection.findMany({
    where: {
      vehicleType: filters.vehicleType,
      status: filters.status,
      overallResult: filters.overallResult,
      ...(filters.vehicleId
        ? filters.vehicleType === ParkVehicleType.TRAILER
          ? { trailerId: filters.vehicleId }
          : { truckId: filters.vehicleId }
        : {}),
      inspectedAt:
        filters.from || filters.to
          ? { gte: filters.from, lte: filters.to }
          : undefined,
    },
    orderBy: { inspectedAt: 'desc' },
    take: Math.min(Math.max(filters.limit ?? 50, 1), 100),
    include: inspectionInclude,
  })
  return inspections.map(serializeInspection)
}

export async function listInspectionSummaries(): Promise<ParkInspectionSummaryDTO[]> {
  const inspections = await prisma.parkInspection.findMany({
    orderBy: [{ inspectedAt: 'desc' }, { createdAt: 'desc' }],
    include: inspectionInclude,
  })
  const summaries = new Map<string, ParkInspectionSummaryDTO>()
  for (const inspection of inspections) {
    const serialized = serializeInspection(inspection)
    const key = `${serialized.vehicleType}:${serialized.vehicleId}`
    const current = summaries.get(key) ?? {
      vehicleType: serialized.vehicleType,
      vehicleId: serialized.vehicleId,
      plateNumber: serialized.plateNumber,
      lastInspection: null,
      draftInspectionId: null,
      openAnomalyCount: 0,
      criticalAnomalyCount: 0,
    }
    if (serialized.status === ParkInspectionStatus.DRAFT && !current.draftInspectionId) {
      current.draftInspectionId = serialized.id
    }
    if (serialized.status === ParkInspectionStatus.FINALIZED && !current.lastInspection) {
      current.lastInspection = serialized
      const openAnomalies = serialized.results.filter(
        (result) =>
          (result.status === ParkInspectionItemStatus.WATCH ||
            result.status === ParkInspectionItemStatus.CRITICAL) &&
          !result.maintenanceRequestId
      )
      current.openAnomalyCount = openAnomalies.length
      current.criticalAnomalyCount = openAnomalies.filter(
        (result) => result.status === ParkInspectionItemStatus.CRITICAL
      ).length
    }
    summaries.set(key, current)
  }
  return Array.from(summaries.values())
}

function maintenanceTypeForCategory(category: string) {
  const mapping: Record<string, MaintenanceInterventionType> = {
    TIRES: MaintenanceInterventionType.TIRES,
    BRAKES: MaintenanceInterventionType.BRAKES,
    LIGHTS: MaintenanceInterventionType.ELECTRICAL,
    BODY_SAFETY: MaintenanceInterventionType.BODYWORK,
    COUPLING: MaintenanceInterventionType.SAFETY_CHECK,
    TRUCK_SPECIFIC: MaintenanceInterventionType.DIAGNOSTIC,
    TRAILER_SPECIFIC: MaintenanceInterventionType.TRAILER_REPAIR,
  }
  return mapping[category] ?? MaintenanceInterventionType.OTHER
}

export async function createMaintenanceFromAnomaly(
  inspectionId: string,
  resultId: string
) {
  const inspection = await prisma.parkInspection.findUnique({
    where: { id: inspectionId },
    include: inspectionInclude,
  })
  if (!inspection) throw new ParkInspectionError('Contrôle introuvable.', 404)
  if (inspection.status !== ParkInspectionStatus.FINALIZED) {
    throw new ParkInspectionError('Finalisez le contrôle avant de créer une maintenance.', 409)
  }
  const result = inspection.results.find((item) => item.id === resultId)
  if (!result) throw new ParkInspectionError('Anomalie introuvable.', 404)
  if (
    result.status !== ParkInspectionItemStatus.WATCH &&
    result.status !== ParkInspectionItemStatus.CRITICAL
  ) {
    throw new ParkInspectionError('Cet élément ne constitue pas une anomalie.', 409)
  }
  if (result.maintenanceRequestId) {
    throw new ParkInspectionError('Une demande existe déjà pour cette anomalie.', 409)
  }
  const vehicle = inspection.truck ?? inspection.trailer
  if (!vehicle) throw new ParkInspectionError('Véhicule introuvable.', 409)
  const issueDescription = `${result.label} — ${result.comment ?? (result.status === ParkInspectionItemStatus.CRITICAL ? 'Anomalie critique' : 'Élément à surveiller')}`
  const maintenanceRequest = await prisma.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.create({
      data: {
        truckId: inspection.truckId,
        trailerId: inspection.trailerId,
        vehicleType:
          inspection.vehicleType === ParkVehicleType.TRUCK ? 'TRUCK' : 'TRAILER',
        plateNumber: vehicle.plateNumber,
        interventionType: maintenanceTypeForCategory(result.category),
        urgency:
          result.status === ParkInspectionItemStatus.CRITICAL
            ? MaintenanceUrgency.CRITICAL
            : MaintenanceUrgency.HIGH,
        status: MaintenanceRequestStatus.DRAFT,
        mileage: inspection.mileage,
        immobilizationRequired:
          result.status === ParkInspectionItemStatus.CRITICAL,
        issueDescription,
        internalNotes: `Issue du contrôle Parc ${inspection.id} du ${inspection.inspectedAt.toLocaleString('fr-FR')}.`,
      },
    })
    await tx.maintenanceStatusHistory.create({
      data: {
        maintenanceRequestId: request.id,
        oldStatus: null,
        newStatus: MaintenanceRequestStatus.DRAFT,
        comment: `Créée depuis le contrôle Parc ${inspection.id}`,
      },
    })
    await tx.parkInspectionResult.update({
      where: { id: result.id },
      data: { maintenanceRequestId: request.id },
    })
    return request
  })
  return { id: maintenanceRequest.id, status: maintenanceRequest.status }
}
