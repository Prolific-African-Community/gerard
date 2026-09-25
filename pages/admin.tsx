import type { GetServerSideProps } from 'next'
import Head from 'next/head'
import { useRouter } from 'next/router'
import type { PlatformConfigurationSnapshot } from '@prolific/gerard-core'
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { AdminShell, Badge, Modal, Notice, SaveBar, SectionHeader, Surface, Switch, TextField, Toast, auditLabel, buttonClass, formatDate, formatRelative, headerLinkClass, inputClass, roleLabels } from '../components/admin/ui'
import { LogoutButton } from '../components/site/LogoutButton'
import { getPlatformUser } from '../lib/auth/platform-authorization'

const modules = ['PLANNING', 'MAP', 'PROFITABILITY', 'INVOICING', 'FLEET', 'MAINTENANCE', 'INTELLIGENCE', 'ASSISTANT'] as const
const moduleInfo: Record<string, { label: string; description: string }> = {
  PLANNING: { label: 'Planning', description: 'Planification des missions et affectations chauffeurs' },
  MAP: { label: 'Carte', description: 'Suivi cartographique et itinéraires' },
  PROFITABILITY: { label: 'Rentabilité', description: 'Analyse des marges par mission et par client' },
  INVOICING: { label: 'Facturation', description: 'Préparation et émission des factures' },
  FLEET: { label: 'Parc', description: 'Camions, remorques et chauffeurs' },
  MAINTENANCE: { label: 'Maintenance', description: 'Interventions et entretien des véhicules' },
  INTELLIGENCE: { label: 'Intelligence', description: 'Analyses et recommandations opérationnelles' },
  ASSISTANT: { label: 'Assistant', description: 'Assistant conversationnel pour les équipes' },
}
const roles = ['ORG_ADMIN', 'MANAGER', 'DISPATCHER', 'SECRETARY', 'ACCOUNTING', 'DRIVER', 'VIEWER'] as const
const statusInfo: Record<string, { label: string; tone: 'positive' | 'warning' | 'neutral' }> = { ACTIVE: { label: 'Active', tone: 'positive' }, SUSPENDED: { label: 'Suspendue', tone: 'warning' }, ARCHIVED: { label: 'Archivée', tone: 'neutral' } }
const environmentLabels: Record<string, string> = { production: 'Production', preview: 'Preview', staging: 'Préproduction', development: 'Développement' }
type IntegrationType = 'MAIL_INTAKE' | 'SL_AUTOMOTIVE'
type ConfigField = { key: string; label: string; kind: 'text' | 'number' | 'boolean'; placeholder?: string }
const integrationCatalog: { type: IntegrationType; name: string; purpose: string; fields: ConfigField[] }[] = [
  { type: 'MAIL_INTAKE', name: 'Réception e-mail', purpose: 'Importe les demandes de transport reçues dans une boîte mail.', fields: [
    { key: 'mailboxAddress', label: 'Adresse de la boîte', kind: 'text', placeholder: 'dispatch@client.com' },
    { key: 'host', label: 'Serveur IMAP', kind: 'text', placeholder: 'imap.client.com' },
    { key: 'port', label: 'Port', kind: 'number', placeholder: '993' },
    { key: 'folder', label: 'Dossier', kind: 'text', placeholder: 'INBOX' },
    { key: 'provider', label: 'Protocole', kind: 'text', placeholder: 'imap' },
    { key: 'limit', label: 'Messages par import', kind: 'number', placeholder: '50' },
    { key: 'secure', label: 'Connexion chiffrée (TLS)', kind: 'boolean' },
  ] },
  { type: 'SL_AUTOMOTIVE', name: 'SL Automotive', purpose: 'Reçoit les ordres de transport du système SL Automotive.', fields: [
    { key: 'apiBaseUrl', label: 'URL de l’API', kind: 'text', placeholder: 'https://…' },
    { key: 'providerName', label: 'Nom du fournisseur', kind: 'text', placeholder: 'SL Automotive' },
    { key: 'sourceCompany', label: 'Société source', kind: 'text' },
    { key: 'sourceSystem', label: 'Système source', kind: 'text' },
    { key: 'webhookEnabled', label: 'Réception par webhook', kind: 'boolean' },
  ] },
]
const workspaceTabs = [{ id: 'overview', label: 'Aperçu' }, { id: 'identity', label: 'Identité' }, { id: 'branding', label: 'Apparence' }, { id: 'modules', label: 'Modules' }, { id: 'integrations', label: 'Intégrations' }, { id: 'instance', label: 'Instance' }] as const
type WorkspaceTab = (typeof workspaceTabs)[number]['id']

type Metrics = { missions: number; drivers: number; trucks: number; trailers: number; invoices: number }
type Organization = { id: string; name: string; slug: string; status: string; enabledModules: string[]; displayName: string | null; logoUrl: string | null; accentColor: string | null; faviconUrl: string | null; applicationTitle: string | null; createdAt: string; updatedAt: string; memberCount: number; primaryAdmin: { firstName: string; lastName: string; username: string } | null; metrics: Metrics }
type Domain = { id: string; hostname: string; pathPrefix: string; isPrimary: boolean; isActive: boolean }
type Member = { id: string; role: string; createdAt: string; user: { id: string; firstName: string; lastName: string; username: string; email: string | null; isActive: boolean; createdAt: string } }
type Audit = { id: string; action: string; metadata: Record<string, unknown> | null; createdAt: string; actor: { firstName: string; lastName: string; username: string } }
type BillingConfig = { legalName: string; legalAddress: string | null; vatNumber: string | null; iban: string | null; bic: string | null; bankName: string | null; beneficiary: string | null; invoicePrefix: string | null; paymentTermsDays: number | null; billingEmail: string | null }
type Integration = { type: IntegrationType; enabled: boolean; configJson: Record<string, unknown>; secretConfigured: boolean; updatedAt?: string }
type Detail = Organization & { users: Member[]; platformAuditLogs: Audit[]; domains: Domain[]; billingConfig: BillingConfig | null; integrations: Integration[] }
type Instance = { client: string; application: string; applicationType: 'STANDARD' | 'CUSTOM'; coreVersion: string; compatibleCore: string; environment: string; organizationId: string; domain?: string; publicUrl: string | null; adminUrl: string | null; status: string; lastCompatibilityStatus: string; deploymentReference?: string; configurationEndpoint?: string; cutoverAt?: string }
type Dashboard = { organizations: Organization[]; instances: Instance[]; platformRole: 'SUPER_ADMIN' | 'PLATFORM_SUPPORT' }
type AvailableUser = { id: string; firstName: string; lastName: string; username: string; email: string | null }

// Workspace view of the normalised configuration snapshot (read locally for Standard, over the signed channel for Custom).
type Configuration = { name: string; displayName: string | null; applicationTitle: string | null; accentColor: string | null; logoUrl: string | null; faviconUrl: string | null; enabledModules: string[]; integrations: Partial<Record<IntegrationType, Integration>>; readAt: string }
type Save = (kind: 'identity' | 'branding' | 'modules', payload: Record<string, unknown>) => Promise<void>
type SaveIntegration = (type: IntegrationType, change: { enabled?: boolean; configJson?: Record<string, unknown>; secretRef?: string }) => Promise<void>
type Target = { kind: 'standard'; id: string } | { kind: 'custom'; application: string }
type Confirmation = { title: string; body: ReactNode; confirm: string; destructive?: boolean; run: () => Promise<void> }

