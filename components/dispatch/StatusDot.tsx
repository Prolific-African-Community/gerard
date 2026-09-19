import type { VehicleDisplayPulseColor } from '../../lib/dispatch/maintenance-display'

const solidColorClass: Record<VehicleDisplayPulseColor, string> = {
  red: 'bg-red-500',
  orange: 'bg-amber-400',
  green: 'bg-emerald-500',
  gray: 'bg-zinc-300',
}

const pingColorClass: Record<VehicleDisplayPulseColor, string> = {
  red: 'bg-red-400',
  orange: 'bg-amber-300',
  green: 'bg-emerald-400',
  gray: 'bg-zinc-300',
}

const glowClass: Record<VehicleDisplayPulseColor, string> = {
  red: 'shadow-[0_0_7px_1px_rgba(239,68,68,0.65)]',
  orange: 'shadow-[0_0_7px_1px_rgba(251,191,36,0.6)]',
  green: 'shadow-[0_0_7px_1px_rgba(16,185,129,0.55)]',
  gray: 'shadow-[0_0_4px_0_rgba(161,161,170,0.45)]',
}

type StatusDotProps = {
  color: VehicleDisplayPulseColor
  pulsing?: boolean
  className?: string
}

/**
 * Luminous operational status dot.
 *
 * - red / orange: blinking (animate-ping halo) for immobilized, active
 *   intervention and pending maintenance.
 * - green / gray: static with a soft glow for available / neutral states.
 */
export function StatusDot({
  color,
  pulsing = false,
  className = '',
}: StatusDotProps) {
  return (
    <span
      className={['relative flex h-3 w-3 shrink-0', className].join(' ')}
      aria-hidden="true"
    >
      {pulsing ? (
        <span
          className={[
            'absolute inline-flex h-full w-full rounded-full opacity-70 animate-ping',
            pingColorClass[color],
          ].join(' ')}
        />
      ) : null}
      <span
        className={[
          'relative inline-flex h-3 w-3 rounded-full',
          solidColorClass[color],
          glowClass[color],
        ].join(' ')}
      />
    </span>
  )
}
