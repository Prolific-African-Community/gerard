'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  buildLocatorSelector,
  LOCATOR_HIGHLIGHT_MS,
  LOCATOR_RESOLVE_ATTEMPTS,
  LOCATOR_RESOLVE_INTERVAL_MS,
  locatorHighlightClassName,
} from '../../lib/dispatch/smart-search-navigation'
import type { LocatorTarget } from '../../lib/dispatch/smart-search-navigation'

type PendingHighlight = {
  target: LocatorTarget
  nonce: number
}

/**
 * Met brièvement en évidence la carte visée par la recherche.
 *
 * La cible peut ne pas être encore montée : changement de semaine, bascule
 * d'onglet du bandeau, rechargement de l'aperçu. On la sonde donc pendant
 * quelques instants au lieu de supposer qu'elle est déjà là. La classe est
 * purement visuelle et retirée automatiquement.
 */
export function useLocatorHighlight() {
  const [pending, setPending] = useState<PendingHighlight | null>(null)

  useEffect(() => {
    if (!pending) return
    if (typeof document === 'undefined') return

    const selector = buildLocatorSelector(pending.target)
    let attempts = 0
    let highlighted: HTMLElement | null = null
    let removalTimer: ReturnType<typeof setTimeout> | null = null

    const interval = setInterval(() => {
      attempts += 1
      const element = document.querySelector<HTMLElement>(selector)

      if (element) {
        clearInterval(interval)
        highlighted = element
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'center',
        })
        element.classList.add(locatorHighlightClassName)
        removalTimer = setTimeout(() => {
          element.classList.remove(locatorHighlightClassName)
          highlighted = null
        }, LOCATOR_HIGHLIGHT_MS)
        return
      }

      if (attempts >= LOCATOR_RESOLVE_ATTEMPTS) {
        clearInterval(interval)
      }
    }, LOCATOR_RESOLVE_INTERVAL_MS)

    return () => {
      clearInterval(interval)
      if (removalTimer) clearTimeout(removalTimer)
      highlighted?.classList.remove(locatorHighlightClassName)
    }
  }, [pending])

  const requestHighlight = useCallback((target: LocatorTarget) => {
    setPending((current) => ({
      target,
      nonce: (current?.nonce ?? 0) + 1,
    }))
  }, [])

  return { requestHighlight }
}