const errorText = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback
const customErrors: Record<string, string> = {
  'Platform instance channel unavailable': 'Le canal de configuration n’est pas configuré sur cet environnement.',
  'Platform preview identity unavailable': 'Identité Preview indisponible : la requête signée n’a pas pu être émise.',
  'Custom configuration unavailable': 'L’instance n’a pas répondu.',
  'Custom instance unavailable': 'Cette instance n’accepte pas de configuration depuis cet environnement.',
}
const customCodes: Record<string, string> = { FORBIDDEN_CONFIGURATION_FIELD: 'Champ non autorisé par l’instance.', INVALID_BRANDING: 'Apparence refusée : vérifiez la couleur (#RRGGBB) et les URL.', INVALID_MODULES: 'Liste de modules refusée.', INVALID_INTEGRATION: 'Intégration inconnue de l’instance.', SECRET_FIELD_FORBIDDEN: 'Les secrets ne transitent jamais par ce canal.', LOCAL_AUDIT_ACTOR_NOT_FOUND: 'L’instance n’a aucun administrateur actif pour tracer la modification.', ORGANIZATION_NOT_FOUND: 'Organisation introuvable sur l’instance.' }

async function call(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(customCodes[body.code] || customErrors[body.error] || body.error || 'Opération impossible')
  return body
}

const fromSnapshot = (snapshot: PlatformConfigurationSnapshot): Configuration => ({
  ...snapshot.identity, ...snapshot.branding, enabledModules: snapshot.enabledModules,
  integrations: Object.fromEntries(snapshot.integrations.map((item) => [item.type, item as Integration])),
  readAt: new Date().toISOString(),
})

export default function PlatformAdminPage({ accessDenied = false }: { accessDenied?: boolean }) {
  const router = useRouter()
  const [data, setData] = useState<Dashboard | null>(null)
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const canWrite = data?.platformRole === 'SUPER_ADMIN'

  const loadDashboard = useCallback(async () => {
    try { const response = await fetch('/api/platform/organizations'); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Chargement impossible'); setData(body) } catch (cause) { setLoadError(errorText(cause, 'Chargement impossible')) }
  }, [])
  useEffect(() => { if (!accessDenied) void loadDashboard() }, [accessDenied, loadDashboard])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer) }, [toast])

  const query = router.query
  const target: Target | null = typeof query.org === 'string' ? { kind: 'standard', id: query.org } : typeof query.instance === 'string' ? { kind: 'custom', application: query.instance } : null
  const tab = (workspaceTabs.some((item) => item.id === query.tab) ? query.tab : 'overview') as WorkspaceTab
  const go = (next: Record<string, string>) => void router.push({ pathname: '/admin', query: next }, undefined, { shallow: true })

  if (accessDenied) return <main className="gerard-admin flex min-h-screen items-center justify-center bg-[#f4f5f1] p-6"><section className="w-full max-w-sm rounded-2xl border border-black/[.08] bg-white p-6 text-center"><h1 className="text-lg font-semibold">Accès réservé</h1><p className="mt-2 text-sm text-black/60">Cette zone est réservée aux rôles plateforme Gerard.</p><a className={`${buttonClass.primary} mt-5`} href="/dispatch">Retour au dispatch</a></section></main>

  const standardInstance = data?.instances.find((item) => item.applicationType === 'STANDARD')
  const customInstance = target?.kind === 'custom' ? data?.instances.find((item) => item.application === target.application && item.applicationType === 'CUSTOM') : undefined
  const standardSummary = target?.kind === 'standard' ? data?.organizations.find((item) => item.id === target.id) : undefined
  const workspaceName = customInstance?.client || standardSummary?.displayName || standardSummary?.name
  const mark = <span aria-hidden className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#C8FF00] text-sm font-black text-black">G</span>
  const roleBadge = data && <span className={`hidden rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline-flex ${canWrite ? 'bg-white/20 text-white' : 'bg-amber-300 text-black'}`}>{canWrite ? 'Super admin' : 'Support · lecture seule'}</span>
  const actions = <><a href="/dispatch" className={headerLinkClass}>Dispatch</a><LogoutButton tone="dark" className="!h-8 !w-8 !rounded-md !shadow-none hover:!translate-y-0" /></>

  return <>
    <Head><title>{workspaceName ? `${workspaceName} · Gerard Platform` : 'Gerard Platform'}</title></Head>
    <AdminShell mark={mark} title="Gerard Platform" context={workspaceName ? `· ${workspaceName}` : 'Organisations et instances'} badge={roleBadge} actions={actions}
      leading={target ? <button onClick={() => go({})} className="-ml-1 flex shrink-0 items-center gap-1 self-center rounded-md px-1.5 py-1.5 text-sm font-medium text-black/70 hover:bg-black/[.05] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8eb800]" aria-label="Retour aux organisations"><span aria-hidden>←</span><span className="hidden sm:inline">Organisations</span></button> : undefined}
      tabs={target ? workspaceTabs : undefined} active={tab} onTab={(id) => go({ ...(target?.kind === 'standard' ? { org: target.id } : { instance: (target as { application: string }).application }), tab: id })}>
      {!data ? (loadError ? <Notice tone="error">{loadError}</Notice> : <div className="space-y-3"><div className="h-8 w-64 animate-pulse rounded bg-black/[.06]" /><div className="h-64 animate-pulse rounded-xl bg-black/[.04]" /></div>)
        : !target ? <Directory data={data} canWrite={canWrite} standardInstance={standardInstance} open={(next) => go(next.kind === 'standard' ? { org: next.id } : { instance: next.application })} create={() => setCreateOpen(true)} />
        : target.kind === 'custom' ? (customInstance ? <CustomWorkspace key={customInstance.application} instance={customInstance} tab={tab} canWrite={canWrite} notify={setToast} /> : <Notice tone="error">Instance introuvable dans le registre.</Notice>)
        : <StandardWorkspace key={target.id} id={target.id} instance={standardInstance} tab={tab} canWrite={canWrite} notify={setToast} refreshDirectory={loadDashboard} />}
    </AdminShell>
    {createOpen && <CreateOrganizationModal close={() => setCreateOpen(false)} created={async (id) => { setCreateOpen(false); await loadDashboard(); setToast('Organisation créée.'); go({ org: id }) }} />}
    {toast && <Toast text={toast} />}
  </>
}

// ─── Directory ───────────────────────────────────────────────────────────────

function Directory({ data, canWrite, standardInstance, open, create }: { data: Dashboard; canWrite: boolean; standardInstance?: Instance; open: (target: Target) => void; create: () => void }) {
  const customs = data.instances.filter((item) => item.applicationType === 'CUSTOM')
  return <>
    <SectionHeader title="Organisations" description="Choisissez une organisation pour configurer son identité, ses modules et ses intégrations." action={canWrite && <button onClick={create} className={buttonClass.accent}>＋ Nouvelle organisation</button>} />
    <div className="space-y-5">
      <Surface title="Gerard Custom" description="Applications dédiées : déploiement, base et identité propres.">
        <ul className="divide-y divide-black/[.05]">{customs.map((instance) => <li key={instance.application}><RowButton onClick={() => open({ kind: 'custom', application: instance.application })}
          title={instance.client} subtitle={instance.domain || instance.application} type="Custom" status={instance.status}
          meta={<><span>{environmentLabels[instance.environment] || instance.environment}</span><span>Core {instance.coreVersion}</span></>} /></li>)}
          {!customs.length && <li className="px-4 py-6 text-center text-sm text-black/60">Aucune instance Custom enregistrée.</li>}</ul>
      </Surface>
      <Surface title="Gerard Standard" description={standardInstance ? `Instance partagée · ${standardInstance.domain || ''} · Core ${standardInstance.coreVersion}` : 'Instance partagée'}>
        <ul className="divide-y divide-black/[.05]">{data.organizations.map((organization) => <li key={organization.id}><RowButton onClick={() => open({ kind: 'standard', id: organization.id })}
          title={organization.displayName || organization.name} subtitle={`/${organization.slug}`} type="Standard" status={organization.status}
          meta={<><span>{organization.memberCount} membre{organization.memberCount > 1 ? 's' : ''}</span><span>{organization.enabledModules.length}/{modules.length} modules</span></>} /></li>)}
          {!data.organizations.length && <li className="px-4 py-6 text-center text-sm text-black/60">Aucune organisation Standard.</li>}</ul>
      </Surface>
    </div>
  </>
}

