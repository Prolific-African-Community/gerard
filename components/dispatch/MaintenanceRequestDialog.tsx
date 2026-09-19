'use client'

import { VehicleMaintenanceSection } from './VehicleMaintenanceSection'

export type MaintenanceTarget = {
  id: string
  type: 'TRUCK' | 'TRAILER'
  label: string
}

export function MaintenanceRequestDialog({
  target,
  onClose,
  onUpdated,
}: {
  target: MaintenanceTarget | null
  onClose: () => void
  onUpdated?: () => Promise<void> | void
}) {
  if (!target) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Maintenance ${target.label}`}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[30px] bg-white p-5 shadow-2xl sm:rounded-[30px] sm:p-7"
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#7a8074]">
              Maintenance
            </p>
            <h2 className="mt-1 text-xl font-semibold text-[#11130f]">{target.label}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="h-11 w-11 rounded-full border-0 bg-black/[.05] text-xl text-[#11130f]"
          >
            ×
          </button>
        </div>
        <VehicleMaintenanceSection
          vehicleId={target.id}
          vehicleType={target.type}
          plateNumber={target.label}
          onMaintenanceUpdated={onUpdated}
        />
      </section>
    </div>
  )
}
