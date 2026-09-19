'use client'

import type { ReactNode } from 'react'

export const resourceCardShellClassName = [
  'relative touch-none rounded-lg border text-left',
  'shadow-[0_1px_8px_rgba(17,18,15,0.045)] transition',
  'hover:shadow-[0_8px_24px_rgba(17,18,15,0.07)]',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300',
].join(' ')

export const defaultResourceCardAppearanceClassName =
  'border-black/10 bg-white/95'

export type ResourcePoolOption<Value extends string> = {
  value: Value
  label: string
  shortLabel: string
  count: number
  icon: ReactNode
}

export function ResourcePoolControlPanel<Value extends string>({
  title,
  options,
  activeValue,
  onChange,
  instruction,
  footer,
  highlighted = false,
  responsive = false,
}: {
  title: string
  options: ReadonlyArray<ResourcePoolOption<Value>>
  activeValue: Value
  onChange: (value: Value) => void
  instruction?: string
  footer?: ReactNode
  highlighted?: boolean
  responsive?: boolean
}) {
  return (
    <aside
      className={[
        'relative shrink-0 overflow-hidden rounded-[36px] px-5 py-4 sm:px-7 sm:py-4',
        responsive ? 'w-full lg:w-[520px]' : 'w-[520px]',
        'bg-[#F4F5F1] shadow-[0_28px_90px_rgba(17,18,15,0.10)] backdrop-blur-3xl',
        'transition-all duration-300',
        highlighted
          ? 'bg-[#F7FAEF] shadow-[0_30px_100px_rgba(185,255,74,0.18)]'
          : '',
      ].join(' ')}
    >
      <div className="pointer-events-none absolute -right-20 -top-24 h-48 w-48 rounded-full bg-[#B9FF4A]/18 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-8 h-48 w-48 rounded-full bg-white/10 blur-3xl" />

      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#B9FF4A] shadow-[0_0_18px_rgba(185,255,74,0.6)]" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#777D72]">
            {title}
          </p>
        </div>

        <div className="mt-4 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-[26px] bg-white p-1.5 shadow-[0_18px_55px_rgba(17,18,15,0.08)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {options.map((option) => {
            const isActive = activeValue === option.value
            return (
              <button
                key={option.value}
                type="button"
                style={{ border: 0 }}
                aria-label={option.label}
                aria-pressed={isActive}
                onClick={() => onChange(option.value)}
                className={[
                  'group relative flex h-[48px] appearance-none items-center gap-2.5 overflow-visible rounded-[21px] !border-0 text-[14px] font-semibold tracking-[-0.015em] outline-none ring-0 transition-all duration-300 ease-out',
                  'w-[58px] shrink-0 px-2 hover:w-[154px] hover:px-4 hover:pr-5',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9FF4A]/70',
                  isActive
                    ? 'bg-[#11130F] text-white shadow-[0_16px_36px_rgba(17,18,15,0.16)]'
                    : 'bg-transparent text-[#687064] hover:bg-white/80 hover:text-[#11130F] hover:shadow-[0_12px_28px_rgba(17,18,15,0.06)]',
                ].join(' ')}
              >
                <span
                  className={[
                    'absolute -right-2 -top-2 flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold shadow-[0_8px_18px_rgba(17,18,15,0.10)] transition-all duration-300',
                    isActive
                      ? 'bg-[#B9FF4A] text-[#11130F]'
                      : 'bg-white text-[#5f665b] group-hover:bg-[#B9FF4A]/50 group-hover:text-[#11130F]',
                  ].join(' ')}
                >
                  {option.count}
                </span>
                <span
                  className={[
                    'flex h-8 w-8 items-center justify-center rounded-[16px] transition-all duration-300',
                    isActive
                      ? 'bg-[#B9FF4A] text-[#11130F]'
                      : 'bg-black/[0.045] text-[#687064] group-hover:bg-[#B9FF4A]/35 group-hover:text-[#11130F]',
                  ].join(' ')}
                >
                  {option.icon}
                </span>
                <span className="max-w-0 whitespace-nowrap opacity-0 transition-all duration-300 group-hover:max-w-[96px] group-hover:opacity-100">
                  {option.shortLabel}
                </span>
              </button>
            )
          })}
        </div>

        {instruction ? (
          <p className="mt-4 text-[11px] font-semibold leading-relaxed text-[#747a6f]">
            {instruction}
          </p>
        ) : null}
        {footer ? <div className="mt-3">{footer}</div> : null}
      </div>
    </aside>
  )
}

export function HorizontalResourceRail({
  title,
  count,
  search,
  children,
  emptyLabel,
}: {
  title: string
  count: number
  search?: ReactNode
  children: ReactNode
  emptyLabel?: string
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex min-h-10 flex-wrap items-center gap-3 pl-1 pt-1 sm:pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#777D72]">
          {title}
        </p>
        <span className="rounded-full bg-[#F4F5F1] px-2.5 py-1 text-[11px] font-bold text-[#4f5549]">
          {count}
        </span>
        {search ? <div className="ml-auto w-full sm:w-auto">{search}</div> : null}
      </div>

      {count > 0 ? (
        <div className="dispatch-pool-scrollbar overscroll-x-contain pb-5">
          <div className="flex min-h-[132px] w-max items-start gap-4 pr-12">
            {children}
          </div>
        </div>
      ) : (
        <div className="flex h-[112px] min-w-0 items-center justify-center rounded-[26px] bg-[#F4F5F1]/80 px-5 text-center text-sm font-semibold text-[#777D72] shadow-[0_18px_50px_rgba(17,18,15,0.06)] backdrop-blur-xl">
          {emptyLabel ?? 'Aucune ressource disponible.'}
        </div>
      )}
    </div>
  )
}
