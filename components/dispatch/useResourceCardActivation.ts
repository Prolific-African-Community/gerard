import type { KeyboardEvent, MouseEvent } from 'react'
import { useCallback, useEffect, useRef } from 'react'

export function shouldActivateResourceCard(input: {
  isDragging: boolean
  suppressClick: boolean
  hasAction: boolean
}) {
  return input.hasAction && !input.isDragging && !input.suppressClick
}

/**
 * Empêche le clic synthétique émis après un drag d'ouvrir une fiche.
 * Le délai court couvre la séquence pointerup/click sans pénaliser le clic
 * volontaire suivant.
 */
export function useResourceCardActivation<T>(
  item: T | undefined,
  isDragging: boolean,
  onActivate?: (item: T) => void
) {
  const suppressClickRef = useRef(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    if (isDragging) {
      suppressClickRef.current = true
      return
    }
    if (suppressClickRef.current) {
      resetTimerRef.current = setTimeout(() => {
        suppressClickRef.current = false
      }, 250)
    }
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [isDragging])

  const activate = useCallback(() => {
    if (
      !shouldActivateResourceCard({
        isDragging,
        suppressClick: suppressClickRef.current,
        hasAction: Boolean(onActivate && typeof item !== 'undefined'),
      })
    ) {
      return
    }
    if (typeof item !== 'undefined') onActivate?.(item)
  }, [isDragging, item, onActivate])

  const onClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (event.defaultPrevented) return
      activate()
    },
    [activate]
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      activate()
    },
    [activate]
  )

  return { onClick, onKeyDown }
}