function RowButton({ onClick, title, subtitle, type, status, meta }: { onClick: () => void; title: string; subtitle: string; type: 'Standard' | 'Custom'; status: string; meta: ReactNode }) {
  const info = statusInfo[status] || { label: status, tone: 'neutral' as const }
  return <button onClick={onClick} className="group grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition hover:bg-[#f7f8f4] focus-visible:bg-[#f7f8f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8eb800] md:grid-cols-[minmax(0,1.4fr)_110px_minmax(0,1fr)_auto]">
    <span className="min-w-0"><span className="block truncate text-sm font-semibold">{title}</span><span className="block truncate text-xs text-black/60">{subtitle}</span></span>
    <span className="hidden md:block"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${type === 'Custom' ? 'bg-[#11130f] text-[#C8FF00]' : 'bg-black/[.06] text-black/70'}`}>{type}</span></span>
    <span className="col-span-2 row-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/60 md:col-span-1 md:row-start-auto"><span className="md:hidden"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${type === 'Custom' ? 'bg-[#11130f] text-[#C8FF00]' : 'bg-black/[.06] text-black/70'}`}>{type}</span></span>{meta}</span>
    <span className="col-start-2 row-start-1 flex items-center gap-3 md:col-start-auto md:row-start-auto"><Badge tone={info.tone}>{info.label}</Badge><span aria-hidden className="text-black/30 transition group-hover:text-black/70">›</span></span>
  </button>
}

// ─── Workspaces ──────────────────────────────────────────────────────────────

function CustomWorkspace({ instance, tab, canWrite, notify }: { instance: Instance; tab: WorkspaceTab; canWrite: boolean; notify: (text: string) => void }) {
  const channel = Boolean(instance.configurationEndpoint) && instance.status === 'ACTIVE'
  const endpoint = `/api/platform/instances/${instance.application}/configuration`
  const [configuration, setConfiguration] = useState<Configuration | null>(null)
  const [loading, setLoading] = useState(channel)
  const [loadError, setLoadError] = useState('')
  // Every value shown comes from the instance itself, through the Platform backend; there is no fallback.
  const read = useCallback(async () => fromSnapshot((await call(endpoint, { method: 'POST', body: JSON.stringify({ action: 'getConfiguration' }) })).configuration), [endpoint])
  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try { setConfiguration(await read()) } catch (cause) { setConfiguration(null); setLoadError(errorText(cause, 'Configuration indisponible')) } finally { setLoading(false) }
  }, [read])
  useEffect(() => { if (channel) void load() }, [channel, load])

  // Writes are confirmed by reading the instance back, never by trusting the local draft.
  const send = async (action: string, payload: Record<string, unknown>) => {
    try { await call(endpoint, { method: 'POST', body: JSON.stringify({ action, payload }) }) } catch (cause) { throw new Error(`${errorText(cause, 'Modification refusée.')} Aucune modification n’a été confirmée.`) }
    try { setConfiguration(await read()) } catch (cause) { setConfiguration(null); setLoadError(errorText(cause, 'Configuration indisponible')); throw new Error('Modification envoyée, mais la relecture de l’instance a échoué. Rechargez avant toute autre modification.') }
    notify(`Modification confirmée par ${instance.client}.`)
  }
  const save: Save = (kind, payload) => send(kind === 'identity' ? 'updateIdentity' : kind === 'branding' ? 'updateBranding' : 'updateModules', kind === 'identity' ? Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, value === '' ? null : value])) : payload)
  const saveIntegration: SaveIntegration = (type, change) => change.enabled !== undefined ? send('updateIntegrationEnabled', { type, enabled: change.enabled }) : send('updateIntegrationConfig', { type, configJson: change.configJson })

  const notes = !channel ? <Notice tone="warning">Le canal de configuration de {instance.client} n’est pas disponible depuis cet environnement : sa configuration ne peut être ni lue ni modifiée.</Notice>
    : !canWrite ? <Notice tone="info">Mode support : consultation uniquement.</Notice> : null
  const unavailable = loading ? <div className="space-y-3" aria-busy="true"><p className="text-sm text-black/60">Lecture de la configuration de {instance.client}…</p><div className="h-48 animate-pulse rounded-xl bg-black/[.04]" /></div>
    : <div className="space-y-3"><Notice tone="error">Configuration de {instance.client} indisponible : {(loadError || 'canal non disponible').replace(/\.$/, '')}. Aucune modification n’est possible tant qu’elle n’a pas été lue.</Notice>{channel && <button onClick={() => void load()} className={buttonClass.secondary}>Réessayer</button>}</div>
  const shared = configuration && { configuration, canWrite: canWrite && channel, custom: true, save, saveIntegration }
  return <>
    <WorkspaceHeader title={instance.client} type="Custom" status={instance.status} subtitle={instance.domain || instance.application} />
    {notes && <div className="mb-4">{notes}</div>}
    {tab === 'overview' && <Overview configuration={configuration} custom instance={instance} unavailable={!configuration ? unavailable : undefined} />}
    {tab === 'instance' && <InstancePanel instance={instance} />}
    {tab !== 'overview' && tab !== 'instance' && (!shared ? unavailable : <>
      {tab === 'identity' && <IdentityForm {...shared} />}
      {tab === 'branding' && <BrandingForm {...shared} />}
      {tab === 'modules' && <ModulesForm {...shared} />}
      {tab === 'integrations' && <IntegrationsList {...shared} />}
    </>)}
  </>
}

