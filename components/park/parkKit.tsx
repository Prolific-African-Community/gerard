'use client'

import type { ReactNode } from 'react'
import { ParkVehicleType } from '@prisma/client'

import type { ParkVehicleStatus } from '../../lib/park/types'

export type StatusMeta = {
  label: string
  /** Couleur du point / accent. */
  dot: string
  /** Classes du badge. */
  badge: string
  /** Couleur d'anneau autour d'un véhicule sur la carte. */
  ring: string
}

export const STATUS_META: Record<ParkVehicleStatus, StatusMeta> = {
  ON_PARK: {
    label: 'Positionné',
    dot: '#4d7c0f',
    badge: 'bg-lime-100 text-lime-900',
    ring: '#8eb800',
  },
  MAINTENANCE: {
    label: 'Maintenance à la Base',
    dot: '#b45309',
    badge: 'bg-amber-100 text-amber-900',
    ring: '#d97706',
  },
  TO_POSITION: {
    label: 'À positionner',
    dot: '#6b7280',
    badge: 'bg-zinc-200 text-zinc-700',
    ring: '#9ca3af',
  },
}

export function StatusBadge({ status }: { status: ParkVehicleStatus }) {
  const meta = STATUS_META[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${meta.badge}`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: meta.dot }}
      />
      {meta.label}
    </span>
  )
}

export function TruckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 32"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7h20v14H3z" />
      <path d="M23 12h9l5 6v3H23z" />
      <circle cx="12" cy="24" r="3.4" fill="currentColor" stroke="none" />
      <circle cx="31" cy="24" r="3.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function TrailerIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 32"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 6h34v15H5z" />
      <path d="M5 21h2M39 21v3" />
      <circle cx="15" cy="24" r="3.2" fill="currentColor" stroke="none" />
      <circle cx="24" cy="24" r="3.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function VehicleTypeIcon({
  type,
  className,
}: {
  type: ParkVehicleType
  className?: string
}) {
  return type === ParkVehicleType.TRUCK ? (
    <TruckIcon className={className} />
  ) : (
    <TrailerIcon className={className} />
  )
}

export function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8 7.2 20l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.3-2.3z" />
    </svg>
  )
}

export function InfoRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-black/[.06] py-2 last:border-0">
      <dt className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-[#8a9082]">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-right text-sm font-semibold text-[#171914]">
        {children}
      </dd>
    </div>
  )
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export const ACTION_LABELS: Record<string, string> = {
  PLACE: 'Placement',
  MOVE: 'Déplacement',
  REMOVE: 'Retrait',
}
