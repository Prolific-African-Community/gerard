'use client'

import {
  segmentedItemActiveClass,
  segmentedItemClass,
  segmentedItemIdleClass,
  segmentedShellClass,
} from '../ui/ControlKit'

import type React from 'react'
import { useEffect, useMemo, useState } from 'react'

import type { Mission } from '../../lib/dispatch/mock-data'

type InvoiceDirection = 'ISSUED' | 'RECEIVED'
type InvoiceStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'RECEIVED'
  | 'TO_REVIEW'
  | 'APPROVED'
  | 'PAID'
  | 'OVERDUE'
  | 'CANCELLED'
  | 'REJECTED'

type InvoiceLine = {
  id?: string
  label: string
  description: string
  quantity: string
  unitPrice: string
  vatRate: string
  subtotalAmount?: number
  vatAmount?: number
  totalAmount?: number
  position: number
}

type Invoice = {
  id: string
  direction: InvoiceDirection
  invoiceNumber: string | null
  externalInvoiceNumber: string | null
  status: InvoiceStatus
  missionId: string | null
  maintenanceRequestId: string | null
  issueDate: string | null
  dueDate: string | null
  paidDate: string | null
  sellerName: string
  sellerAddress: string | null
  sellerVatNumber: string | null
  sellerIban: string | null
  sellerBic: string | null
  sellerBankName: string | null
  sellerBeneficiary: string | null
  buyerName: string
  buyerAddress: string | null
  buyerVatNumber: string | null
  buyerEmail: string | null
  missionReference: string | null
  clientReference: string | null
  cmrNumber: string | null
  deliveryNoteNumber: string | null
  missionDescription: string | null
  subtotalAmount: number
  vatAmount: number
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  remainingAmount: number
  amountToReceive: number
  currency: string
  paymentTerms: string | null
  notes: string | null
  sourcePdfUrl: string | null
  sourcePdfFileName: string | null
  sourcePdfMimeType: string | null
  createdAt: string
  lines: Array<{
    id: string
    label: string
    description: string | null
    quantity: number
    unitPrice: number
    vatRate: number
    subtotalAmount: number
    vatAmount: number
    totalAmount: number
    position: number
  }>
  invoiceMissions?: Array<{
    id: string
    missionId: string
    missionReferenceSnapshot: string
    clientReferenceSnapshot: string | null
    cmrNumberSnapshot: string | null
    deliveryNoteNumberSnapshot: string | null
    amountSnapshot: number
    currencySnapshot: string
    sortOrder: number
  }>
}

type InvoiceFormState = {
  id?: string
  direction: InvoiceDirection
  invoiceNumber: string
  externalInvoiceNumber: string
  status: InvoiceStatus
  missionId: string
  missionIds: string[]
  maintenanceRequestId: string
  issueDate: string
  dueDate: string
  paidDate: string
  sellerName: string
  sellerAddress: string
  sellerVatNumber: string
  sellerIban: string
  sellerBic: string
  sellerBankName: string
  sellerBeneficiary: string
  buyerName: string
  buyerAddress: string
  buyerVatNumber: string
  buyerEmail: string
  missionReference: string
  clientReference: string
  missionDescription: string
  paymentTerms: string
  notes: string
  sourcePdfUrl: string
  sourcePdfFileName: string
  sourcePdfMimeType: string
  subtotalAmount: string
  vatAmount: string
  totalAmount: string
  paidAmount: string
  lines: InvoiceLine[]
}

type PaymentContext = {
  id: string
  direction: InvoiceDirection
  counterpartyName: string
  referenceNumber: string | null
  totalAmount: number
  paidAmount: number
  balanceAmount: number
}

type InvoicesPanelProps = {
  missions: Mission[]
}

type MaintenanceRequestOption = {
  id: string
  plateNumber: string
  interventionType: string
  status: string
  issueDescription: string
  slInvoiceReference: string | null
  quoteAmount: number | null
  invoiceAmount: number | null
  quotePdfUrl: string | null
  invoicePdfUrl: string | null
  truckId?: string | null
  trailerId?: string | null
}

const defaultSeller = {
  // Identite legale de l'emetteur, alignee sur lib/dispatch/invoices.ts.
  // Donnee de facturation, pas du branding produit : voir le commentaire la-bas.
  sellerName: '',
  sellerAddress: '21 Stawelerstrooss, 9964\nHuldang Ëlwen,\nLuxembourg',
  sellerVatNumber: 'LU31249718',
  sellerIban: 'LU00 0000 0000 0000 0000',
  sellerBic: 'BILLLULLXXX',
  sellerBankName: 'BIL',
  sellerBeneficiary: '',
  paymentTerms: 'Paiement à 30 jours',
}

const defaultBuyer = {
  buyerName: defaultSeller.sellerName,
  buyerAddress: defaultSeller.sellerAddress,
  buyerVatNumber: defaultSeller.sellerVatNumber,
}

const slAutomotiveSupplier = {
  sellerName: 'SL Automotive',
  sellerAddress: 'A completer',
  sellerVatNumber: 'A completer',
  sellerIban: 'A completer',
  sellerBic: 'A completer',
  sellerBankName: 'A completer',
  sellerBeneficiary: 'SL Automotive',
}

const statusLabels: Record<InvoiceStatus, string> = {
  DRAFT: 'Brouillon',
  ISSUED: 'Émise',
  RECEIVED: 'Reçue',
  TO_REVIEW: 'À vérifier',
  APPROVED: 'Validée',
  PAID: 'Payée',
  OVERDUE: 'En retard',
  CANCELLED: 'Annulée',
  REJECTED: 'Rejetée',
}

const statusStyles: Record<InvoiceStatus, string> = {
  DRAFT: 'border-black/10 bg-[#F4F5F1] text-[#56594f]',
  ISSUED: 'border-sky-200 bg-sky-50 text-sky-800',
  RECEIVED: 'border-violet-200 bg-violet-50 text-violet-800',
  TO_REVIEW: 'border-amber-200 bg-amber-50 text-amber-800',
  APPROVED: 'border-lime-300 bg-lime-100 text-[#49630b]',
  PAID: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  OVERDUE: 'border-red-200 bg-red-50 text-red-700',
  CANCELLED: 'border-black/10 bg-[#e6e8e1] text-[#34372f]',
  REJECTED: 'border-red-200 bg-red-50 text-red-700',
}

const blankForm: InvoiceFormState = {
  direction: 'ISSUED',
  invoiceNumber: '',
  externalInvoiceNumber: '',
  status: 'DRAFT',
  missionId: '',
  missionIds: [],
  maintenanceRequestId: '',
  issueDate: formatDateInput(new Date()),
  dueDate: formatDateInput(addDays(new Date(), 30)),
  paidDate: '',
  ...defaultSeller,
  buyerName: '',
  buyerAddress: '',
  buyerVatNumber: '',
  buyerEmail: '',
  missionReference: '',
  clientReference: '',
  missionDescription: '',
  notes: '',
  sourcePdfUrl: '',
  sourcePdfFileName: '',
  sourcePdfMimeType: '',
  subtotalAmount: '0',
  vatAmount: '0',
  totalAmount: '0',
  paidAmount: '0',
  lines: [],
}

