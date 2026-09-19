'use client'

import type { ReactNode } from 'react'

import type { MissionImportPreview } from '../../../lib/mail/types'
import {
  formatAssignmentSummary,
  importStateLabels,
  importStateTone,
  summarizeAttention,
} from '../../../lib/mail/import-presentation'
import { resourceCardShellClassName } from '../ResourcePoolPrimitives'
import {
  ArrowUpRightIcon,
  CloseIcon,
  MailIcon,
  PencilIcon,
  UndoIcon,
} from './ImportIcons'

export type ImportCardProps = {
  item: MissionImportPreview
  isBusy?: boolean
  isEdited?: boolean
  canManage?: boolean
  /** Rendu tassé pour les vues de suivi (Créé, Assigné). */
  muted?: boolean
  onEdit: () => void
  onCreate: () => void
  onIgnore: () => void
  onRestore?: () => void
  onViewEmail: () => void
  onOpenMission?: (missionId: string) => void
  onOpenInPlanning?: (missionId: string) => void
}

function formatDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
  }).format(date)
}

function formatPrice(item: MissionImportPreview) {
  if (typeof item.priceAmount !== 'number') return null
  return `${item.priceAmount.toLocaleString('fr-FR')} ${item.priceCurrency ?? 'EUR'}`
}

function IconAction({
  label,
  onClick,
  children,
  tone = 'neutral',
}: {
  label: string
  onClick: () => void
  children: ReactNode
  tone?: 'neutral' | 'danger'
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={[
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.045] transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300',
        tone === 'danger'
          ? 'text-[#8a9085] hover:bg-red-50 hover:text-red-600'
          : 'text-[#62685e] hover:bg-lime-100 hover:text-[#283700]',
      ].join(' ')}
      style={{ border: 0 }}
    >
      {children}
    </button>
  )
}

