import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { IntegrationSecretError, type IntegrationSecretProvider } from '../lib/integrations/secrets'
import { resolveImapConfig } from '../lib/mail/imap-client'
import { mergeMailPreviews } from '../lib/mail/production-mail-imports'
import type { MissionImportPreview } from '../lib/mail/types'

const root = path.resolve(__dirname, '..')

const configuredIntegration = {
  secretRef: 'QA_MAIL',
  configJson: {
    mailboxAddress: 'dispatch@example.test', host: 'imap.example.test', port: 993,
    secure: true, folder: 'INBOX', provider: 'imap', limit: 25,
  },
}

const provider: IntegrationSecretProvider = {
  async get(_secretRef, key) {
    return key === 'username' ? 'qa-user' : key === 'password' ? 'qa-password' : null
  },
}

const preview = (id: string, parserId: string): MissionImportPreview => ({
  id, source: 'imap', provider: 'imap', sourceEmailId: id,
  sourceEmailFrom: '', sourceEmailSubject: '', receivedAt: new Date(0).toISOString(),
  confidence: 1, parserId, reference: id, clientName: 'Client', pickupCity: '', deliveryCity: '',
})
async function main() {
  const config = await resolveImapConfig(configuredIntegration, provider)
  assert.equal(config.host, 'imap.example.test')
  assert.equal(config.folder, 'INBOX')
  assert.equal(config.user, 'qa-user')
  assert.equal(config.password, 'qa-password')

  await assert.rejects(
    () => resolveImapConfig(configuredIntegration, { get: async () => null }),
    IntegrationSecretError,
  )

  const merged = mergeMailPreviews([preview('same', 'live')], [preview('same', 'persisted'), preview('history', 'persisted')])
  assert.equal(merged.length, 2)
  assert.equal(merged.find((item) => item.id === 'same')?.parserId, 'live')

  const routeSource = fs.readFileSync(path.join(root, 'pages/api/dispatch/mail-imports.ts'), 'utf8')
  const runtimeSource = fs.readFileSync(path.join(root, 'lib/mail/production-mail-imports.ts'), 'utf8')
  assert.match(routeSource, /loadProductionMailImports/)
  assert.doesNotMatch(routeSource + runtimeSource, /process\.env\.MAIL_IMPORT_/)
  assert.match(runtimeSource, /getImapConfig\(\)/)
  assert.match(runtimeSource, /connected: true/)

  const desktopMap = fs.readFileSync(path.join(root, 'components/dispatch/DispatchMapView.tsx'), 'utf8')
  const mobileMap = fs.readFileSync(path.join(root, 'components/dispatch/mobile/MobileMapPanel.tsx'), 'utf8')
  const dispatchPage = fs.readFileSync(path.join(root, 'pages/dispatch.tsx'), 'utf8')
  const nextConfig = fs.readFileSync(path.join(root, 'next.config.js'), 'utf8')
  for (const source of [desktopMap, mobileMap]) {
    assert.match(source, /process\.env\.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY/)
    assert.doesNotMatch(source, /process\.env\.GOOGLE_MAPS_API_KEY/)
  }
  assert.match(nextConfig, /NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY/)
  assert.doesNotMatch(nextConfig, /NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY:\s*process\.env\.GOOGLE_MAPS_API_KEY/)
  assert.match(dispatchPage, /googleMapsBrowserKey: getRuntimeGoogleMapsBrowserKey\(\)/)
  assert.match(dispatchPage, /\['NEXT', 'PUBLIC', 'GOOGLE', 'MAPS', 'BROWSER', 'KEY'\]\.join\('_'\)/)
  assert.doesNotMatch(dispatchPage, /process\.env\[.*GOOGLE_MAPS_API_KEY/)
  assert.match(desktopMap, /googleMapsBrowserKey \|\| process\.env\.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY/)
  assert.match(mobileMap, /googleMapsBrowserKey \|\| process\.env\.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY/)

  console.log('production runtime regressions: PASS')
}

void main()