function StandardWorkspace({ id, instance, tab, canWrite, notify, refreshDirectory }: { id: string; instance?: Instance; tab: WorkspaceTab; canWrite: boolean; notify: (text: string) => void; refreshDirectory: () => Promise<void> }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([])
  const [configuration, setConfiguration] = useState<Configuration | null>(null)
  const [loadError, setLoadError] = useState('')
  const load = useCallback(async () => {
    try { const body = await call(`/api/platform/organizations/${id}`, { method: 'GET' }); setDetail(body.organization); setConfiguration(fromSnapshot(body.configuration)); setAvailableUsers(body.availableUsers || []) } catch (cause) { setLoadError(errorText(cause, 'Chargement impossible')) }
  }, [id])
  useEffect(() => { void load() }, [load])
  if (!detail || !configuration) return loadError ? <Notice tone="error">{loadError}</Notice> : <div className="h-64 animate-pulse rounded-xl bg-black/[.04]" />

  const mutate = async (url: string, init: RequestInit, success: string) => { await call(url, init); await load(); await refreshDirectory(); notify(success) }
  const save: Save = (kind, payload) => mutate(`/api/platform/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }, kind === 'identity' ? 'Identité enregistrée.' : kind === 'branding' ? 'Apparence enregistrée.' : 'Modules enregistrés.')
  const saveIntegration: SaveIntegration = (type, change) => {
    const current = configuration.integrations[type]
    return mutate(`/api/platform/organizations/${id}/integrations`, { method: 'PUT', body: JSON.stringify({ type, enabled: change.enabled ?? current?.enabled ?? false, configJson: change.configJson ?? current?.configJson ?? {}, ...(change.secretRef ? { secretRef: change.secretRef } : {}) }) }, 'Intégration enregistrée.')
  }
  const shared = { configuration, canWrite, custom: false, save, saveIntegration }
  return <>
    <WorkspaceHeader title={detail.displayName || detail.name} type="Standard" status={detail.status} subtitle={`/${detail.slug}`} />
    {!canWrite && <div className="mb-4"><Notice tone="info">Mode support : consultation uniquement.</Notice></div>}
    {tab === 'overview' && <Overview configuration={configuration} instance={instance} detail={detail} canWrite={canWrite} availableUsers={availableUsers} mutate={mutate} />}
    {tab === 'identity' && <><IdentityForm {...shared} /><BillingForm detail={detail} canWrite={canWrite} mutate={mutate} /></>}
    {tab === 'branding' && <BrandingForm {...shared} />}
    {tab === 'modules' && <ModulesForm {...shared} />}
    {tab === 'integrations' && <IntegrationsList {...shared} />}
    {tab === 'instance' && <><StandardSettings detail={detail} canWrite={canWrite} mutate={mutate} />{instance && <div className="mt-5"><InstancePanel instance={instance} /></div>}</>}
  </>
}

function WorkspaceHeader({ title, type, status, subtitle }: { title: string; type: 'Standard' | 'Custom'; status: string; subtitle: string }) {
  const info = statusInfo[status] || { label: status, tone: 'neutral' as const }
  return <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1"><h1 className="text-xl font-semibold tracking-tight">{title}</h1><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${type === 'Custom' ? 'bg-[#11130f] text-[#C8FF00]' : 'bg-black/[.06] text-black/70'}`}>{type}</span><Badge tone={info.tone}>{info.label}</Badge><span className="w-full text-sm text-black/60 sm:w-auto">{subtitle}</span></div>
}

// ─── Overview ────────────────────────────────────────────────────────────────