function LinkButton({
  children,
  onClick,
  className,
}: {
  children: ReactNode
  onClick: () => void
  className: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={['underline underline-offset-2', className].join(' ')}
      style={{
        border: 0,
        background: 'none',
        padding: 0,
        font: 'inherit',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

export function ImportCard({
  item,
  isBusy = false,
  isEdited = false,
  canManage = true,
  muted = false,
  onEdit,
  onCreate,
  onIgnore,
  onRestore,
  onViewEmail,
  onOpenMission,
  onOpenInPlanning,
}: ImportCardProps) {
  const state = item.importState ?? 'NEW'
  const tone = importStateTone[state]
  const attention = summarizeAttention(item)
  const assignmentLabel = formatAssignmentSummary(item)
  const price = formatPrice(item)
  const pickupDate = formatDate(item.pickupDate)
  const missionId = item.missionId ?? item.createdMissionId ?? null
  const isTracking = state === 'CREATED' || state === 'ASSIGNED'

  return (
    <article
      className={[
        resourceCardShellClassName,
        'flex w-full overflow-hidden',
        muted ? 'border-black/[0.07] bg-white/70' : 'border-black/10 bg-white',
      ].join(' ')}
    >
      {/* Ligne latérale : l'état se lit avant toute lecture de texte. */}
      <span
        className={['w-[3px] shrink-0', tone.rail].join(' ')}
        aria-hidden="true"
      />

      <div
        className={[
          'min-w-0 flex-1',
          muted ? 'px-3 py-2' : 'px-3 py-2.5',
        ].join(' ')}
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 basis-[200px]">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p className="min-w-0 break-all text-[12px] font-black uppercase tracking-[0.06em] text-[#171814]">
                {item.reference}
              </p>
              <span
                className={[
                  'shrink-0 rounded-full border px-1.5 py-[1px] text-[9px] font-bold leading-[1.4]',
                  tone.badge,
                ].join(' ')}
              >
                {importStateLabels[state]}
              </span>
              {item.ignored ? (
                <span className="shrink-0 rounded-full border border-black/10 bg-[#f4f5f1] px-1.5 py-[1px] text-[9px] font-bold leading-[1.4] text-[#7a8074]">
                  Ignoré
                </span>
              ) : null}
              {isEdited ? (
                <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.1em] text-[#8a9085]">
                  Modifié
                </span>
              ) : null}
            </div>

            <p className="mt-[3px] break-words text-[11px] font-semibold leading-tight text-[#3d4238]">
              {item.clientName || 'Client à qualifier'}
            </p>
            <p className="mt-[2px] break-words text-[11px] font-medium leading-tight text-[#5f655b]">
              {item.pickupCity || 'Chargement ?'}{' '}
              <span className="text-[#9aa090]">-&gt;</span>{' '}
              {item.deliveryCity || 'Livraison ?'}
              {pickupDate ? (
                <span className="text-[#8a9085]"> · {pickupDate}</span>
              ) : null}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <IconAction label="Voir l'e-mail source" onClick={onViewEmail}>
              <MailIcon />
            </IconAction>

            {item.ignored ? (
              canManage && onRestore ? (
                <IconAction label="Restaurer l'import" onClick={onRestore}>
                  <UndoIcon />
                </IconAction>
              ) : null
            ) : isTracking ? (
              missionId && onOpenMission ? (
                <IconAction
                  label="Ouvrir la mission"
                  onClick={() => onOpenMission(missionId)}
                >
                  <ArrowUpRightIcon />
                </IconAction>
              ) : null
            ) : canManage ? (
              <>
                <IconAction label="Modifier l'import" onClick={onEdit}>
                  <PencilIcon />
                </IconAction>
                <IconAction
                  label="Ignorer l'import"
                  onClick={onIgnore}
                  tone="danger"
                >
                  <CloseIcon />
                </IconAction>
                <button
                  type="button"
                  onClick={onCreate}
                  disabled={isBusy}
                  className="h-7 shrink-0 rounded-full bg-[#11130f] px-2.5 text-[10px] font-bold text-white shadow-[0_6px_16px_rgba(17,18,15,0.14)] transition hover:bg-[#B9FF4A] hover:text-[#11130F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 disabled:cursor-not-allowed disabled:bg-black/20"
                  style={{ border: 0 }}
                >
                  {isBusy
                    ? 'Création…'
                    : attention
                      ? 'Créer quand même'
                      : 'Créer la mission'}
                </button>
              </>
            ) : null}
          </div>
        </div>

        {/* Ligne de contexte : uniquement ce qui aide à décider. */}
        {!item.ignored &&
        (attention || price || item.requiredTruckType || isTracking) ? (
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-tight">
            {attention && !isTracking ? (
              <span className="font-semibold text-amber-700">{attention}</span>
            ) : null}

            {state === 'CREATED' && missionId ? (
              <>
                <span className="font-semibold text-[#49630b]">
                  Mission créée ·{' '}
                  <LinkButton
                    onClick={() => onOpenMission?.(missionId)}
                    className="hover:text-[#2f3f06]"
                  >
                    {item.missionReference ?? item.reference}
                  </LinkButton>
                </span>
                <span className="text-[#8a9085]">En attente d’affectation</span>
                {onOpenInPlanning ? (
                  <LinkButton
                    onClick={() => onOpenInPlanning(missionId)}
                    className="font-semibold text-[#4f5549] hover:text-[#11130f]"
                  >
                    Voir dans le Planning
                  </LinkButton>
                ) : null}
              </>
            ) : null}

            {state === 'ASSIGNED' ? (
              <span className="font-semibold text-emerald-700">
                Assignée{assignmentLabel ? ` · ${assignmentLabel}` : ''}
              </span>
            ) : null}

            {!isTracking && price ? (
              <span className="text-[#62665c]">{price}</span>
            ) : null}
            {!isTracking && item.requiredTruckType ? (
              <span className="text-[#8a9085]">{item.requiredTruckType}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}
