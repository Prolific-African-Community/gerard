'use client'

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export function PencilIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg {...base} className={className}>
      <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z" />
    </svg>
  )
}

export function CheckIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 12.5 9.5 17.5 19.5 7" />
    </svg>
  )
}

export function CloseIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg {...base} className={className}>
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  )
}

export function ArrowUpRightIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg {...base} className={className}>
      <path d="M7 17 17 7M8.5 7H17v8.5" />
    </svg>
  )
}

export function MailIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 6.5h17v11h-17z" />
      <path d="m3.5 7.5 8.5 6 8.5-6" />
    </svg>
  )
}

export function SearchIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg {...base} className={className}>
      <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
    </svg>
  )
}

export function RefreshIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg {...base} className={className}>
      <path d="M20 11a8 8 0 1 0-.6 4" />
      <path d="M20 5v6h-6" />
    </svg>
  )
}

export function UndoIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg {...base} className={className}>
      <path d="M4 9h10a5 5 0 0 1 0 10h-3" />
      <path d="M8 5 4 9l4 4" />
    </svg>
  )
}
