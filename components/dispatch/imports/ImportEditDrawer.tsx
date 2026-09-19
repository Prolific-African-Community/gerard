'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'

import type { EditableMissionImport } from '../../../lib/mail/editable-import'
import {
  editMissionImportField,
  normalizeMissionReference,
  recalculateImportMissingFields,
} from '../../../lib/mail/editable-import'
import type { MissionImportPreview } from '../../../lib/mail/types'
import {
  attentionReasonLabels,
  getMissingFieldLabel,
  summarizeAttention,
} from '../../../lib/mail/import-presentation'
import { normalizeConfidenceRatio } from '../../../lib/mail/import-preview-state'

type ImportEditDrawerProps = {
  item: EditableMissionImport
  isSaving?: boolean
  onClose: () => void
  onSave: (next: EditableMissionImport) => void
  onSaveAndCreate: (next: EditableMissionImport) => void
  onViewEmail: () => void
}

function toDateTimeLocal(value: string | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#8b9186]">
        {label}
      </span>
      <div className="mt-1">{children}</div>
      {hint ? (
        <span className="mt-1 block text-[9px] font-semibold text-[#a0a69a]">
          {hint}
        </span>
      ) : null}
    </label>
  )
}

export function ImportEditDrawer({
  item,
  isSaving = false,
  onClose,
  onSave,
  onSaveAndCreate,
  onViewEmail,
}: ImportEditDrawerProps) {
  const [draft, setDraft] = useState<EditableMissionImport>(item)
  const [showSecondary, setShowSecondary] = useState(false)
  const [showTechnical, setShowTechnical] = useState(false)

  const attention = useMemo(() => summarizeAttention(draft), [draft])
  const confidencePct = Math.round(
    normalizeConfidenceRatio(draft.confidence ?? 0) * 100,
  )

  function update<Field extends keyof MissionImportPreview>(
    field: Field,
    value: MissionImportPreview[Field],
  ) {
    setDraft((current) => editMissionImportField(current, field, value))
  }

  function normalized() {
    return recalculateImportMissingFields(
      editMissionImportField(
        draft,
        'reference',
        normalizeMissionReference(draft.reference),
      ),
    )
  }

  const inputClass = (field: string) =>
    [
      'w-full rounded-xl bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#252821] outline-none transition',
      'border focus:border-lime-400 focus:ring-4 focus:ring-lime-100',
      field in draft.editedFields
        ? 'border-lime-400 bg-lime-50/40'
        : 'border-black/10',
    ].join(' ')

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:px-5">
      <button
        type="button"
        aria-label="Fermer l’édition"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/20"
        style={{ border: 0 }}
      />

      <div className="relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-black/10 bg-white shadow-[0_24px_80px_rgba(17,18,15,0.18)] sm:max-h-[88vh] sm:max-w-[720px] sm:rounded-[28px]">
        <header className="flex items-start justify-between gap-4 border-b border-black/[0.07] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#8b9186]">
              Import · édition
            </p>
            <h3 className="mt-1 break-all text-lg font-semibold tracking-tight text-[#11130f]">
              {draft.reference || 'Référence à définir'}
            </h3>
            {attention ? (
              <p className="mt-1 text-[11px] font-semibold text-amber-700">
                {attention}
              </p>
            ) : (
              <p className="mt-1 text-[11px] font-semibold text-[#49630b]">
                Prêt à créer
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#565c51] transition hover:border-lime-300 hover:text-[#405c08]"
          >
            Fermer
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Référence">
              <input
                value={draft.reference ?? ''}
                onChange={(event) => update('reference', event.target.value)}
                className={inputClass('reference')}
              />
            </Field>
            <Field label="Client">
              <input
                value={draft.clientName ?? ''}
                onChange={(event) => update('clientName', event.target.value)}
                className={inputClass('clientName')}
              />
            </Field>
            <Field label="Ville de chargement">
              <input
                value={draft.pickupCity ?? ''}
                onChange={(event) => update('pickupCity', event.target.value)}
                className={inputClass('pickupCity')}
              />
            </Field>
            <Field label="Ville de livraison">
              <input
                value={draft.deliveryCity ?? ''}
                onChange={(event) => update('deliveryCity', event.target.value)}
                className={inputClass('deliveryCity')}
              />
            </Field>
            <Field label="Date de chargement">
              <input
                type="datetime-local"
                value={toDateTimeLocal(draft.pickupDate)}
                onChange={(event) =>
                  update(
                    'pickupDate',
                    event.target.value
                      ? new Date(event.target.value).toISOString()
                      : undefined,
                  )
                }
                className={inputClass('pickupDate')}
              />
            </Field>
            <Field label="Date de livraison">
              <input
                type="datetime-local"
                value={toDateTimeLocal(draft.deliveryDate)}
                onChange={(event) =>
                  update(
                    'deliveryDate',
                    event.target.value
                      ? new Date(event.target.value).toISOString()
                      : undefined,
                  )
                }
                className={inputClass('deliveryDate')}
              />
            </Field>
            <Field label="Adresse de chargement">
              <input
                value={draft.pickupAddress ?? ''}
                onChange={(event) => update('pickupAddress', event.target.value)}
                className={inputClass('pickupAddress')}
              />
            </Field>
            <Field label="Adresse de livraison">
              <input
                value={draft.deliveryAddress ?? ''}
                onChange={(event) =>
                  update('deliveryAddress', event.target.value)
                }
                className={inputClass('deliveryAddress')}
              />
            </Field>
            <Field label="Prix">
              <div className="grid grid-cols-[1fr_72px] gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.priceAmount ?? ''}
                  onChange={(event) =>
                    update(
                      'priceAmount',
                      event.target.value === ''
                        ? undefined
                        : Number(event.target.value),
                    )
                  }
                  className={inputClass('priceAmount')}
                />
                <input
                  value={draft.priceCurrency ?? 'EUR'}
                  onChange={(event) =>
                    update('priceCurrency', event.target.value)
                  }
                  className={inputClass('priceCurrency')}
                />
              </div>
            </Field>
            <Field label="Camion requis">
              <input
                value={draft.requiredTruckType ?? ''}
                onChange={(event) =>
                  update('requiredTruckType', event.target.value)
                }
                className={inputClass('requiredTruckType')}
              />
            </Field>
            <Field label="Remorque requise">
              <input
                value={draft.requiredTrailerType ?? ''}
                onChange={(event) =>
                  update('requiredTrailerType', event.target.value)
                }
                className={inputClass('requiredTrailerType')}
              />
            </Field>
            <Field label="Référence client">
              <input
                value={draft.clientReference ?? ''}
                onChange={(event) =>
                  update('clientReference', event.target.value)
                }
                className={inputClass('clientReference')}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes">
                <textarea
                  rows={2}
                  value={draft.notes ?? ''}
                  onChange={(event) => update('notes', event.target.value)}
                  className={inputClass('notes')}
                />
              </Field>
            </div>
          </div>

          {(draft.missingFields?.length ?? 0) > 0 ? (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[10px] font-semibold leading-relaxed text-amber-800">
              À compléter :{' '}
              {(draft.missingFields ?? [])
                .map((field) => getMissingFieldLabel(field))
                .join(' · ')}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3 border-t border-black/[0.07] pt-3">
            <button
              type="button"
              onClick={() => setShowSecondary((value) => !value)}
              className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7a8074] underline underline-offset-2"
              style={{ border: 0, background: 'none', padding: 0 }}
            >
              {showSecondary ? 'Masquer les contacts' : 'Contacts et conditions'}
            </button>
            <button
              type="button"
              onClick={() => setShowTechnical((value) => !value)}
              className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7a8074] underline underline-offset-2"
              style={{ border: 0, background: 'none', padding: 0 }}
            >
              {showTechnical ? 'Masquer le détail parsing' : 'Détail parsing'}
            </button>
          </div>

          {showSecondary ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Contact chargement">
                <input
                  value={draft.pickupContact ?? ''}
                  onChange={(event) =>
                    update('pickupContact', event.target.value)
                  }
                  className={inputClass('pickupContact')}
                />
              </Field>
              <Field label="Téléphone chargement">
                <input
                  value={draft.pickupPhone ?? ''}
                  onChange={(event) => update('pickupPhone', event.target.value)}
                  className={inputClass('pickupPhone')}
                />
              </Field>
              <Field label="Contact livraison">
                <input
                  value={draft.deliveryContact ?? ''}
                  onChange={(event) =>
                    update('deliveryContact', event.target.value)
                  }
                  className={inputClass('deliveryContact')}
                />
              </Field>
              <Field label="Téléphone livraison">
                <input
                  value={draft.deliveryPhone ?? ''}
                  onChange={(event) =>
                    update('deliveryPhone', event.target.value)
                  }
                  className={inputClass('deliveryPhone')}
                />
              </Field>
              <Field label="Conditions de paiement">
                <input
                  value={draft.paymentTerms ?? ''}
                  onChange={(event) => update('paymentTerms', event.target.value)}
                  className={inputClass('paymentTerms')}
                />
              </Field>
              <Field label="Numéro CMR">
                <input
                  value={draft.cmrNumber ?? ''}
                  onChange={(event) => update('cmrNumber', event.target.value)}
                  className={inputClass('cmrNumber')}
                />
              </Field>
              <Field label="Bon de livraison">
                <input
                  value={draft.deliveryNoteNumber ?? ''}
                  onChange={(event) =>
                    update('deliveryNoteNumber', event.target.value)
                  }
                  className={inputClass('deliveryNoteNumber')}
                />
              </Field>
            </div>
          ) : null}

          {showTechnical ? (
            <div className="mt-3 rounded-2xl bg-[#f7f8f4] px-3 py-3">
              <dl className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <dt className="font-bold uppercase tracking-[0.12em] text-[#8b9186]">
                    Parser
                  </dt>
                  <dd className="mt-0.5 break-words font-semibold text-[#3d4238]">
                    {(draft.parserChain ?? [draft.parserId]).join(' → ')}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold uppercase tracking-[0.12em] text-[#8b9186]">
                    Confiance
                  </dt>
                  <dd className="mt-0.5 font-semibold text-[#3d4238]">
                    {confidencePct}%
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="font-bold uppercase tracking-[0.12em] text-[#8b9186]">
                    Sujet du mail
                  </dt>
                  <dd className="mt-0.5 break-words font-semibold text-[#3d4238]">
                    {draft.sourceEmailSubject}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="font-bold uppercase tracking-[0.12em] text-[#8b9186]">
                    Expéditeur
                  </dt>
                  <dd className="mt-0.5 break-words font-semibold text-[#3d4238]">
                    {draft.sourceEmailFrom}
                  </dd>
                </div>
                {(draft.attentionReasons?.length ?? 0) > 0 ? (
                  <div className="col-span-2">
                    <dt className="font-bold uppercase tracking-[0.12em] text-[#8b9186]">
                      Avertissements
                    </dt>
                    <dd className="mt-0.5 font-semibold text-amber-700">
                      {(draft.attentionReasons ?? [])
                        .map((reason) => attentionReasonLabels[reason])
                        .join(' · ')}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <button
                type="button"
                onClick={onViewEmail}
                className="mt-3 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[10px] font-semibold text-[#565c51] transition hover:border-lime-300 hover:text-[#405c08]"
              >
                Ouvrir l’e-mail source
              </button>
            </div>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-black/[0.07] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-[11px] font-semibold text-[#565c51] transition hover:border-black/20"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onSave(normalized())}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-[11px] font-semibold text-[#11130f] transition hover:border-lime-300 hover:text-[#405c08]"
          >
            Enregistrer
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onSaveAndCreate(normalized())}
            className="rounded-full bg-[#11130f] px-4 py-2 text-[11px] font-bold text-white shadow-[0_10px_24px_rgba(17,18,15,0.14)] transition hover:bg-[#B9FF4A] hover:text-[#11130F] disabled:cursor-not-allowed disabled:bg-black/20"
            style={{ border: 0 }}
          >
            {isSaving
              ? 'Création…'
              : attention
                ? 'Créer quand même'
                : 'Créer la mission'}
          </button>
        </footer>
      </div>
    </div>
  )
}