export function InvoicesPanel({ missions }: InvoicesPanelProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [activeTab, setActiveTab] = useState<InvoiceDirection | 'ALL'>('ISSUED')
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'ALL'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [form, setForm] = useState<InvoiceFormState>(blankForm)
  const [linkedInvoices, setLinkedInvoices] = useState<Invoice[]>([])
  const [missionSearch, setMissionSearch] = useState('')
  const [maintenanceRequests, setMaintenanceRequests] = useState<
    MaintenanceRequestOption[]
  >([])
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [formError, setFormError] = useState<string | null>(null)
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null)
  const [supplierPdfFile, setSupplierPdfFile] = useState<File | null>(null)
  const [isSupplierPdfUploading, setIsSupplierPdfUploading] = useState(false)
  const [paymentContext, setPaymentContext] = useState<PaymentContext | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [isPaymentSaving, setIsPaymentSaving] = useState(false)

  const queryString = useMemo(() => {
    const params = new URLSearchParams()

    if (activeTab !== 'ALL') {
      params.set('direction', activeTab)
    }

    if (statusFilter !== 'ALL') {
      params.set('status', statusFilter)
    }

    if (searchQuery.trim()) {
      params.set('search', searchQuery.trim())
    }

    if (dateFrom) {
      params.set('dateFrom', dateFrom)
    }

    if (dateTo) {
      params.set('dateTo', dateTo)
    }

    return params.toString()
  }, [activeTab, dateFrom, dateTo, searchQuery, statusFilter])

  useEffect(() => {
    const controller = new AbortController()

    async function loadInvoices() {
      try {
        setIsLoading(true)
        setError(null)
        const response = await fetch(`/api/dispatch/invoices?${queryString}`, {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Invoices API returned ${response.status}`)
        }

        const data = (await response.json()) as { invoices: Invoice[] }
        setInvoices(data.invoices)
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === 'AbortError'
        ) {
          return
        }

        console.error('Unable to load invoices', loadError)
        setError('Factures indisponibles pour le moment.')
      } finally {
        setIsLoading(false)
      }
    }

    loadInvoices()

    return () => controller.abort()
  }, [queryString])

  useEffect(() => {
    if (!form.missionId) {
      setLinkedInvoices([])
      return
    }

    fetch(`/api/dispatch/invoices/by-mission/${form.missionId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { invoices?: Invoice[] } | null) =>
        setLinkedInvoices(data?.invoices ?? [])
      )
      .catch(() => setLinkedInvoices([]))
  }, [form.missionId])

  useEffect(() => {
    fetch('/api/dispatch/maintenance-requests')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { maintenanceRequests?: MaintenanceRequestOption[] } | null) =>
        setMaintenanceRequests(data?.maintenanceRequests ?? [])
      )
      .catch(() => setMaintenanceRequests([]))
  }, [])

  const kpis = useMemo(() => {
    return {
      drafts: invoices.filter((invoice) => invoice.status === 'DRAFT').length,
      issued: invoices.filter((invoice) => invoice.status === 'ISSUED').length,
      paid: invoices.filter((invoice) => invoice.status === 'PAID').length,
      receivable: invoices
        .filter(
          (invoice) =>
            invoice.direction === 'ISSUED' &&
            invoice.status !== 'CANCELLED' &&
            getBalanceAmount(invoice) > 0
        )
        .reduce((total, invoice) => total + getBalanceAmount(invoice), 0),
      receivedToReview: invoices.filter(
        (invoice) =>
          invoice.direction === 'RECEIVED' &&
          ['RECEIVED', 'TO_REVIEW'].includes(invoice.status)
      ).length,
      payable: invoices
        .filter(
          (invoice) =>
            invoice.direction === 'RECEIVED' &&
            !['REJECTED', 'CANCELLED'].includes(invoice.status) &&
            invoice.totalAmount > 0 &&
            getBalanceAmount(invoice) > 0
        )
        .reduce((total, invoice) => total + getBalanceAmount(invoice), 0),
    }
  }, [invoices])

  function openNewInvoice() {
    setForm({
      ...blankForm,
      issueDate: formatDateInput(new Date()),
      dueDate: formatDateInput(addDays(new Date(), 30)),
    })
    setSupplierPdfFile(null)
    setFormError(null)
    setSaveState('idle')
    setIsDrawerOpen(true)
  }

  function openNewReceivedInvoice() {
    setActiveTab('RECEIVED')
    setForm({
      ...blankForm,
      direction: 'RECEIVED',
      status: 'RECEIVED',
      invoiceNumber: '',
      externalInvoiceNumber: '',
      missionId: '',
      missionIds: [],
      maintenanceRequestId: '',
      issueDate: formatDateInput(new Date()),
      dueDate: '',
      paidDate: '',
      ...slAutomotiveSupplier,
      ...defaultBuyer,
      buyerEmail: '',
      missionReference: '',
      clientReference: '',
      missionDescription: '',
      paymentTerms: '',
      notes: '',
      sourcePdfUrl: '',
      sourcePdfFileName: '',
      sourcePdfMimeType: '',
      subtotalAmount: '0',
      vatAmount: '0',
      totalAmount: '0',
      paidAmount: '0',
      lines: [],
    })
    setSupplierPdfFile(null)
    setFormError(null)
    setSaveState('idle')
    setIsDrawerOpen(true)
  }

  function openInvoice(invoice: Invoice) {
    setForm(invoiceToForm(invoice))
    setSupplierPdfFile(null)
    setFormError(null)
    setSaveState('idle')
    setIsDrawerOpen(true)
  }

  async function saveInvoice(nextStatus?: InvoiceStatus) {
    try {
      setFormError(null)
      const requestedStatus = nextStatus ?? form.status
      const currentBalanceAmount = Math.max(
        numberInput(form.totalAmount, 0) - numberInput(form.paidAmount, 0),
        0
      )

      if (requestedStatus === 'PAID' && form.id && currentBalanceAmount > 0) {
        openPaymentDialogFromForm()
        return
      }

      setSaveState('saving')
      const nextForm =
        nextStatus === 'ISSUED'
          ? withIssuedDefaults(form)
          : nextStatus === 'PAID'
            ? withPaidDefaults(form)
            : form
      const {
        sourcePdfUrl: _sourcePdfUrl,
        sourcePdfFileName: _sourcePdfFileName,
        sourcePdfMimeType: _sourcePdfMimeType,
        paidAmount: _paidAmount,
        ...invoicePayload
      } = nextForm
      const body = {
        ...invoicePayload,
        status: nextStatus ?? nextForm.status,
        ...(nextForm.direction === 'ISSUED'
          ? { lines: nextForm.lines }
          : {
              subtotalAmount: nextForm.subtotalAmount,
              vatAmount: nextForm.vatAmount,
              totalAmount: nextForm.totalAmount,
              ...(nextForm.sourcePdfUrl &&
              !nextForm.sourcePdfUrl.startsWith('data:') &&
              !supplierPdfFile
                ? {
                    sourcePdfUrl: nextForm.sourcePdfUrl,
                    sourcePdfFileName: nextForm.sourcePdfFileName,
                    sourcePdfMimeType: nextForm.sourcePdfMimeType,
                  }
                : {}),
            }),
      }
      const response = await fetch(
        form.id ? `/api/dispatch/invoices/${form.id}` : '/api/dispatch/invoices',
        {
          method: form.id ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      )
      let data = (await response.json().catch(() => null)) as {
        invoice?: Invoice
        error?: string
      } | null

      if (!response.ok || !data?.invoice) {
        throw new Error(data?.error ?? 'Sauvegarde impossible.')
      }

      let savedInvoice = data.invoice
      if (nextForm.direction === 'RECEIVED' && supplierPdfFile) {
        savedInvoice = await uploadSupplierPdf(savedInvoice.id, supplierPdfFile)
      }

      setForm(invoiceToForm(savedInvoice))
      setSupplierPdfFile(null)
      setInvoices((currentInvoices) => {
        const exists = currentInvoices.some(
          (invoice) => invoice.id === savedInvoice.id
        )
        return exists
          ? currentInvoices.map((invoice) =>
              invoice.id === savedInvoice.id ? savedInvoice : invoice
            )
          : [savedInvoice, ...currentInvoices]
      })
      setSaveState('saved')
      window.setTimeout(() => setSaveState('idle'), 1800)
    } catch (saveError) {
      console.error('Unable to save invoice', saveError)
      setFormError(
        saveError instanceof Error
          ? saveError.message
          : 'Impossible de sauvegarder la facture.'
      )
      setSaveState('idle')
    }
  }

  async function updateInvoiceStatus(invoice: Invoice, status: InvoiceStatus) {
    if (status === 'PAID') {
      openPaymentDialog(invoice)
      return
    }

    try {
      setError(null)
      const nextForm =
        status === 'ISSUED'
          ? withIssuedDefaults(invoiceToForm(invoice))
          : invoiceToForm(invoice)
      const response = await fetch(`/api/dispatch/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...nextForm,
          status,
        }),
      })
      const data = (await response.json().catch(() => null)) as {
        invoice?: Invoice
        error?: string
      } | null

      if (!response.ok || !data?.invoice) {
        throw new Error(data?.error ?? 'Mise à jour impossible.')
      }

      setInvoices((currentInvoices) =>
        currentInvoices.map((currentInvoice) =>
          currentInvoice.id === data.invoice!.id ? data.invoice! : currentInvoice
        )
      )
    } catch (updateError) {
      console.error('Unable to update invoice status', updateError)
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Impossible de mettre à jour le statut.'
      )
    }
  }

  function openPaymentDialog(invoice: Invoice | PaymentContext) {
    const balanceAmount = getBalanceAmount(invoice)
    const direction = invoice.direction

    setPaymentContext({
      id: invoice.id,
      direction,
      counterpartyName:
        'counterpartyName' in invoice
          ? invoice.counterpartyName
          : direction === 'RECEIVED'
            ? invoice.sellerName
            : invoice.buyerName,
      referenceNumber:
        'referenceNumber' in invoice
          ? invoice.referenceNumber
          : direction === 'RECEIVED'
            ? invoice.externalInvoiceNumber
            : invoice.invoiceNumber,
      totalAmount: invoice.totalAmount,
      paidAmount: invoice.paidAmount,
      balanceAmount,
    })
    setPaymentAmount(String(Number(balanceAmount.toFixed(2))))
    setPaymentError(null)
  }

  function openPaymentDialogFromForm() {
    if (!form.id) {
      setFormError(
        isReceivedForm(form)
          ? 'Sauvegardez la facture avant de confirmer un paiement.'
          : 'Sauvegardez la facture avant de confirmer un encaissement.'
      )
      return
    }

    openPaymentDialog({
      id: form.id,
      direction: form.direction,
      counterpartyName:
        form.direction === 'RECEIVED' ? form.sellerName : form.buyerName,
      referenceNumber:
        form.direction === 'RECEIVED'
          ? form.externalInvoiceNumber || null
          : form.invoiceNumber || null,
      totalAmount: numberInput(form.totalAmount, 0),
      paidAmount: numberInput(form.paidAmount, 0),
      balanceAmount: Math.max(
        numberInput(form.totalAmount, 0) - numberInput(form.paidAmount, 0),
        0
      ),
    })
  }

  async function confirmPayment() {
    if (!paymentContext) {
      return
    }

    const amount = numberInput(paymentAmount, -1)

    if (!Number.isFinite(amount) || amount < 0) {
      setPaymentError('Saisissez un montant positif.')
      return
    }

    try {
      setIsPaymentSaving(true)
      setPaymentError(null)
      const response = await fetch(`/api/dispatch/invoices/${paymentContext.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action:
            paymentContext.direction === 'ISSUED'
              ? 'recordReceipt'
              : 'recordPayment',
          amount,
        }),
      })
      const data = (await response.json().catch(() => null)) as {
        invoice?: Invoice
        error?: string
      } | null

      if (!response.ok || !data?.invoice) {
        throw new Error(
          data?.error ??
            (paymentContext.direction === 'ISSUED'
              ? 'Encaissement impossible.'
              : 'Paiement impossible.')
        )
      }

      setInvoices((currentInvoices) =>
        currentInvoices.map((invoice) =>
          invoice.id === data.invoice!.id ? data.invoice! : invoice
        )
      )
      if (form.id === data.invoice.id) {
        setForm(invoiceToForm(data.invoice))
      }
      setPaymentContext(null)
      setPaymentAmount('')
    } catch (paymentSaveError) {
      console.error('Unable to record invoice settlement', paymentSaveError)
      setPaymentError(
        paymentSaveError instanceof Error
          ? paymentSaveError.message
          : paymentContext.direction === 'ISSUED'
            ? 'Impossible de confirmer l encaissement.'
            : 'Impossible de confirmer le paiement.'
      )
    } finally {
      setIsPaymentSaving(false)
    }
  }

  async function downloadInvoicePdf(invoice: Pick<Invoice, 'id' | 'direction' | 'invoiceNumber'>) {
    if (invoice.direction === 'RECEIVED') {
      setError('PDF fournisseur non disponible dans cette phase.')
      return
    }

    try {
      setPdfLoadingId(invoice.id)
      setError(null)
      setFormError(null)
      const response = await fetch(`/api/dispatch/invoices/${invoice.id}/pdf`)
      const contentType = response.headers.get('content-type') ?? ''

      if (!response.ok || !contentType.includes('application/pdf')) {
        const data = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error ?? 'Generation PDF impossible.')
      }

      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = getPdfFilename(response, invoice)
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(downloadUrl)
    } catch (downloadError) {
      console.error('Unable to download invoice PDF', downloadError)
      const message =
        downloadError instanceof Error
          ? downloadError.message
          : 'Impossible de telecharger le PDF.'
      if (isDrawerOpen) {
        setFormError(message)
      } else {
        setError(message)
      }
    } finally {
      setPdfLoadingId(null)
    }
  }

  function openSupplierPdf(url: string, invoiceId?: string) {
    if (!url) {
      setFormError('Aucun PDF fournisseur attache.')
      return
    }

    const pdfUrl =
      invoiceId && !url.startsWith('data:')
        ? `/api/dispatch/invoices/${invoiceId}/source-pdf`
        : url
    window.open(pdfUrl, '_blank', 'noopener,noreferrer')
  }

  function handleSupplierPdfFile(file: File | null) {
    if (!file) {
      return
    }

    if (file.type !== 'application/pdf') {
      setFormError('Le fichier doit etre un PDF.')
      return
    }

    setSupplierPdfFile(file)
    setForm((currentForm) => ({
      ...currentForm,
      sourcePdfFileName: file.name,
      sourcePdfMimeType: file.type,
    }))
    setFormError(null)
  }

  async function uploadSupplierPdf(invoiceId: string, file: File) {
    setIsSupplierPdfUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(
        `/api/dispatch/invoices/${invoiceId}/upload-pdf`,
        {
          method: 'POST',
          body: formData,
        }
      )
      const data = (await response.json().catch(() => null)) as {
        invoice?: Invoice
        error?: string
      } | null

      if (!response.ok || !data?.invoice) {
        throw new Error(data?.error ?? 'Upload PDF impossible.')
      }

      return data.invoice
    } finally {
      setIsSupplierPdfUploading(false)
    }
  }

  function selectMission(missionId: string) {
    const mission = missions.find((item) => item.id === missionId)

    if (!mission) {
      return
    }

    const selected = missions.filter((item) => form.missionIds.includes(item.id))
    const nextSelected = selected.some((item) => item.id === missionId)
      ? selected.filter((item) => item.id !== missionId)
      : [...selected, mission]
    if (nextSelected.length) {
      const first = nextSelected[0]
      const currency = first.priceCurrency || 'EUR'
      if (mission.clientName !== first.clientName) {
        setFormError('Les missions groupées doivent appartenir au même client.')
        return
      }
      if ((mission.priceCurrency || 'EUR') !== currency) {
        setFormError('Les missions groupées doivent avoir la même devise.')
        return
      }
    }

    const description = `${mission.pickupCity} -> ${mission.deliveryCity}`
    const lineDescription = `Transport - Mission ${mission.reference}${
      mission.clientReference ? ` / ${mission.clientReference}` : ''
    }`

    setForm((currentForm) => ({
      ...currentForm,
      missionId: nextSelected.length === 1 ? nextSelected[0].id : '',
      missionIds: nextSelected.map((item) => item.id),
      buyerName:
        currentForm.direction === 'RECEIVED'
          ? currentForm.buyerName || defaultBuyer.buyerName
          : currentForm.buyerName || mission.clientName,
      paymentTerms:
        currentForm.direction === 'RECEIVED'
          ? currentForm.paymentTerms
          : currentForm.paymentTerms ||
            mission.paymentTerms ||
            defaultSeller.paymentTerms,
      missionReference: mission.reference,
      clientReference: mission.clientReference ?? '',
      missionDescription: description,
      lines:
        nextSelected.length
          ? nextSelected.map((item, index) => ({
              label: 'Transport mission',
              description: `Transport - Mission ${item.reference}${item.cmrNumber ? ` · CMR ${item.cmrNumber}` : ''}${item.deliveryNoteNumber ? ` · BL ${item.deliveryNoteNumber}` : ''}`,
              quantity: '1',
              unitPrice: typeof item.priceAmount === 'number' ? String(item.priceAmount) : '0',
              vatRate: '17',
              position: index,
            }))
          : currentForm.direction === 'RECEIVED'
          ? currentForm.lines
          : currentForm.lines,
    }))
  }

  function selectMaintenanceRequest(maintenanceRequestId: string) {
    const request = maintenanceRequests.find(
      (maintenanceRequest) => maintenanceRequest.id === maintenanceRequestId
    )

    if (!request) {
      setForm((currentForm) => ({ ...currentForm, maintenanceRequestId }))
      return
    }

    const amount = request.invoiceAmount ?? request.quoteAmount ?? 0
    setForm((currentForm) => ({
      ...currentForm,
      maintenanceRequestId,
      ...slAutomotiveSupplier,
      externalInvoiceNumber:
        currentForm.externalInvoiceNumber ||
        extractSupplierReference(
          request.slInvoiceReference,
          request.invoicePdfUrl,
          request.quotePdfUrl
        ) ||
        request.slInvoiceReference ||
        '',
      missionDescription:
        currentForm.missionDescription ||
        `${request.plateNumber} - ${request.issueDescription}`,
      subtotalAmount: currentForm.subtotalAmount || String(amount),
      vatAmount: currentForm.vatAmount || '0',
      totalAmount: currentForm.totalAmount || String(amount),
      sourcePdfUrl:
        currentForm.sourcePdfUrl ||
        request.invoicePdfUrl ||
        request.quotePdfUrl ||
        '',
      sourcePdfFileName:
        currentForm.sourcePdfFileName ||
        (request.slInvoiceReference
          ? `SL-Automotive-${request.slInvoiceReference}.pdf`
          : ''),
      sourcePdfMimeType:
        currentForm.sourcePdfMimeType ||
        (request.invoicePdfUrl || request.quotePdfUrl ? 'application/pdf' : ''),
      lines: currentForm.lines,
    }))
  }

  const totals = isReceivedForm(form)
    ? {
        subtotal: numberInput(form.subtotalAmount, 0),
        vat: numberInput(form.vatAmount, 0),
        total: numberInput(form.totalAmount, 0),
      }
    : calculateLines(form.lines)
  const selectedMission = missions.find((mission) => mission.id === form.missionId)
  const selectedMissions = missions.filter((mission) => form.missionIds.includes(mission.id))
  const drawerInvoice = form.id
    ? invoices.find((invoice) => invoice.id === form.id) ?? null
    : null
  const filteredMissions = missions.filter((mission) => {
    const text = `${mission.reference} ${mission.clientName} ${mission.pickupCity} ${mission.deliveryCity} ${mission.cmrNumber ?? ''} ${mission.deliveryNoteNumber ?? ''}`.toLowerCase()
    return text.includes(missionSearch.toLowerCase())
  })
  const selectedMaintenanceRequest = maintenanceRequests.find(
    (maintenanceRequest) => maintenanceRequest.id === form.maintenanceRequestId
  )
  const isReceivedInvoice = form.direction === 'RECEIVED'
  const isReadOnly = Boolean(
    form.direction === 'ISSUED' && form.id && form.status !== 'DRAFT'
  )
  const formPaidAmount = numberInput(form.paidAmount, 0)
  const formRemainingAmount = Math.max(totals.total - formPaidAmount, 0)

  return (
    <section className="min-h-0 flex-1 overflow-auto pb-10 pt-3">
      <div className="space-y-4">
        <div className="flex flex-col gap-4 rounded-[30px] border border-black/[0.04] bg-white/85 p-5 shadow-[0_18px_55px_rgba(17,18,15,0.055)] lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#777d72]">
              Facturation dispatch
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#11130f]">
              Factures
            </h2>
            <p className="mt-2 max-w-2xl text-sm font-semibold text-[#6f766b]">
              Centralisation des factures émises et reçues.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={openNewReceivedInvoice}
              className="h-11 rounded-[16px] border border-black/10 bg-white px-4 text-xs font-bold text-[#4f5549] transition active:scale-95"
            >
              + Ajouter facture fournisseur
            </button>
            <button
              type="button"
              onClick={openNewInvoice}
              className="h-11 rounded-[16px] bg-[#11130f] px-4 text-xs font-bold text-white shadow-[0_12px_28px_rgba(17,18,15,0.13)] transition active:scale-95"
            >
              + Creer facture client
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <KpiCard label="Brouillons" value={String(kpis.drafts)} icon="DOC" />
          <KpiCard label="Émises" value={String(kpis.issued)} icon="OUT" />
          <KpiCard label="A verifier" value={String(kpis.receivedToReview)} icon="IN" />
          <KpiCard label="À encaisser" value={money(kpis.receivable)} icon="EUR" />
          <KpiCard label="Fournisseurs a payer" value={money(kpis.payable)} icon="PAY" />
        </div>

        <div className="rounded-[30px] border border-black/[0.04] bg-white p-4 shadow-[0_18px_55px_rgba(17,18,15,0.055)]">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className={`w-full overflow-x-auto xl:w-auto ${segmentedShellClass}`}>
              {[
                ['ISSUED', 'Factures émises'],
                ['RECEIVED', 'Factures reçues'],
                ['ALL', 'Toutes les factures'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActiveTab(value as InvoiceDirection | 'ALL')}
                  className={[
                    segmentedItemClass,
                    activeTab === value ? segmentedItemActiveClass : segmentedItemIdleClass,
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(240px,1fr)_150px_130px_130px]">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Rechercher par client, fournisseur, numéro facture, mission, référence client..."
                className="h-11 min-w-0 rounded-[16px] border border-black/10 bg-[#F4F5F1] px-3 text-xs font-semibold text-[#11130f] outline-none transition focus:border-lime-300 focus:bg-white"
              />
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as InvoiceStatus | 'ALL')
                }
                className="h-11 rounded-[16px] border border-black/10 bg-[#F4F5F1] px-3 text-xs font-bold text-[#4f5549] outline-none focus:border-lime-300"
              >
                <option value="ALL">Tous statuts</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                type="date"
                className="h-11 rounded-[16px] border border-black/10 bg-[#F4F5F1] px-3 text-xs font-bold text-[#4f5549] outline-none focus:border-lime-300"
              />
              <input
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                type="date"
                className="h-11 rounded-[16px] border border-black/10 bg-[#F4F5F1] px-3 text-xs font-bold text-[#4f5549] outline-none focus:border-lime-300"
              />
            </div>
          </div>

          {activeTab === 'RECEIVED' && invoices.length === 0 && !isLoading ? (
            <div className="mt-4 rounded-[24px] border border-dashed border-black/10 bg-[#F7F8F4] px-5 py-8 text-sm font-semibold text-[#6f766b]">
              Ajoutez ici les factures fournisseurs reçues,
              notamment les factures liées aux interventions SL Automotive.
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-[20px] bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : null}

          <InvoiceTable
            invoices={invoices}
            isLoading={isLoading}
            maintenanceRequests={maintenanceRequests}
            viewMode={activeTab}
            onOpen={openInvoice}
            onPdf={downloadInvoicePdf}
            onSupplierPdf={(invoice) =>
              openSupplierPdf(invoice.sourcePdfUrl ?? '', invoice.id)
            }
            onRecordPayment={openPaymentDialog}
            pdfLoadingId={pdfLoadingId}
            onStatusChange={updateInvoiceStatus}
          />
        </div>
      </div>

      {isDrawerOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/35 p-3 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-[30px] bg-[#F4F5F1] shadow-[0_24px_90px_rgba(0,0,0,0.22)]">
            <div className="flex items-start justify-between gap-4 border-b border-black/10 bg-white px-5 py-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#777d72]">
                  {form.id ? 'Modifier facture' : 'Nouvelle facture'}
                </p>
                <h3 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#11130f]">
                  {isReceivedInvoice
                    ? form.externalInvoiceNumber || 'Facture fournisseur'
                    : form.invoiceNumber || 'Brouillon'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="h-10 rounded-[15px] border border-black/10 bg-[#F4F5F1] px-4 text-xs font-bold text-[#4f5549]"
              >
                Fermer
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <div className="grid gap-4 xl:grid-cols-[330px_1fr]">
                <div className="space-y-4">
                  <Section title={isReceivedInvoice ? 'Liens operationnels' : 'Missions à facturer'}>
                    {!isReceivedInvoice ? (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <FieldLabel label={`Missions sélectionnées · ${selectedMissions.length}`} />
                          <span className="text-xs font-bold text-[#11130f]">HT {money(selectedMissions.reduce((total, mission) => total + (mission.priceAmount ?? 0), 0))}</span>
                        </div>
                        <input value={missionSearch} onChange={(event) => setMissionSearch(event.target.value)} placeholder="Rechercher référence, client, CMR, BL…" className="field mt-2" />
                        <div className="mt-2 max-h-72 space-y-2 overflow-auto rounded-[18px] bg-white p-2">
                          {filteredMissions.map((mission) => {
                            const selected = form.missionIds.includes(mission.id)
                            const lockedClient = selectedMissions[0] && selectedMissions[0].clientName !== mission.clientName
                            const lockedCurrency = selectedMissions[0] && (selectedMissions[0].priceCurrency || 'EUR') !== (mission.priceCurrency || 'EUR')
                            const disabled = Boolean(!selected && (lockedClient || lockedCurrency || isReadOnly))
                            return <label key={mission.id} className={`block rounded-[14px] p-2 text-xs ${disabled ? 'cursor-not-allowed bg-[#f4f5f1] opacity-60' : 'cursor-pointer bg-[#F7F8F4]'}`}>
                              <div className="flex gap-2">
                                <input type="checkbox" checked={selected} disabled={disabled} onChange={() => selectMission(mission.id)} />
                                <span className="min-w-0"><b>{mission.reference}</b> · {mission.clientName}<br />{mission.pickupCity} → {mission.deliveryCity}{mission.cmrNumber ? ` · CMR ${mission.cmrNumber}` : ''}{mission.deliveryNoteNumber ? ` · BL ${mission.deliveryNoteNumber}` : ''}<br />{typeof mission.priceAmount === 'number' ? `${money(mission.priceAmount)} · ${mission.priceCurrency || 'EUR'}` : <em className="text-amber-700">Prix absent : 0 € non inventé</em>}{disabled ? <em className="ml-1 text-red-700">{lockedClient ? 'Client différent' : 'Devise différente'}</em> : null}</span>
                              </div>
                            </label>
                          })}
                        </div>
                        <div className="mt-3 space-y-2 rounded-[18px] bg-[#F7F8F4] p-3 text-xs font-semibold text-[#5f665b]">
                          {selectedMissions.length ? selectedMissions.map((mission) => <div key={mission.id} className="flex items-start justify-between gap-2"><span><b className="text-[#11130f]">{mission.reference}</b>{mission.cmrNumber ? ` · CMR ${mission.cmrNumber}` : ''}{mission.deliveryNoteNumber ? ` · BL ${mission.deliveryNoteNumber}` : ''}<br />{typeof mission.priceAmount === 'number' ? money(mission.priceAmount) : 'Prix à renseigner'}</span><button type="button" disabled={isReadOnly} onClick={() => selectMission(mission.id)} className="text-red-700">Retirer</button></div>) : <p>Aucune mission sélectionnée.</p>}
                        </div>
                      </>
                    ) : null}
                    <div className="rounded-[18px] bg-white p-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#73796d]">
                        Factures liées à cette mission
                      </p>
                      {linkedInvoices.length ? (
                        <div className="mt-2 space-y-2">
                          {linkedInvoices.map((invoice) => (
                            <button
                              key={invoice.id}
                              type="button"
                              onClick={() => openInvoice(invoice)}
                              className="w-full rounded-[16px] bg-[#F4F5F1] px-3 py-2 text-left text-xs font-semibold text-[#4f5549]"
                            >
                              {invoice.invoiceNumber} ·{' '}
                              {statusLabels[invoice.status]} ·{' '}
                              {money(invoice.totalAmount)}
                            </button>
                          ))}
                          <p className="rounded-2xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                            Une facture existe déjà pour cette mission.
                          </p>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs font-semibold text-[#8b9186]">
                          Aucune facture liée à cette mission.
                        </p>
                      )}
                    </div>
                    {isReceivedInvoice ? (
                      <label className="block">
                        <FieldLabel label="Intervention liee" />
                        <select
                          value={form.maintenanceRequestId}
                          onChange={(event) =>
                            selectMaintenanceRequest(event.target.value)
                          }
                          className="field mt-1"
                        >
                          <option value="">Aucune intervention</option>
                          {maintenanceRequests.map((request) => (
                            <option key={request.id} value={request.id}>
                              {request.plateNumber} - {request.status} -{' '}
                              {request.slInvoiceReference || request.id}
                            </option>
                          ))}
                        </select>
                        {selectedMaintenanceRequest ? (
                          <span className="mt-2 block rounded-2xl bg-[#F7F8F4] px-3 py-2 text-xs font-semibold text-[#5f665b]">
                            {selectedMaintenanceRequest.issueDescription}
                          </span>
                        ) : null}
                      </label>
                    ) : null}
                  </Section>
                </div>

                <div className="space-y-4">
                  <Section title={isReceivedInvoice ? 'Informations facture fournisseur' : 'Informations facture'}>
                    <div className="grid gap-3 md:grid-cols-5">
                      {isReceivedInvoice ? (
                        <TextField label="N facture fournisseur" value={form.externalInvoiceNumber} onChange={(value) => setFormValue('externalInvoiceNumber', value, setForm)} disabled={isReadOnly} />
                      ) : (
                        <TextField label="N° facture" value={form.invoiceNumber} onChange={(value) => setFormValue('invoiceNumber', value, setForm)} disabled={isReadOnly} />
                      )}
                      <DateField label={isReceivedInvoice ? 'Date facture' : 'Date émission'} value={form.issueDate} onChange={(value) => setFormValue('issueDate', value, setForm)} disabled={isReadOnly} />
                      <DateField label="Échéance" value={form.dueDate} onChange={(value) => setFormValue('dueDate', value, setForm)} disabled={isReadOnly} />
                      <DateField label="Date paiement" value={form.paidDate} onChange={(value) => setFormValue('paidDate', value, setForm)} />
                      <label className="block">
                        <FieldLabel label="Statut" />
                        <select
                          value={form.status}
                          onChange={(event) => setFormValue('status', event.target.value as InvoiceStatus, setForm)}
                          className="field mt-1"
                        >
                          {Object.entries(statusLabels).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {isReceivedInvoice ? (
                      <div className="rounded-[20px] bg-[#F7F8F4] p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#73796d]">
                              Document fournisseur
                            </p>
                            <p className="mt-1 text-sm font-bold text-[#11130f]">
                              {supplierPdfFile
                                ? `${supplierPdfFile.name} - en attente d'enregistrement`
                                : form.sourcePdfFileName ||
                                (form.sourcePdfUrl
                                  ? 'PDF fournisseur attache'
                                  : 'Aucun PDF attache')}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => openSupplierPdf(form.sourcePdfUrl, form.id)}
                              disabled={!form.sourcePdfUrl}
                              className="h-10 rounded-[15px] bg-[#11130f] px-3 text-xs font-bold text-white disabled:bg-black/30"
                            >
                              Ouvrir PDF
                            </button>
                            <label className="flex h-10 cursor-pointer items-center rounded-[15px] border border-black/10 bg-white px-3 text-xs font-bold text-[#4f5549]">
                              {form.sourcePdfUrl ? 'Remplacer PDF' : 'Ajouter PDF'}
                              <input
                                type="file"
                                accept=".pdf,application/pdf"
                                className="hidden"
                                onChange={(event) =>
                                  handleSupplierPdfFile(event.target.files?.[0] ?? null)
                                }
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <TextField label="Conditions de paiement" value={form.paymentTerms} onChange={(value) => setFormValue('paymentTerms', value, setForm)} disabled={isReadOnly} />
                  </Section>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Section title={isReceivedInvoice ? 'Fournisseur' : 'Émetteur'}>
                      {isReceivedInvoice ? (
                        <button
                          type="button"
                          onClick={() =>
                            setForm((currentForm) => ({
                              ...currentForm,
                              ...slAutomotiveSupplier,
                            }))
                          }
                          className="rounded-[15px] border border-black/10 bg-[#F4F5F1] px-3 py-2 text-xs font-bold text-[#4f5549]"
                        >
                          Preset SL Automotive
                        </button>
                      ) : null}
                      <TextField label="Nom" value={form.sellerName} onChange={(value) => setFormValue('sellerName', value, setForm)} disabled={isReadOnly} />
                      <TextareaField label="Adresse" value={form.sellerAddress} onChange={(value) => setFormValue('sellerAddress', value, setForm)} disabled={isReadOnly} />
                      <div className="grid gap-3 md:grid-cols-2">
                        <TextField label="TVA" value={form.sellerVatNumber} onChange={(value) => setFormValue('sellerVatNumber', value, setForm)} disabled={isReadOnly} />
                        {!isReceivedInvoice ? (
                          <>
                            <TextField label="IBAN" value={form.sellerIban} onChange={(value) => setFormValue('sellerIban', value, setForm)} disabled={isReadOnly} />
                            <TextField label="BIC" value={form.sellerBic} onChange={(value) => setFormValue('sellerBic', value, setForm)} disabled={isReadOnly} />
                            <TextField label="Banque" value={form.sellerBankName} onChange={(value) => setFormValue('sellerBankName', value, setForm)} disabled={isReadOnly} />
                          </>
                        ) : null}
                      </div>
                      {!isReceivedInvoice ? (
                        <TextField label="Bénéficiaire" value={form.sellerBeneficiary} onChange={(value) => setFormValue('sellerBeneficiary', value, setForm)} disabled={isReadOnly} />
                      ) : null}
                    </Section>

                    <Section title={isReceivedInvoice ? 'Émetteur' : 'Client'}>
                      <TextField label="Nom" value={form.buyerName} onChange={(value) => setFormValue('buyerName', value, setForm)} disabled={isReadOnly} />
                      <TextareaField label="Adresse" value={form.buyerAddress} onChange={(value) => setFormValue('buyerAddress', value, setForm)} disabled={isReadOnly} />
                      <div className="grid gap-3 md:grid-cols-2">
                        <TextField label={isReceivedInvoice ? 'TVA émetteur' : 'TVA client'} value={form.buyerVatNumber} onChange={(value) => setFormValue('buyerVatNumber', value, setForm)} disabled={isReadOnly} />
                        <TextField label={isReceivedInvoice ? 'Email émetteur' : 'Email client'} value={form.buyerEmail} onChange={(value) => setFormValue('buyerEmail', value, setForm)} disabled={isReadOnly} />
                      </div>
                    </Section>
                  </div>

                  {drawerInvoice?.invoiceMissions?.length ? (
                    <Section title="Missions facturées">
                      <div className="space-y-2">
                        {drawerInvoice.invoiceMissions.map((item) => (
                          <div
                            key={item.id}
                            className="grid gap-2 rounded-[18px] bg-[#F7F8F4] px-4 py-3 text-xs text-[#5f665b] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                          >
                            <div className="min-w-0">
                              <p className="font-bold text-[#11130f]">
                                {item.missionReferenceSnapshot}
                                {item.clientReferenceSnapshot ? ` · ${item.clientReferenceSnapshot}` : ''}
                              </p>
                              {(item.cmrNumberSnapshot || item.deliveryNoteNumberSnapshot) ? (
                                <p className="mt-1 font-semibold">
                                  {item.cmrNumberSnapshot ? `CMR ${item.cmrNumberSnapshot}` : ''}
                                  {item.cmrNumberSnapshot && item.deliveryNoteNumberSnapshot ? ' · ' : ''}
                                  {item.deliveryNoteNumberSnapshot ? `BL ${item.deliveryNoteNumberSnapshot}` : ''}
                                </p>
                              ) : null}
                            </div>
                            <p className="font-bold text-[#11130f]">
                              {money(item.amountSnapshot)} {item.currencySnapshot}
                            </p>
                          </div>
                        ))}
                      </div>
                    </Section>
                  ) : null}

                  <Section title="Références mission">
                    <div className="grid gap-3 md:grid-cols-2">
                      <TextField label="Référence interne" value={form.missionReference} onChange={(value) => setFormValue('missionReference', value, setForm)} disabled={isReadOnly} />
                      <TextField label="Référence client" value={form.clientReference} onChange={(value) => setFormValue('clientReference', value, setForm)} disabled={isReadOnly} />
                    </div>
                    <TextareaField label="Description mission" value={form.missionDescription} onChange={(value) => setFormValue('missionDescription', value, setForm)} disabled={isReadOnly} />
                  </Section>

                  <Section title={isReceivedInvoice ? 'Montants et suivi' : 'Lignes facture'}>
                    {isReceivedInvoice ? (
                      <div className="grid gap-3 md:grid-cols-3">
                        <TextField label="Total HT" value={form.subtotalAmount} onChange={(value) => setReceivedAmountValue('subtotalAmount', value, setForm)} />
                        <TextField label="TVA" value={form.vatAmount} onChange={(value) => setReceivedAmountValue('vatAmount', value, setForm)} />
                        <TextField label="Total TTC" value={form.totalAmount} onChange={(value) => setFormValue('totalAmount', value, setForm)} />
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          {form.lines.map((line, index) => (
                            <InvoiceLineEditor
                              key={`${line.position}-${index}`}
                              line={line}
                              disabled={isReadOnly}
                              onChange={(nextLine) => updateLine(index, nextLine, setForm)}
                              onRemove={() => removeLine(index, setForm)}
                            />
                          ))}
                        </div>
                        {!isReadOnly ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {[
                              'Surcharge carburant',
                              'Surcharge exceptionnelle',
                              'Frais d attente',
                              'Ligne libre',
                            ].map((label) => (
                              <PresetButton
                                key={label}
                                label={label === 'Ligne libre' ? 'Ajouter ligne libre' : label}
                                onClick={() => addPresetLine(label, setForm)}
                              />
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                    <div className="mt-4 ml-auto grid max-w-sm gap-2 rounded-[20px] bg-[#F7F8F4] p-4 text-sm font-bold text-[#11130f]">
                      <TotalRow label="Total HT" value={money(totals.subtotal)} />
                      <TotalRow label="TVA" value={money(totals.vat)} />
                      <TotalRow label="Total TTC" value={money(totals.total)} strong />
                      {isReceivedInvoice ? (
                        <>
                          <TotalRow label="Deja paye" value={money(formPaidAmount)} />
                          <TotalRow
                            label="Restant a payer"
                            value={money(formRemainingAmount)}
                            strong
                          />
                        </>
                      ) : (
                        <>
                          <TotalRow label="Deja recu" value={money(formPaidAmount)} />
                          <TotalRow
                            label="A recevoir"
                            value={money(formRemainingAmount)}
                            strong
                          />
                        </>
                      )}
                    </div>
                    <TextareaField label="Notes" value={form.notes} onChange={(value) => setFormValue('notes', value, setForm)} />
                  </Section>

                  {formError ? (
                    <div className="rounded-[20px] bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                      {formError}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-black/10 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
              {saveState === 'saved' ? (
                <p className="mr-auto text-xs font-bold text-[#49630b]">
                  Brouillon sauvegardé.
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="h-11 rounded-[16px] border border-black/10 bg-[#F4F5F1] px-4 text-xs font-bold text-[#4f5549]"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={() => saveInvoice()}
                disabled={saveState === 'saving' || isSupplierPdfUploading}
                className="h-11 rounded-[16px] bg-[#11130f] px-4 text-xs font-bold text-white disabled:bg-black/30"
              >
                {isSupplierPdfUploading
                  ? 'Upload PDF...'
                  : saveState === 'saving'
                    ? 'Enregistrement...'
                  : isReceivedInvoice
                    ? 'Enregistrer'
                    : 'Enregistrer brouillon'}
              </button>
              {form.id && form.direction === 'ISSUED' ? (
                <button
                  type="button"
                  onClick={() =>
                    downloadInvoicePdf({
                      id: form.id!,
                      direction: form.direction,
                      invoiceNumber: form.invoiceNumber || null,
                    })
                  }
                  disabled={pdfLoadingId === form.id}
                  className="h-11 rounded-[16px] border border-black/10 bg-[#F4F5F1] px-4 text-xs font-bold text-[#11130f] disabled:opacity-50"
                >
                  {pdfLoadingId === form.id ? 'Generation PDF...' : 'Telecharger PDF'}
                </button>
              ) : null}
              {!isReceivedInvoice && form.status === 'DRAFT' ? (
                <button
                  type="button"
                  onClick={() => saveInvoice('ISSUED')}
                  disabled={saveState === 'saving' || isSupplierPdfUploading}
                  className="h-11 rounded-[16px] bg-lime-300 px-4 text-xs font-bold text-[#26340b] disabled:opacity-50"
                >
                  Marquer comme émise
                </button>
              ) : null}
              {!isReceivedInvoice && form.status === 'ISSUED' ? (
                <button
                  type="button"
                  onClick={openPaymentDialogFromForm}
                  disabled={saveState === 'saving' || isSupplierPdfUploading}
                  className="h-11 rounded-[16px] bg-emerald-100 px-4 text-xs font-bold text-emerald-800 disabled:opacity-50"
                >
                  Confirmer encaissement
                </button>
              ) : null}
              {isReceivedInvoice && form.status === 'RECEIVED' ? (
                <button
                  type="button"
                  onClick={() => saveInvoice('TO_REVIEW')}
                  disabled={saveState === 'saving' || isSupplierPdfUploading}
                  className="h-11 rounded-[16px] bg-amber-50 px-4 text-xs font-bold text-amber-800 disabled:opacity-50"
                >
                  Marquer a verifier
                </button>
              ) : null}
              {isReceivedInvoice && ['RECEIVED', 'TO_REVIEW'].includes(form.status) ? (
                <button
                  type="button"
                  onClick={() => saveInvoice('APPROVED')}
                  disabled={saveState === 'saving' || isSupplierPdfUploading}
                  className="h-11 rounded-[16px] bg-lime-300 px-4 text-xs font-bold text-[#26340b] disabled:opacity-50"
                >
                  Valider
                </button>
              ) : null}
              {isReceivedInvoice && form.id && formRemainingAmount > 0 ? (
                <button
                  type="button"
                  onClick={openPaymentDialogFromForm}
                  disabled={saveState === 'saving' || isSupplierPdfUploading}
                  className="h-11 rounded-[16px] bg-emerald-100 px-4 text-xs font-bold text-emerald-800 disabled:opacity-50"
                >
                  Confirmer paiement
                </button>
              ) : null}
              {isReceivedInvoice && !['PAID', 'REJECTED'].includes(form.status) ? (
                <button
                  type="button"
                  onClick={() => saveInvoice('REJECTED')}
                  disabled={saveState === 'saving' || isSupplierPdfUploading}
                  className="h-11 rounded-[16px] bg-red-50 px-4 text-xs font-bold text-red-700 disabled:opacity-50"
                >
                  Rejeter
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {paymentContext ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 px-4 py-6">
          <div className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-[0_28px_80px_rgba(17,18,15,0.22)]">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7b8075]">
                {paymentContext.direction === 'ISSUED'
                  ? 'Encaissement client'
                  : 'Paiement fournisseur'}
              </p>
              <h3 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-[#11130f]">
                {paymentContext.direction === 'ISSUED'
                  ? 'Confirmer l encaissement'
                  : 'Confirmer le paiement'}
              </h3>
            </div>
            <div className="mt-4 space-y-2 rounded-[20px] bg-[#F7F8F4] p-4 text-sm font-bold text-[#11130f]">
              <TotalRow
                label={paymentContext.direction === 'ISSUED' ? 'Client' : 'Fournisseur'}
                value={paymentContext.counterpartyName}
              />
              <TotalRow
                label={
                  paymentContext.direction === 'ISSUED'
                    ? 'N facture'
                    : 'N facture fournisseur'
                }
                value={paymentContext.referenceNumber || '-'}
              />
              <TotalRow label="Total TTC" value={money(paymentContext.totalAmount)} />
              <TotalRow
                label={paymentContext.direction === 'ISSUED' ? 'Deja recu' : 'Deja paye'}
                value={money(paymentContext.paidAmount)}
              />
              <TotalRow
                label={
                  paymentContext.direction === 'ISSUED'
                    ? 'A recevoir'
                    : 'Restant a payer'
                }
                value={money(paymentContext.balanceAmount)}
                strong
              />
            </div>
            <div className="mt-4">
              <TextField
                label={
                  paymentContext.direction === 'ISSUED'
                    ? 'Montant recu maintenant'
                    : 'Montant paye maintenant'
                }
                value={paymentAmount}
                onChange={setPaymentAmount}
              />
            </div>
            {paymentError ? (
              <div className="mt-3 rounded-[18px] bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {paymentError}
              </div>
            ) : null}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPaymentContext(null)}
                disabled={isPaymentSaving}
                className="h-11 rounded-[16px] border border-black/10 bg-[#F4F5F1] px-4 text-xs font-bold text-[#4f5549] disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmPayment}
                disabled={isPaymentSaving}
                className="h-11 rounded-[16px] bg-[#11130f] px-4 text-xs font-bold text-white disabled:bg-black/30"
              >
                {isPaymentSaving
                  ? 'Confirmation...'
                  : paymentContext.direction === 'ISSUED'
                    ? 'Confirmer encaissement'
                    : 'Confirmer paiement'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function InvoiceTable({
  invoices,
  isLoading,
  maintenanceRequests,
  viewMode,
  onOpen,
  onPdf,
  onSupplierPdf,
  onRecordPayment,
  pdfLoadingId,
  onStatusChange,
}: {
  invoices: Invoice[]
  isLoading: boolean
  maintenanceRequests: MaintenanceRequestOption[]
  viewMode: InvoiceDirection | 'ALL'
  onOpen: (invoice: Invoice) => void
  onPdf: (invoice: Invoice) => void
  onSupplierPdf: (invoice: Invoice) => void
  onRecordPayment: (invoice: Invoice) => void
  pdfLoadingId: string | null
  onStatusChange: (invoice: Invoice, status: InvoiceStatus) => void
}) {
  if (isLoading) {
    return (
      <div className="mt-4 rounded-[24px] bg-[#F7F8F4] px-5 py-8 text-sm font-semibold text-[#6f766b]">
        Chargement des factures...
      </div>
    )
  }

  if (!invoices.length) {
    return (
      <div className="mt-4 rounded-[24px] border border-dashed border-black/10 bg-[#F7F8F4] px-5 py-8 text-sm font-semibold text-[#6f766b]">
        Aucune facture ne correspond aux filtres.
      </div>
    )
  }

  return (
    <>
      <div className="mt-4 hidden overflow-hidden rounded-[24px] border border-black/[0.06] lg:block">
        <table className="w-full border-collapse bg-white">
          <thead className="bg-[#F4F5F1]">
            <tr>
              {(viewMode === 'RECEIVED'
                ? [
                    'N facture fournisseur',
                    'Date facture',
                    'Fournisseur',
                    'Objet',
                    'Total HT',
                    'TVA',
                    'Total TTC',
                    'Restant a payer',
                    'Statut',
                    'Echeance',
                    'Actions',
                  ]
                : [
                    'N facture',
                    'Date',
                    'Client / fournisseur',
                    'Mission / objet',
                    'Reference',
                    'Total HT',
                    'TVA',
                    'Total TTC',
                    viewMode === 'ALL' ? 'Solde' : 'A recevoir',
                    'Statut',
                    'Echeance',
                    'Actions',
                  ]).map((heading) => (
                <th
                  key={heading}
                  className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-[#6f766b]"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id} className="border-t border-black/[0.055]">
                <td className="px-3 py-3 text-xs font-bold text-[#11130f]">
                  {invoiceDisplayNumber(invoice)}
                </td>
                <td className="px-3 py-3 text-xs font-semibold text-[#5f665b]">
                  {dateLabel(invoice.issueDate)}
                </td>
                <td className="max-w-[180px] px-3 py-3 text-xs font-semibold text-[#11130f]">
                  <span className="block truncate">
                    {invoice.direction === 'RECEIVED'
                      ? invoice.sellerName
                      : invoice.buyerName}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs font-semibold text-[#5f665b]">
                  {invoice.direction === 'RECEIVED'
                    ? invoice.missionDescription ?? '-'
                    : invoice.missionReference ?? '-'}
                </td>
                {viewMode !== 'RECEIVED' ? (
                  <td className="max-w-[160px] px-3 py-3 text-xs font-semibold text-[#5f665b]">
                    <span className="block truncate">
                      {invoice.clientReference ?? '-'}
                    </span>
                  </td>
                ) : null}
                <MoneyCell value={invoice.subtotalAmount} />
                <MoneyCell value={invoice.vatAmount} />
                <MoneyCell value={invoice.totalAmount} strong />
                {viewMode === 'RECEIVED' ? (
                  <MoneyCell
                    value={
                      invoice.status === 'REJECTED'
                        ? 0
                        : getRemainingAmount(invoice)
                    }
                    strong={getRemainingAmount(invoice) > 0}
                  />
                ) : (
                  <MoneyCell
                    value={getBalanceAmount(invoice)}
                    strong={getBalanceAmount(invoice) > 0}
                  />
                )}
                <td className="px-3 py-3">
                  <StatusBadge status={invoice.status} />
                </td>
                <td className="px-3 py-3 text-xs font-semibold text-[#5f665b]">
                  {dateLabel(invoice.dueDate)}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <ActionIconButton
                      label={invoice.direction === 'RECEIVED' ? 'Voir suivi' : 'Voir / modifier'}
                      icon="eye"
                      variant="dark"
                      onClick={() => onOpen(invoice)}
                    />
                    {invoice.direction === 'ISSUED' ? (
                      <ActionIconButton
                        label={pdfLoadingId === invoice.id ? 'Generation PDF' : 'Telecharger PDF'}
                        icon="file"
                        disabled={pdfLoadingId === invoice.id}
                        onClick={() => onPdf(invoice)}
                      />
                    ) : null}
                    {invoice.direction === 'RECEIVED' ? (
                      <ActionIconButton
                        label={invoice.sourcePdfUrl ? 'Ouvrir PDF fournisseur' : 'PDF manquant'}
                        icon="file"
                        disabled={!invoice.sourcePdfUrl}
                        onClick={() => onSupplierPdf(invoice)}
                      />
                    ) : null}
                    {invoice.direction === 'ISSUED' && invoice.status === 'DRAFT' ? (
                      <ActionIconButton label="Marquer emise" icon="check" onClick={() => onStatusChange(invoice, 'ISSUED')} />
                    ) : null}
                    {invoice.direction === 'ISSUED' && getBalanceAmount(invoice) > 0 ? (
                      <ActionIconButton label="Confirmer encaissement" icon="card" onClick={() => onStatusChange(invoice, 'PAID')} />
                    ) : null}
                    {invoice.direction === 'RECEIVED' && invoice.status === 'RECEIVED' ? (
                      <ActionIconButton label="Marquer a verifier" icon="clock" onClick={() => onStatusChange(invoice, 'TO_REVIEW')} />
                    ) : null}
                    {invoice.direction === 'RECEIVED' &&
                    ['RECEIVED', 'TO_REVIEW'].includes(invoice.status) ? (
                      <ActionIconButton label="Valider" icon="check" onClick={() => onStatusChange(invoice, 'APPROVED')} />
                    ) : null}
                    {invoice.direction === 'RECEIVED' && getRemainingAmount(invoice) > 0 ? (
                      <ActionIconButton label="Confirmer paiement" icon="card" onClick={() => onRecordPayment(invoice)} />
                    ) : null}
                    {invoice.direction === 'RECEIVED' &&
                    !['PAID', 'REJECTED'].includes(invoice.status) ? (
                      <ActionIconButton label="Rejeter" icon="x" variant="danger" onClick={() => onStatusChange(invoice, 'REJECTED')} />
                    ) : null}
                    {invoice.direction === 'ISSUED' && invoice.status !== 'CANCELLED' ? (
                      <ActionIconButton label="Annuler" icon="x" variant="muted" onClick={() => onStatusChange(invoice, 'CANCELLED')} />
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-3 lg:hidden">
        {invoices.map((invoice) => (
          <article
            key={invoice.id}
            className="rounded-[24px] border border-black/[0.055] bg-[#F7F8F4] p-4 text-left shadow-[0_14px_40px_rgba(17,18,15,0.045)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#11130f]">
                  {invoiceDisplayNumber(invoice)}
                </p>
                <p className="mt-1 truncate text-xs font-semibold text-[#6f766b]">
                  {invoice.direction === 'RECEIVED'
                    ? invoice.sellerName
                    : invoice.buyerName}
                </p>
              </div>
              <StatusBadge status={invoice.status} />
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="text-xs font-semibold text-[#6f766b]">
                {invoice.direction === 'RECEIVED' ? (
                  <p>Objet {invoice.missionDescription ?? '-'}</p>
                ) : null}
                <p>Echeance {dateLabel(invoice.dueDate)}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold tracking-[-0.04em] text-[#11130f]">
                  {money(invoice.totalAmount)}
                </p>
                {invoice.direction === 'RECEIVED' ? (
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#6f766b]">
                    Reste {money(getRemainingAmount(invoice))}
                  </p>
                ) : (
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#6f766b]">
                    A recevoir {money(getBalanceAmount(invoice))}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionIconButton
                label={invoice.direction === 'RECEIVED' ? 'Voir suivi' : 'Voir / modifier'}
                icon="eye"
                variant="dark"
                onClick={() => onOpen(invoice)}
              />
              {invoice.direction === 'ISSUED' ? (
                <ActionIconButton
                  label={pdfLoadingId === invoice.id ? 'Generation PDF' : 'Telecharger PDF'}
                  icon="file"
                  disabled={pdfLoadingId === invoice.id}
                  onClick={() => onPdf(invoice)}
                />
              ) : null}
              {invoice.direction === 'RECEIVED' ? (
                <ActionIconButton
                  label={invoice.sourcePdfUrl ? 'Ouvrir PDF fournisseur' : 'PDF manquant'}
                  icon="file"
                  disabled={!invoice.sourcePdfUrl}
                  onClick={() => onSupplierPdf(invoice)}
                />
              ) : null}
              {invoice.direction === 'RECEIVED' && invoice.status === 'RECEIVED' ? (
                <ActionIconButton label="Marquer a verifier" icon="clock" onClick={() => onStatusChange(invoice, 'TO_REVIEW')} />
              ) : null}
              {invoice.direction === 'RECEIVED' &&
              ['RECEIVED', 'TO_REVIEW'].includes(invoice.status) ? (
                <ActionIconButton label="Valider" icon="check" onClick={() => onStatusChange(invoice, 'APPROVED')} />
              ) : null}
              {invoice.direction === 'RECEIVED' && getRemainingAmount(invoice) > 0 ? (
                <ActionIconButton label="Confirmer paiement" icon="card" onClick={() => onRecordPayment(invoice)} />
              ) : null}
              {invoice.direction === 'ISSUED' && getBalanceAmount(invoice) > 0 ? (
                <ActionIconButton label="Confirmer encaissement" icon="card" onClick={() => onStatusChange(invoice, 'PAID')} />
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </>
  )
}

function InvoiceLineEditor({
  disabled,
  line,
  onChange,
  onRemove,
}: {
  disabled: boolean
  line: InvoiceLine
  onChange: (line: InvoiceLine) => void
  onRemove: () => void
}) {
  const totals = calculateLines([line])

  return (
    <div className="grid gap-2 rounded-[20px] border border-black/[0.055] bg-[#F7F8F4] p-3 xl:grid-cols-[1.2fr_1.4fr_88px_110px_88px_110px_42px] xl:items-end">
      <TextField label="Label" value={line.label} onChange={(value) => onChange({ ...line, label: value })} disabled={disabled} />
      <TextField label="Description" value={line.description} onChange={(value) => onChange({ ...line, description: value })} disabled={disabled} />
      <TextField label="Quantité" value={line.quantity} onChange={(value) => onChange({ ...line, quantity: value })} disabled={disabled} />
      <TextField label="Prix HT" value={line.unitPrice} onChange={(value) => onChange({ ...line, unitPrice: value })} disabled={disabled} />
      <TextField label="TVA %" value={line.vatRate} onChange={(value) => onChange({ ...line, vatRate: value })} disabled={disabled} />
      <div>
        <FieldLabel label="Total ligne" />
        <p className="mt-1 flex h-11 items-center justify-end rounded-[16px] bg-white px-3 text-sm font-bold text-[#11130f]">
          {money(totals.total)}
        </p>
      </div>
      {!disabled ? (
        <button
          type="button"
          onClick={onRemove}
          className="h-11 rounded-[16px] bg-red-50 text-sm font-bold text-red-700"
          aria-label="Supprimer ligne"
        >
          ×
        </button>
      ) : null}
    </div>
  )
}

function KpiCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-black/[0.04] bg-white p-4 shadow-[0_14px_40px_rgba(17,18,15,0.045)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8b9186]">
          {label}
        </p>
        <span className="rounded-full bg-[#F4F5F1] px-2 py-1 text-[9px] font-black text-[#6f766b]">
          {icon}
        </span>
      </div>
      <p className="mt-2 text-xl font-semibold tracking-[-0.04em] text-[#11130f]">
        {value}
      </p>
    </div>
  )
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="rounded-[24px] border border-black/[0.04] bg-white p-4 shadow-[0_14px_40px_rgba(17,18,15,0.045)]">
      <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-[#5f665b]">
        {title}
      </h4>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function TextField({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="block">
      <FieldLabel label={label} />
      <input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="field mt-1" />
    </label>
  )
}

function DateField({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="block">
      <FieldLabel label={label} />
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="field mt-1" />
    </label>
  )
}

function TextareaField({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="block">
      <FieldLabel label={label} />
      <textarea value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} rows={3} className="field mt-1 h-auto min-h-[88px] py-3" />
    </label>
  )
}

function FieldLabel({ label }: { label: string }) {
  return (
    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#7b8075]">
      {label}
    </span>
  )
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-[15px] border border-black/10 bg-white px-3 py-2 text-xs font-bold text-[#4f5549]">
      {label}
    </button>
  )
}

function TotalRow({ label, strong, value }: { label: string; strong?: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={strong ? 'text-[#11130f]' : 'text-[#6f766b]'}>{label}</span>
      <span className={strong ? 'text-lg text-[#11130f]' : 'text-[#11130f]'}>{value}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={['inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold', statusStyles[status]].join(' ')}>
      {statusLabels[status]}
    </span>
  )
}

function ActionIconButton({
  disabled,
  icon,
  label,
  onClick,
  variant = 'light',
}: {
  disabled?: boolean
  icon: 'eye' | 'file' | 'clock' | 'check' | 'card' | 'x'
  label: string
  onClick: () => void
  variant?: 'dark' | 'danger' | 'light' | 'muted'
}) {
  const variantClasses = {
    dark: 'bg-[#11130f] text-white border-[#11130f]',
    danger: 'bg-red-50 text-red-700 border-red-100',
    light: 'bg-white text-[#11130f] border-black/10',
    muted: 'bg-[#F4F5F1] text-[#5f665b] border-black/10',
  }

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] border shadow-[0_8px_18px_rgba(17,18,15,0.045)] transition hover:-translate-y-0.5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40',
        variantClasses[variant],
      ].join(' ')}
    >
      <IconGlyph icon={icon} />
    </button>
  )
}

function IconGlyph({ icon }: { icon: 'eye' | 'file' | 'clock' | 'check' | 'card' | 'x' }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2,
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      {icon === 'eye' ? (
        <>
          <path {...common} d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
          <circle {...common} cx="12" cy="12" r="2.5" />
        </>
      ) : null}
      {icon === 'file' ? (
        <>
          <path {...common} d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path {...common} d="M14 2v6h6M8 13h8M8 17h5" />
        </>
      ) : null}
      {icon === 'clock' ? (
        <>
          <circle {...common} cx="12" cy="12" r="9" />
          <path {...common} d="M12 7v5l3 2" />
        </>
      ) : null}
      {icon === 'check' ? <path {...common} d="m5 12 4 4L19 6" /> : null}
      {icon === 'card' ? (
        <>
          <rect {...common} x="3" y="5" width="18" height="14" rx="2" />
          <path {...common} d="M3 10h18M7 15h3" />
        </>
      ) : null}
      {icon === 'x' ? (
        <>
          <path {...common} d="M18 6 6 18M6 6l12 12" />
        </>
      ) : null}
    </svg>
  )
}

function invoiceDisplayNumber(invoice: Invoice) {
  if (invoice.direction === 'RECEIVED') {
    return invoice.externalInvoiceNumber || 'Sans numero fournisseur'
  }

  return invoice.invoiceNumber ?? 'Sans numero'
}

function getBalanceAmount(
  invoice:
    | Pick<
        Invoice,
        | 'totalAmount'
        | 'paidAmount'
        | 'balanceAmount'
        | 'remainingAmount'
        | 'amountToReceive'
        | 'direction'
        | 'status'
      >
    | PaymentContext
) {
  if ('balanceAmount' in invoice && typeof invoice.balanceAmount === 'number') {
    return Math.max(invoice.balanceAmount, 0)
  }

  if (
    'direction' in invoice &&
    invoice.direction === 'RECEIVED' &&
    'remainingAmount' in invoice &&
    typeof invoice.remainingAmount === 'number'
  ) {
    return Math.max(invoice.remainingAmount, 0)
  }

  if (
    'direction' in invoice &&
    invoice.direction === 'ISSUED' &&
    'amountToReceive' in invoice &&
    typeof invoice.amountToReceive === 'number'
  ) {
    return Math.max(invoice.amountToReceive, 0)
  }

  if ('status' in invoice && ['REJECTED', 'CANCELLED'].includes(invoice.status)) {
    return 0
  }

  return Math.max(invoice.totalAmount - invoice.paidAmount, 0)
}

function getRemainingAmount(
  invoice:
    | Pick<
        Invoice,
        | 'totalAmount'
        | 'paidAmount'
        | 'balanceAmount'
        | 'remainingAmount'
        | 'amountToReceive'
        | 'direction'
        | 'status'
      >
    | PaymentContext
) {
  if ('remainingAmount' in invoice && typeof invoice.remainingAmount === 'number') {
    return Math.max(invoice.remainingAmount, 0)
  }

  return getBalanceAmount(invoice)
}

function extractSupplierReference(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const match = value?.match(/\b(?:EXT|GAR)-[A-Z0-9]{4,}\b/i)

    if (match) {
      return match[0].toUpperCase()
    }
  }

  return null
}

function maintenanceLabel(
  maintenanceRequestId: string | null,
  maintenanceRequests: MaintenanceRequestOption[]
) {
  if (!maintenanceRequestId) {
    return '-'
  }

  const request = maintenanceRequests.find(
    (maintenanceRequest) => maintenanceRequest.id === maintenanceRequestId
  )

  return request
    ? `${request.plateNumber} - ${request.slInvoiceReference || request.status}`
    : maintenanceRequestId
}

function MoneyCell({ strong, value }: { strong?: boolean; value: number }) {
  return (
    <td className={['px-3 py-3 text-right text-xs font-bold', strong ? 'text-[#11130f]' : 'text-[#5f665b]'].join(' ')}>
      {money(value)}
    </td>
  )
}

function setFormValue<K extends keyof InvoiceFormState>(
  key: K,
  value: InvoiceFormState[K],
  setForm: React.Dispatch<React.SetStateAction<InvoiceFormState>>
) {
  setForm((currentForm) => ({ ...currentForm, [key]: value }))
}

function setReceivedAmountValue(
  key: 'subtotalAmount' | 'vatAmount',
  value: string,
  setForm: React.Dispatch<React.SetStateAction<InvoiceFormState>>
) {
  setForm((currentForm) => {
    const nextForm = {
      ...currentForm,
      [key]: value,
    }
    const subtotal = numberInput(nextForm.subtotalAmount, 0)
    const vat = numberInput(nextForm.vatAmount, 0)

    return {
      ...nextForm,
      totalAmount: String(Number((subtotal + vat).toFixed(2))),
    }
  })
}

function addPresetLine(
  label: string,
  setForm: React.Dispatch<React.SetStateAction<InvoiceFormState>>
) {
  setForm((currentForm) => ({
    ...currentForm,
    lines: [
      ...currentForm.lines,
      {
        label,
        description: label === 'Ligne libre' ? '' : label,
        quantity: '1',
        unitPrice: '0',
        vatRate: '17',
        position: currentForm.lines.length,
      },
    ],
  }))
}

function updateLine(
  index: number,
  line: InvoiceLine,
  setForm: React.Dispatch<React.SetStateAction<InvoiceFormState>>
) {
  setForm((currentForm) => ({
    ...currentForm,
    lines: currentForm.lines.map((currentLine, currentIndex) =>
      currentIndex === index ? { ...line, position: index } : currentLine
    ),
  }))
}

function removeLine(
  index: number,
  setForm: React.Dispatch<React.SetStateAction<InvoiceFormState>>
) {
  setForm((currentForm) => ({
    ...currentForm,
    lines: currentForm.lines
      .filter((_line, currentIndex) => currentIndex !== index)
      .map((line, nextIndex) => ({ ...line, position: nextIndex })),
  }))
}

function isReceivedForm(form: InvoiceFormState) {
  return form.direction === 'RECEIVED'
}

function withIssuedDefaults(form: InvoiceFormState): InvoiceFormState {
  const issueDate = form.issueDate || formatDateInput(new Date())
  const dueDate = form.dueDate || formatDateInput(addDays(new Date(issueDate), 30))

  return {
    ...form,
    issueDate,
    dueDate,
    paymentTerms: form.paymentTerms || defaultSeller.paymentTerms,
  }
}

function withPaidDefaults(form: InvoiceFormState): InvoiceFormState {
  return {
    ...form,
    paidDate: form.paidDate || formatDateInput(new Date()),
  }
}

function getPdfFilename(
  response: Response,
  invoice: Pick<Invoice, 'id' | 'invoiceNumber'>
) {
  const disposition = response.headers.get('content-disposition') ?? ''
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i)

  if (filenameMatch?.[1]) {
    return filenameMatch[1]
  }

  const fallbackNumber = invoice.invoiceNumber || invoice.id
  return `Facture-${fallbackNumber}.pdf`
}

function invoiceToForm(invoice: Invoice): InvoiceFormState {
  return {
    id: invoice.id,
    direction: invoice.direction,
    invoiceNumber: invoice.invoiceNumber ?? '',
    externalInvoiceNumber: invoice.externalInvoiceNumber ?? '',
    status: invoice.status,
    missionId: invoice.missionId ?? '',
    missionIds: invoice.invoiceMissions?.map((item) => item.missionId) ?? (invoice.missionId ? [invoice.missionId] : []),
    maintenanceRequestId: invoice.maintenanceRequestId ?? '',
    issueDate: dateInputLabel(invoice.issueDate),
    dueDate: dateInputLabel(invoice.dueDate),
    paidDate: dateInputLabel(invoice.paidDate),
    sellerName: invoice.sellerName,
    sellerAddress: invoice.sellerAddress ?? '',
    sellerVatNumber: invoice.sellerVatNumber ?? '',
    sellerIban: invoice.sellerIban ?? '',
    sellerBic: invoice.sellerBic ?? '',
    sellerBankName: invoice.sellerBankName ?? '',
    sellerBeneficiary: invoice.sellerBeneficiary ?? '',
    buyerName: invoice.buyerName,
    buyerAddress: invoice.buyerAddress ?? '',
    buyerVatNumber: invoice.buyerVatNumber ?? '',
    buyerEmail: invoice.buyerEmail ?? '',
    missionReference: invoice.missionReference ?? '',
    clientReference: invoice.clientReference ?? '',
    missionDescription: invoice.missionDescription ?? '',
    paymentTerms: invoice.paymentTerms ?? '',
    notes: invoice.notes ?? '',
    sourcePdfUrl: invoice.sourcePdfUrl ?? '',
    sourcePdfFileName: invoice.sourcePdfFileName ?? '',
    sourcePdfMimeType: invoice.sourcePdfMimeType ?? '',
    subtotalAmount: String(invoice.subtotalAmount ?? 0),
    vatAmount: String(invoice.vatAmount ?? 0),
    totalAmount: String(invoice.totalAmount ?? 0),
    paidAmount: String(invoice.paidAmount ?? 0),
    lines: invoice.lines.map((line) => ({
      id: line.id,
      label: line.label,
      description: line.description ?? '',
      quantity: String(line.quantity),
      unitPrice: String(line.unitPrice),
      vatRate: String(line.vatRate),
      position: line.position,
      subtotalAmount: line.subtotalAmount,
      vatAmount: line.vatAmount,
      totalAmount: line.totalAmount,
    })),
  }
}

function calculateLines(lines: InvoiceLine[]) {
  return lines.reduce(
    (totals, line) => {
      const quantity = numberInput(line.quantity, 1)
      const unitPrice = numberInput(line.unitPrice, 0)
      const vatRate = numberInput(line.vatRate, 17)
      const subtotal = quantity * unitPrice
      const vat = (subtotal * vatRate) / 100

      return {
        subtotal: totals.subtotal + subtotal,
        vat: totals.vat + vat,
        total: totals.total + subtotal + vat,
      }
    },
    { subtotal: 0, vat: 0, total: 0 }
  )
}

function numberInput(value: string, fallback: number) {
  const parsedValue = Number(value.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

function money(value: number) {
  return new Intl.NumberFormat('fr-LU', {
    currency: 'EUR',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(value)
}

function dateLabel(value: string | null) {
  if (!value) {
    return '-'
  }

  return new Intl.DateTimeFormat('fr-LU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value))
}

function dateInputLabel(value: string | null) {
  if (!value) {
    return ''
  }

  return formatDateInput(new Date(value))
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + days)
  return nextDate
}