function Overview({ configuration, instance, detail, custom = false, canWrite = false, availableUsers = [], mutate, unavailable }: { configuration: Configuration | null; unavailable?: ReactNode; instance?: Instance; detail?: Detail; custom?: boolean; canWrite?: boolean; availableUsers?: AvailableUser[]; mutate?: (url: string, init: RequestInit, success: string) => Promise<void> }) {
  const enabledIntegrations = integrationCatalog.filter((item) => configuration?.integrations[item.type]?.enabled)
  const facts: [string, ReactNode][] = [
    ['Type', custom ? 'Gerard Custom' : 'Gerard Standard'],
    ['Environnement', instance ? environmentLabels[instance.environment] || instance.environment : '—'],
    ['Version Core', instance ? <span key="core">{instance.coreVersion} <span className="text-black/60">· {instance.lastCompatibilityStatus === 'COMPATIBLE' ? 'compatible' : instance.lastCompatibilityStatus.toLowerCase()}</span></span> : '—'],
    ['Adresse', instance?.publicUrl ? <a key="url" href={instance.publicUrl} target="_blank" rel="noreferrer" className="font-medium text-[#4d6600] underline-offset-2 hover:underline">{instance.domain}</a> : '—'],
  ]
  return <div className="space-y-5">
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-black/[.08] bg-white lg:grid-cols-4">{facts.map(([label, value], index) => <div key={label} className={`min-w-0 border-black/[.06] px-4 py-3 ${index % 2 ? 'border-l' : ''} ${index > 1 ? 'border-t lg:border-t-0' : ''} ${index === 2 ? 'lg:border-l' : ''}`}><p className="text-xs font-medium text-black/60">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>)}</div>
    <div className="grid gap-5 lg:grid-cols-2">
      <Surface title="Configuration" description={custom && configuration ? `Lue sur l’instance ${formatRelative(configuration.readAt).toLowerCase()}` : undefined}>
        {!configuration ? <div className="p-4">{unavailable}</div> : <dl className="divide-y divide-black/[.05] text-sm">
          <Fact label="Nom affiché" value={configuration.displayName || '—'} />
          <Fact label="Titre de l’application" value={configuration.applicationTitle || '—'} />
          <Fact label="Couleur d’accent" value={configuration.accentColor ? <span className="inline-flex items-center gap-2 font-mono text-xs"><span aria-hidden className="h-3 w-3 rounded-sm border border-black/10" style={{ background: configuration.accentColor }} />{configuration.accentColor}</span> : '—'} />
          <Fact label="Modules actifs" value={`${configuration.enabledModules.length} sur ${modules.length}`} />
          <Fact label="Intégrations actives" value={enabledIntegrations.length ? enabledIntegrations.map((item) => item.name).join(', ') : 'Aucune'} />
        </dl>}
      </Surface>
      {detail ? <Surface title="Activité" description="Données opérationnelles de l’organisation">
        <dl className="grid grid-cols-3 gap-px bg-black/[.05] text-sm sm:grid-cols-5">{Object.entries(detail.metrics).map(([key, value]) => <div key={key} className="bg-white px-3 py-3"><dt className="text-xs text-black/60">{({ missions: 'Missions', drivers: 'Chauffeurs', trucks: 'Camions', trailers: 'Remorques', invoices: 'Factures' } as Record<string, string>)[key]}</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl>
      </Surface> : <Surface title="Accès et membres"><p className="px-4 py-4 text-sm leading-6 text-black/70">Les membres de {instance?.client} sont gérés par ses administrateurs dans leur propre espace.{instance?.adminUrl && <> <a href={instance.adminUrl} target="_blank" rel="noreferrer" className="font-medium text-[#4d6600] underline-offset-2 hover:underline">Ouvrir l’administration de l’organisation ↗</a></>}</p></Surface>}
    </div>
    {detail && mutate && <MembersPanel detail={detail} canWrite={canWrite} availableUsers={availableUsers} mutate={mutate} />}
    {detail && <Surface title="Historique récent"><ul className="divide-y divide-black/[.05]">{detail.platformAuditLogs.slice(0, 6).map((item) => <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm"><div className="min-w-0"><p className="font-medium">{platformAuditLabel(item)}</p><p className="truncate text-xs text-black/60">par {`${item.actor.firstName} ${item.actor.lastName}`.trim() || item.actor.username}</p></div><time className="shrink-0 text-xs text-black/60" title={formatDate(item.createdAt)}>{formatRelative(item.createdAt)}</time></li>)}{!detail.platformAuditLogs.length && <li className="px-4 py-6 text-center text-sm text-black/60">Aucune action enregistrée.</li>}</ul></Surface>}
  </div>
}

function platformAuditLabel(item: Audit) {
  const meta = item.metadata || {}
  if (meta.source === 'PLATFORM_INSTANCE_CONFIGURATION') return `Configuration envoyée à ${String(meta.targetApplication)}${meta.success === false ? ' (refusée)' : ''}`
  if (meta.kind === 'USER_IDENTITY_UPDATED') return 'Identité d’un membre modifiée'
  return auditLabel(item.action)
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex items-center justify-between gap-4 px-4 py-2.5"><dt className="text-black/60">{label}</dt><dd className="min-w-0 truncate text-right font-medium">{value}</dd></div>
}

// ─── Identity & branding ─────────────────────────────────────────────────────

type FormProps = { configuration: Configuration; canWrite: boolean; custom: boolean; save: Save; saveIntegration: SaveIntegration }

// Drafts start from the last configuration read; only changed fields are sent.
function useDraft<T extends Record<string, string>>(fields: (keyof T)[], configuration: Configuration) {
  const initial = useMemo(() => Object.fromEntries(fields.map((key) => [key, (configuration[key as keyof Configuration] as string | null) ?? ''])) as T, [configuration]) // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<T>(initial)
  useEffect(() => setDraft(initial), [initial])
  const changed = fields.filter((key) => draft[key].trim() !== initial[key])
  // Cleared fields are sent as '' (the Standard API maps it to null); the Custom save maps them to null itself.
  const payload = Object.fromEntries(changed.map((key) => [key, draft[key].trim()]))
  return { draft, setDraft, reset: () => setDraft(initial), dirty: changed.length > 0, payload }
}

function useSubmit(run: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event?: FormEvent) => { event?.preventDefault(); setBusy(true); setError(''); try { await run() } catch (cause) { setError(errorText(cause, 'Enregistrement impossible')) } finally { setBusy(false) } }
  return { busy, error, submit, setError }
}

function IdentityForm({ configuration, canWrite, custom, save }: FormProps) {
  const fields = custom ? ['displayName', 'applicationTitle'] : ['name', 'displayName', 'applicationTitle']
  const { draft, setDraft, reset, dirty, payload } = useDraft<Record<string, string>>(fields, configuration)
  const { busy, error, submit } = useSubmit(() => save('identity', payload))
  return <form onSubmit={submit}><Surface title="Identité" description="Nom et titre affichés aux utilisateurs de l’application." footer={canWrite && <SaveBar dirty={dirty} busy={busy} onReset={reset} />}>
    <div className="grid gap-3 p-4 sm:grid-cols-2">
      {!custom && <TextField label="Nom de l’organisation" value={draft.name} set={(name) => setDraft({ ...draft, name })} disabled={!canWrite} required hint="Nom interne, visible dans la plateforme." />}
      <TextField label="Nom affiché" value={draft.displayName} set={(displayName) => setDraft({ ...draft, displayName })} disabled={!canWrite} placeholder={configuration.name} />
      <TextField label="Titre de l’application" value={draft.applicationTitle} set={(applicationTitle) => setDraft({ ...draft, applicationTitle })} disabled={!canWrite} placeholder="Titre par défaut de l’application" hint="Affiché dans l’onglet du navigateur." />
    </div>
    {error && <div className="px-4 pb-3"><Notice tone="error">{error}</Notice></div>}
  </Surface></form>
}

function BrandingForm({ configuration, canWrite, save }: FormProps) {
  const { draft, setDraft, reset, dirty, payload } = useDraft<Record<string, string>>(['accentColor', 'logoUrl', 'faviconUrl'], configuration)
  const { busy, error, submit } = useSubmit(() => save('branding', payload))
  const accent = /^#[0-9a-f]{6}$/i.test(draft.accentColor) ? draft.accentColor : '#C8FF00'
  const name = configuration.displayName || configuration.name
  return <form onSubmit={submit}><Surface title="Apparence" description="Couleur et logos de l’application. Un champ vide reprend l’apparence par défaut de l’application." footer={canWrite && <SaveBar dirty={dirty} busy={busy} onReset={reset} disabled={Boolean(draft.accentColor) && !/^#[0-9a-f]{6}$/i.test(draft.accentColor)} />}>
    <div className="grid gap-6 p-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        <label className="block"><span className="text-xs font-medium text-black/70">Couleur d’accent</span><div className="mt-1 flex gap-2"><input type="color" aria-label="Choisir la couleur d’accent" disabled={!canWrite} value={accent} onChange={(e) => setDraft({ ...draft, accentColor: e.target.value.toUpperCase() })} className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-black/10 bg-white p-1 disabled:cursor-not-allowed" /><input aria-label="Code couleur" disabled={!canWrite} value={draft.accentColor} onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })} placeholder="Couleur par défaut" className={`${inputClass} font-mono disabled:bg-black/[.03]`} /></div>{draft.accentColor && !/^#[0-9a-f]{6}$/i.test(draft.accentColor) && <span className="mt-1 block text-xs font-medium text-red-700">Format attendu : #RRGGBB</span>}</label>
        <TextField label="Logo" value={draft.logoUrl} set={(logoUrl) => setDraft({ ...draft, logoUrl })} disabled={!canWrite} placeholder="https://… ou /logo.png" />
        <TextField label="Favicon" value={draft.faviconUrl} set={(faviconUrl) => setDraft({ ...draft, faviconUrl })} disabled={!canWrite} placeholder="https://… ou /favicon.ico" />
      </div>
      <div><p className="mb-1 text-xs font-medium text-black/70">Aperçu</p>
        <div className="overflow-hidden rounded-lg border border-black/[.08]" aria-hidden>
          <div className="flex items-center gap-2 bg-[#11130f] px-3 py-2.5 text-white">{draft.logoUrl ? <img src={draft.logoUrl} alt="" className="h-6 w-6 rounded bg-white object-contain p-0.5" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-black text-black" style={{ background: accent }}>{name[0]?.toUpperCase()}</span>}<span className="truncate text-sm font-semibold">{name}</span></div>
          <div className="space-y-2 bg-[#f4f5f1] p-3"><div className="h-2 w-2/3 rounded bg-black/10" /><div className="h-2 w-1/2 rounded bg-black/[.07]" /><span className="mt-1 inline-flex rounded-md px-2.5 py-1 text-xs font-semibold text-black" style={{ background: accent }}>Action principale</span></div>
          <div className="flex items-center gap-2 border-t border-black/[.06] bg-white px-3 py-2 text-xs text-black/60">{draft.faviconUrl && <img src={draft.faviconUrl} alt="" className="h-3.5 w-3.5" onError={(e) => { e.currentTarget.style.display = 'none' }} />}<span className="truncate">{configuration.applicationTitle || 'Titre par défaut'}</span></div>
        </div>
      </div>
    </div>
    {error && <div className="px-4 pb-3"><Notice tone="error">{error}</Notice></div>}
  </Surface></form>
}

// ─── Modules ─────────────────────────────────────────────────────────────────

function ModulesForm({ configuration, canWrite, save }: FormProps) {
  const initial = configuration.enabledModules
  const [selected, setSelected] = useState<string[]>(initial)
  useEffect(() => setSelected(initial), [initial])
  const dirty = [...selected].sort().join() !== [...initial].sort().join()
  // updateModules replaces the whole list; it is always built from the list just read from the organization.
  const { busy, error, submit } = useSubmit(() => save('modules', { enabledModules: selected }))
  return <form onSubmit={submit}><Surface title="Modules" description="Fonctionnalités accessibles aux utilisateurs de l’organisation. Un module désactivé est refusé côté serveur." footer={canWrite && <SaveBar dirty={dirty} busy={busy} onReset={() => setSelected(initial)} disabled={!selected.length} />}>
    <ul className="divide-y divide-black/[.05]">{modules.map((module) => { const active = selected.includes(module); return <li key={module} className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0"><p className="text-sm font-medium">{moduleInfo[module].label}</p><p className="text-xs text-black/60">{moduleInfo[module].description}</p></div>
      <div className="flex shrink-0 items-center gap-3"><span className={`hidden text-xs font-medium sm:inline ${active ? 'text-[#3d5200]' : 'text-black/50'}`}>{active ? 'Actif' : 'Inactif'}</span><Switch label={`${moduleInfo[module].label} ${active ? 'actif' : 'inactif'}`} checked={active} disabled={!canWrite || busy} onChange={(on) => setSelected(on ? [...selected, module] : selected.filter((item) => item !== module))} /></div>
    </li> })}</ul>
    {!selected.length && <div className="px-4 pb-3"><Notice tone="warning">Au moins un module doit rester actif.</Notice></div>}
    {error && <div className="px-4 pb-3"><Notice tone="error">{error}</Notice></div>}
  </Surface></form>
}

// ─── Integrations ────────────────────────────────────────────────────────────

function IntegrationsList(props: FormProps) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  return <div className="space-y-5">
    {integrationCatalog.map((entry) => <IntegrationCard key={entry.type} entry={entry} {...props} confirm={setConfirmation} />)}
    <p className="text-xs text-black/60">Mots de passe, clés d’API et références de secret ne sont jamais affichés.{props.custom ? ' Pour une instance Custom, les secrets restent dans son propre gestionnaire et ne transitent pas par la plateforme.' : ''}</p>
    {confirmation && <ConfirmModal value={confirmation} close={() => setConfirmation(null)} />}
  </div>
}

function IntegrationCard({ entry, configuration, canWrite, custom, saveIntegration, confirm }: FormProps & { entry: (typeof integrationCatalog)[number]; confirm: (value: Confirmation) => void }) {
  const current = configuration.integrations[entry.type]
  const initial = useMemo(() => Object.fromEntries(entry.fields.map((field) => [field.key, current?.configJson?.[field.key] === undefined || current?.configJson?.[field.key] === null ? (field.kind === 'boolean' ? false : '') : field.kind === 'boolean' ? Boolean(current.configJson[field.key]) : String(current.configJson[field.key])])) as Record<string, string | boolean>, [current, entry])
  const [draft, setDraft] = useState(initial)
  const [secretRef, setSecretRef] = useState('')
  useEffect(() => { setDraft(initial); setSecretRef('') }, [initial])
  const dirty = entry.fields.some((field) => draft[field.key] !== initial[field.key]) || Boolean(secretRef.trim())
  const configJson = Object.fromEntries(entry.fields.map((field) => [field.key, field.kind === 'number' ? (Number(draft[field.key]) || undefined) : draft[field.key]]))
  const { busy, error, submit, setError } = useSubmit(() => saveIntegration(entry.type, { configJson, ...(secretRef.trim() ? { secretRef: secretRef.trim() } : {}) }))
  const setEnabled = (enabled: boolean) => confirm({ title: `${enabled ? 'Activer' : 'Désactiver'} ${entry.name}`, confirm: enabled ? 'Activer' : 'Désactiver', destructive: !enabled, body: enabled ? <>L’intégration sera utilisée par l’organisation dès maintenant, avec la configuration enregistrée.</> : <>Les imports via {entry.name} s’arrêteront. La configuration est conservée.</>, run: async () => { setError(''); try { await saveIntegration(entry.type, { enabled }) } catch (cause) { setError(errorText(cause, 'Modification impossible')) } } })
  const status = !current ? <Badge tone="neutral">Non configurée</Badge> : current.enabled ? <Badge tone="positive">Activée</Badge> : <Badge tone="neutral">Désactivée</Badge>
  return <form onSubmit={submit}><Surface title={entry.name} description={entry.purpose} action={<div className="flex items-center gap-3">{status}{canWrite && <Switch label={`${entry.name} ${current?.enabled ? 'activée' : 'désactivée'}`} checked={Boolean(current?.enabled)} onChange={setEnabled} disabled={busy} />}</div>}
    footer={canWrite && <SaveBar dirty={dirty} busy={busy} onReset={() => { setDraft(initial); setSecretRef('') }} label="Enregistrer la configuration" />}>
    <div className="grid gap-3 p-4 sm:grid-cols-2">
      {entry.fields.map((field) => field.kind === 'boolean'
        ? <label key={field.key} className="flex items-center justify-between gap-3 rounded-lg border border-black/[.08] px-3 py-2 text-sm"><span>{field.label}</span><Switch label={field.label} checked={Boolean(draft[field.key])} disabled={!canWrite} onChange={(value) => setDraft({ ...draft, [field.key]: value })} /></label>
        : <TextField key={field.key} label={field.label} type={field.kind === 'number' ? 'number' : 'text'} value={String(draft[field.key] ?? '')} set={(value) => setDraft({ ...draft, [field.key]: value })} placeholder={field.placeholder} disabled={!canWrite} />)}
      <div className="flex items-center justify-between gap-3 rounded-lg bg-[#f7f8f4] px-3 py-2 text-sm sm:col-span-2"><span className="text-black/70">Secret d’accès</span>{current?.secretConfigured ? <Badge tone="positive">Configuré</Badge> : <Badge tone="warning">Non configuré</Badge>}</div>
      {!custom && canWrite && <div className="sm:col-span-2"><TextField label="Remplacer la référence du secret" value={secretRef} set={setSecretRef} placeholder="Laisser vide pour conserver le secret actuel" hint="Nom de la variable du gestionnaire de secrets, jamais la valeur elle-même." /></div>}
    </div>
    {error && <div className="px-4 pb-3"><Notice tone="error">{error}</Notice></div>}
  </Surface></form>
}

// ─── Instance ────────────────────────────────────────────────────────────────

function InstancePanel({ instance }: { instance: Instance }) {
  const rows: [string, ReactNode][] = [
    ['Application', instance.application], ['Client', instance.client], ['Type', instance.applicationType === 'CUSTOM' ? 'Gerard Custom' : 'Gerard Standard'],
    ['Environnement', environmentLabels[instance.environment] || instance.environment], ['Organisation', <code key="org" className="font-mono text-xs">{instance.organizationId}</code>],
    ['Version Core', instance.coreVersion], ['Compatibilité', `${instance.compatibleCore} · ${instance.lastCompatibilityStatus}`],
    ['Adresse publique', instance.publicUrl ? <a key="url" href={instance.publicUrl} target="_blank" rel="noreferrer" className="font-medium text-[#4d6600] underline-offset-2 hover:underline">{instance.domain} ↗</a> : '—'],
    ['Administration', instance.adminUrl ? <a key="admin" href={instance.adminUrl} target="_blank" rel="noreferrer" className="font-medium text-[#4d6600] underline-offset-2 hover:underline">/admin/organization ↗</a> : '—'],
    ...(instance.deploymentReference ? [['Déploiement de référence', <code key="dpl" className="font-mono text-xs">{instance.deploymentReference}</code>] as [string, ReactNode]] : []),
    ...(instance.cutoverAt ? [['Mise en service', formatDate(instance.cutoverAt)] as [string, ReactNode]] : []),
    ...(instance.applicationType === 'CUSTOM' ? [['Canal de configuration', instance.configurationEndpoint ? <Badge key="ch" tone="positive">Disponible</Badge> : <Badge key="ch" tone="warning">Indisponible sur cet environnement</Badge>] as [string, ReactNode]] : []),
  ]
  return <Surface title="Instance" description="Métadonnées du registre central Gerard. Lecture seule.">
    <dl className="divide-y divide-black/[.05] text-sm">{rows.map(([label, value]) => <Fact key={label} label={label} value={value} />)}</dl>
  </Surface>
}

function StandardSettings({ detail, canWrite, mutate }: { detail: Detail; canWrite: boolean; mutate: (url: string, init: RequestInit, success: string) => Promise<void> }) {
  const [value, setValue] = useState({ slug: detail.slug, status: detail.status })
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [domain, setDomain] = useState({ hostname: '', pathPrefix: '', isPrimary: false })
  useEffect(() => setValue({ slug: detail.slug, status: detail.status }), [detail])
  const dirty = value.slug !== detail.slug || value.status !== detail.status
  const { busy, error, submit } = useSubmit(() => mutate(`/api/platform/organizations/${detail.id}`, { method: 'PATCH', body: JSON.stringify(value) }, 'Organisation mise à jour.'))
  const confirmSubmit = (event: FormEvent) => { event.preventDefault(); if (value.status !== detail.status && value.status !== 'ACTIVE') setConfirmation({ title: value.status === 'SUSPENDED' ? 'Suspendre l’organisation' : 'Archiver l’organisation', confirm: value.status === 'SUSPENDED' ? 'Suspendre' : 'Archiver', destructive: true, body: <>Les utilisateurs de <strong>{detail.displayName || detail.name}</strong> perdront l’accès à l’application.</>, run: () => submit() }); else void submit() }
  const domainAction = useSubmit(async () => { await mutate(`/api/platform/organizations/${detail.id}/domains`, { method: 'POST', body: JSON.stringify(domain) }, 'Domaine ajouté.'); setDomain({ hostname: '', pathPrefix: '', isPrimary: false }) })
  const domainCall = (id: string, init: RequestInit, success: string) => { domainAction.setError(''); void mutate(`/api/platform/organizations/${detail.id}/domains/${id}`, init, success).catch((cause) => domainAction.setError(errorText(cause, 'Modification impossible'))) }
  return <div className="space-y-5">
    <form onSubmit={confirmSubmit}><Surface title="Organisation" description={`Créée le ${formatDate(detail.createdAt)}`} footer={canWrite && <SaveBar dirty={dirty} busy={busy} onReset={() => setValue({ slug: detail.slug, status: detail.status })} />}>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <TextField label="Identifiant (slug)" value={value.slug} set={(slug) => setValue({ ...value, slug })} disabled={!canWrite} mono required hint="Utilisé dans les URL internes." />
        <label className="block"><span className="text-xs font-medium text-black/70">Statut</span><select disabled={!canWrite} value={value.status} onChange={(e) => setValue({ ...value, status: e.target.value })} className={`${inputClass} mt-1 disabled:bg-black/[.03]`}>{Object.entries(statusInfo).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}</select></label>
      </div>
      {error && <div className="px-4 pb-3"><Notice tone="error">{error}</Notice></div>}
    </Surface></form>
    <Surface title="Domaines" description="Routage des adresses vers cette organisation. Aucune modification DNS n’est effectuée.">
      <ul className="divide-y divide-black/[.05]">{detail.domains.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="min-w-0"><span className="font-medium">{item.hostname}{item.pathPrefix}</span> <span className="ml-1 inline-flex gap-1">{item.isPrimary && <Badge tone="positive">Principal</Badge>}{!item.isActive && <Badge tone="neutral">Inactif</Badge>}</span></span>
        {canWrite && <span className="flex gap-1">{!item.isPrimary && <button onClick={() => domainCall(item.id, { method: 'PATCH', body: JSON.stringify({ isPrimary: true, isActive: true }) }, 'Domaine principal défini.')} className={buttonClass.ghost}>Définir principal</button>}<button onClick={() => domainCall(item.id, { method: 'PATCH', body: JSON.stringify({ isActive: !item.isActive }) }, 'Domaine mis à jour.')} className={buttonClass.ghost}>{item.isActive ? 'Désactiver' : 'Activer'}</button><button onClick={() => setConfirmation({ title: 'Supprimer le domaine', confirm: 'Supprimer', destructive: true, body: <><strong>{item.hostname}{item.pathPrefix}</strong> ne pointera plus vers cette organisation.</>, run: async () => domainCall(item.id, { method: 'DELETE' }, 'Domaine supprimé.') })} className={`${buttonClass.ghost} !text-red-700`}>Supprimer</button></span>}</li>)}
        {!detail.domains.length && <li className="px-4 py-4 text-sm text-black/60">Aucun domaine dédié.</li>}</ul>
      {canWrite && <form onSubmit={domainAction.submit} className="grid gap-3 border-t border-black/[.06] p-4 sm:grid-cols-[1fr_180px_auto_auto] sm:items-end"><TextField label="Nom d’hôte" value={domain.hostname} set={(hostname) => setDomain({ ...domain, hostname })} placeholder="dispatch.client.com" required /><TextField label="Préfixe (facultatif)" value={domain.pathPrefix} set={(pathPrefix) => setDomain({ ...domain, pathPrefix })} placeholder="/dispatch" /><label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={domain.isPrimary} onChange={(e) => setDomain({ ...domain, isPrimary: e.target.checked })} className="h-4 w-4 accent-black" />Principal</label><button disabled={domainAction.busy} className={buttonClass.primary}>Ajouter</button></form>}
      {domainAction.error && <div className="px-4 pb-3"><Notice tone="error">{domainAction.error}</Notice></div>}
    </Surface>
    {confirmation && <ConfirmModal value={confirmation} close={() => setConfirmation(null)} />}
  </div>
}

function BillingForm({ detail, canWrite, mutate }: { detail: Detail; canWrite: boolean; mutate: (url: string, init: RequestInit, success: string) => Promise<void> }) {
  const fields: [keyof BillingConfig, string][] = [['legalName', 'Raison sociale'], ['vatNumber', 'Numéro de TVA'], ['legalAddress', 'Adresse légale'], ['billingEmail', 'E-mail de facturation'], ['iban', 'IBAN'], ['bic', 'BIC'], ['bankName', 'Banque'], ['beneficiary', 'Bénéficiaire'], ['invoicePrefix', 'Préfixe des factures'], ['paymentTermsDays', 'Délai de paiement (jours)']]
  const initial = useMemo(() => Object.fromEntries(fields.map(([key]) => [key, detail.billingConfig?.[key] == null ? (key === 'paymentTermsDays' ? '30' : '') : String(detail.billingConfig[key])])) as Record<string, string>, [detail]) // eslint-disable-line react-hooks/exhaustive-deps
  const [value, setValue] = useState(initial)
  useEffect(() => setValue(initial), [initial])
  const dirty = fields.some(([key]) => value[key] !== initial[key])
  const { busy, error, submit } = useSubmit(() => mutate(`/api/platform/organizations/${detail.id}/billing`, { method: 'PUT', body: JSON.stringify(value) }, 'Identité légale enregistrée.'))
  return <form onSubmit={submit} className="mt-5"><Surface title="Identité légale et facturation" description="Utilisée sur les nouvelles factures ; les factures existantes conservent leurs mentions." footer={canWrite && <SaveBar dirty={dirty} busy={busy} onReset={() => setValue(initial)} />}>
    <div className="grid gap-3 p-4 sm:grid-cols-2">{fields.map(([key, label]) => <TextField key={key} label={label} value={value[key]} set={(next) => setValue({ ...value, [key]: next })} disabled={!canWrite} type={key === 'paymentTermsDays' ? 'number' : 'text'} mono={key === 'iban' || key === 'bic'} />)}</div>
    {error && <div className="px-4 pb-3"><Notice tone="error">{error}</Notice></div>}
  </Surface></form>
}

// ─── Standard members ────────────────────────────────────────────────────────

function MembersPanel({ detail, canWrite, availableUsers, mutate }: { detail: Detail; canWrite: boolean; availableUsers: AvailableUser[]; mutate: (url: string, init: RequestInit, success: string) => Promise<void> }) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const act = (url: string, init: RequestInit, success: string) => { setError(''); return mutate(url, init, success).catch((cause) => { setError(errorText(cause, 'Action impossible')) }) }
  const admins = detail.users.filter((member) => member.role === 'ORG_ADMIN')
  return <Surface title="Accès à l’organisation" description={`${detail.users.length} membre${detail.users.length > 1 ? 's' : ''} · ${admins.length} administrateur${admins.length > 1 ? 's' : ''}. La gestion courante revient aux administrateurs de l’organisation.`} action={canWrite && <button onClick={() => setAdding(true)} className={buttonClass.secondary}>＋ Ajouter</button>}>
    {error && <div className="px-4 pt-3"><Notice tone="error">{error}</Notice></div>}
    <ul className="max-h-[360px] divide-y divide-black/[.05] overflow-y-auto">{detail.users.map((member) => <li key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1"><p className={`truncate text-sm font-medium ${member.user.isActive ? '' : 'text-black/50'}`}>{member.user.firstName} {member.user.lastName}{!member.user.isActive && <span className="ml-2 text-xs font-normal">(désactivé)</span>}</p><p className="truncate text-xs text-black/60">@{member.user.username}{member.user.email ? ` · ${member.user.email}` : ''}</p></div>
      <select aria-label={`Rôle de ${member.user.firstName} ${member.user.lastName}`} disabled={!canWrite} value={member.role} onChange={(e) => { const role = e.target.value; setConfirmation({ title: 'Changer le rôle', confirm: 'Appliquer', body: <><strong>{member.user.firstName} {member.user.lastName}</strong> passera de {roleLabels[member.role]} à {roleLabels[role]}.</>, run: () => act(`/api/platform/organizations/${detail.id}/members/${member.id}`, { method: 'PATCH', body: JSON.stringify({ role }) }, 'Rôle modifié.') }) }} className={`${inputClass} w-auto disabled:bg-black/[.03]`}>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select>
      {canWrite && <button onClick={() => setConfirmation({ title: 'Retirer de l’organisation', confirm: 'Retirer', destructive: true, body: <><strong>{member.user.firstName} {member.user.lastName}</strong> perdra l’accès à cette organisation. Son compte utilisateur est conservé.</>, run: () => act(`/api/platform/organizations/${detail.id}/members/${member.id}`, { method: 'DELETE' }, 'Membre retiré.') })} className={`${buttonClass.ghost} !text-red-700`}>Retirer</button>}
    </li>)}</ul>
    {adding && <AddPlatformMemberModal detail={detail} availableUsers={availableUsers} close={() => setAdding(false)} mutate={mutate} />}
    {confirmation && <ConfirmModal value={confirmation} close={() => setConfirmation(null)} />}
  </Surface>
}

function AddPlatformMemberModal({ detail, availableUsers, close, mutate }: { detail: Detail; availableUsers: AvailableUser[]; close: () => void; mutate: (url: string, init: RequestInit, success: string) => Promise<void> }) {
  const [form, setForm] = useState({ existingUserId: '', firstName: '', lastName: '', username: '', email: '', password: '', role: 'ORG_ADMIN' })
  const { busy, error, submit } = useSubmit(async () => { await mutate(`/api/platform/organizations/${detail.id}/members`, { method: 'POST', body: JSON.stringify(form) }, 'Membre ajouté.'); close() })
  const existing = Boolean(form.existingUserId)
  return <Modal title={`Ajouter un accès · ${detail.displayName || detail.name}`} close={close}>
    <form onSubmit={submit} className="space-y-3">
      <label className="block"><span className="text-xs font-medium text-black/70">Compte</span><select value={form.existingUserId} onChange={(e) => setForm({ ...form, existingUserId: e.target.value })} className={`${inputClass} mt-1`}><option value="">Nouveau compte</option>{availableUsers.map((user) => <option key={user.id} value={user.id}>{user.firstName} {user.lastName} · @{user.username}</option>)}</select></label>
      {!existing && <><div className="grid gap-3 sm:grid-cols-2"><TextField label="Prénom" value={form.firstName} set={(firstName) => setForm({ ...form, firstName })} required autoFocus /><TextField label="Nom" value={form.lastName} set={(lastName) => setForm({ ...form, lastName })} required /></div>
        <TextField label="Identifiant de connexion" value={form.username} set={(username) => setForm({ ...form, username })} required />
        <TextField label="E-mail (facultatif)" type="email" value={form.email} set={(email) => setForm({ ...form, email })} />
        <TextField label="Mot de passe initial" type="password" value={form.password} set={(password) => setForm({ ...form, password })} required hint="À transmettre par un canal sûr." /></>}
      <label className="block"><span className="text-xs font-medium text-black/70">Rôle</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={`${inputClass} mt-1`}>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={close} className={buttonClass.secondary}>Annuler</button><button disabled={busy} className={buttonClass.primary}>{busy ? 'Ajout…' : 'Ajouter'}</button></div>
    </form>
  </Modal>
}

// ─── Modals ──────────────────────────────────────────────────────────────────

function CreateOrganizationModal({ close, created }: { close: () => void; created: (id: string) => Promise<void> }) {
  const [form, setForm] = useState({ name: '', slug: '', firstName: '', lastName: '', username: '', email: '', password: '' })
  const withAdmin = Boolean(form.username)
  const { busy, error, submit } = useSubmit(async () => {
    const admin = withAdmin ? { firstName: form.firstName, lastName: form.lastName, username: form.username, email: form.email, password: form.password } : null
    const body = await call('/api/platform/organizations', { method: 'POST', body: JSON.stringify({ name: form.name, slug: form.slug, status: 'ACTIVE', enabledModules: [...modules], admin }) })
    await created(body.organization.id)
  })
  return <Modal title="Nouvelle organisation Standard" close={close} width="max-w-lg">
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><TextField label="Nom" value={form.name} set={(name) => setForm({ ...form, name })} required autoFocus /><TextField label="Identifiant (slug)" value={form.slug} set={(slug) => setForm({ ...form, slug })} placeholder="Généré si vide" mono /></div>
      <fieldset className="rounded-lg border border-black/[.08] p-3"><legend className="px-1 text-xs font-medium text-black/70">Premier administrateur (facultatif)</legend>
        <div className="grid gap-3 sm:grid-cols-2"><TextField label="Prénom" value={form.firstName} set={(firstName) => setForm({ ...form, firstName })} required={withAdmin} /><TextField label="Nom" value={form.lastName} set={(lastName) => setForm({ ...form, lastName })} required={withAdmin} /><TextField label="Identifiant" value={form.username} set={(username) => setForm({ ...form, username })} /><TextField label="E-mail" type="email" value={form.email} set={(email) => setForm({ ...form, email })} /><div className="sm:col-span-2"><TextField label="Mot de passe initial" type="password" value={form.password} set={(password) => setForm({ ...form, password })} required={withAdmin} /></div></div>
      </fieldset>
      <p className="text-xs text-black/60">Tous les modules sont activés par défaut ; ajustez-les ensuite dans l’espace de l’organisation.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end gap-2"><button type="button" onClick={close} className={buttonClass.secondary}>Annuler</button><button disabled={busy} className={buttonClass.primary}>{busy ? 'Création…' : 'Créer l’organisation'}</button></div>
    </form>
  </Modal>
}

function ConfirmModal({ value, close }: { value: Confirmation; close: () => void }) {
  const [busy, setBusy] = useState(false)
  const run = async () => { setBusy(true); try { await value.run() } finally { setBusy(false); close() } }
  return <Modal title={value.title} close={close}>
    <p className="text-sm leading-6 text-black/70">{value.body}</p>
    <div className="mt-5 flex justify-end gap-2"><button onClick={close} className={buttonClass.secondary}>Annuler</button><button autoFocus disabled={busy} onClick={() => void run()} className={value.destructive ? buttonClass.danger : buttonClass.primary}>{busy ? '…' : value.confirm}</button></div>
  </Modal>
}

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const user = await getPlatformUser(req)
  if (!user) {
    res.statusCode = 403
    return { props: { accessDenied: true } }
  }
  return { props: { accessDenied: false } }
}
