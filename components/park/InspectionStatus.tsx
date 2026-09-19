import type { ParkInspectionOverallResult } from '@prisma/client'
import type { ParkInspectionSummaryDTO } from '../../lib/park/inspection-types'

export const inspectionOverallLabels: Record<ParkInspectionOverallResult, string> = {
  COMPLIANT: 'Conforme',
  WATCH: 'À surveiller',
  INTERVENTION_REQUIRED: 'Intervention requise',
}

export function inspectionOverallClass(result: ParkInspectionOverallResult) {
  if (result === 'INTERVENTION_REQUIRED') return 'bg-red-100 text-red-800'
  if (result === 'WATCH') return 'bg-amber-100 text-amber-900'
  return 'bg-lime-100 text-lime-900'
}

export function InspectionSummaryBadge({
  summary,
  compact = false,
}: {
  summary: ParkInspectionSummaryDTO | null | undefined
  compact?: boolean
}) {
  const result = summary?.lastInspection?.overallResult
  if (!result) {
    return compact ? null : (
      <span className="text-[10px] font-semibold text-[#8a9082]">Jamais contrôlé</span>
    )
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-black ${inspectionOverallClass(result)} ${
        compact ? 'px-1.5 py-0.5 text-[7px]' : 'px-2 py-1 text-[10px]'
      }`}
    >
      {inspectionOverallLabels[result]}
      {summary.criticalAnomalyCount ? ` · ${summary.criticalAnomalyCount}` : ''}
    </span>
  )
}

export function InspectionIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3h6v1.5M8.5 10l1.5 1.5 3-3M8.5 16l1.5 1.5 3-3M15 10h1.5M15 16h1.5" />
    </svg>
  )
}
