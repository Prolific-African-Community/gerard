import type {
  ParkInspectionItemStatus,
  ParkInspectionOverallResult,
  ParkInspectionStatus,
  ParkVehicleType,
} from '@prisma/client'

export type ParkInspectionResultDTO = {
  id: string
  category: string
  itemKey: string
  label: string
  status: ParkInspectionItemStatus
  numericValue: number | null
  unit: string | null
  comment: string | null
  sortOrder: number
  maintenanceRequestId: string | null
}

export type ParkInspectionDTO = {
  id: string
  vehicleType: ParkVehicleType
  vehicleId: string
  plateNumber: string
  inspectedAt: string
  inspectorName: string
  status: ParkInspectionStatus
  overallResult: ParkInspectionOverallResult | null
  mileage: number | null
  generalComment: string | null
  finalizedAt: string | null
  createdAt: string
  updatedAt: string
  results: ParkInspectionResultDTO[]
}

export type ParkInspectionSummaryDTO = {
  vehicleType: ParkVehicleType
  vehicleId: string
  plateNumber: string
  lastInspection: ParkInspectionDTO | null
  draftInspectionId: string | null
  openAnomalyCount: number
  criticalAnomalyCount: number
}

export type ParkInspectionResultInput = {
  category: string
  itemKey: string
  label?: string
  status: ParkInspectionItemStatus
  numericValue?: number | null
  unit?: string | null
  comment?: string | null
  sortOrder?: number
}

export type ParkInspectionInput = {
  vehicleType: ParkVehicleType
  vehicleId: string
  inspectedAt: string
  mileage?: number | null
  generalComment?: string | null
  results: ParkInspectionResultInput[]
}
