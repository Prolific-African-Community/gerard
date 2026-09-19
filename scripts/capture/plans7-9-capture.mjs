// TEMPORAIRE — assets PLAN 7 et PLAN 9 uniquement.
import { chromium } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.env.CAPTURE_BASE_URL ?? 'http://localhost:3000'
const OUT = path.resolve('captures')
const DESK = { width: 2133, height: 1400 }
const MOBILE = { width: 430, height: 932 }
const T = 60000
const ARGS = ['--force-device-scale-factor=2', '--high-dpi-support=1', '--use-angle=swiftshader', '--disable-lcd-text', '--hide-scrollbars']
const INTERDIT = [['Novotralux', /novotralux/i], ['Gerard Fleet', /Gerard Fleet/i], ['Demo', /\bdemo\b/i], ['Distance a calculer', /Distance à calculer/i], ['erreur API', /returned 404|Connexion mail impossible|Application error|Unhandled Runtime/i]]
const out = []

async function connecte(page, user, pass) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: T })
  const pw = page.locator('input[type="password"]').first()
  await pw.waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('input[type="text"], input:not([type]), input[type="email"]').first().fill(user)
  await pw.fill(pass)
  await page.getByRole('button', { name: /se connecter/i }).first().click()
  await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 30000, polling: 300 })
  console.log(`      connecte ${user} -> ${page.url()}`)
}
async function propre(page, w, h) {
  await page.mouse.move(w - 20, h - 20)
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  await page.addStyleTag({ content: '*{caret-color:transparent!important}' })
  await page.waitForTimeout(700)
}
async function controle(page) {
  const t = await page.evaluate(() => document.body?.innerText ?? '')
  const ko = INTERDIT.filter(([, re]) => re.test(t)).map(([l]) => l)
  console.log(`      controle : ${ko.length ? 'KO -> ' + ko.join(', ') : 'OK'}`)
  return ko
}
async function shot(page, file) {
  const p = path.join(OUT, file)
  await page.screenshot({ path: p, fullPage: false, type: 'png', animations: 'disabled', caret: 'hide' })
  const b = await readFile(p)
  const d = `${b.readUInt32BE(16)} x ${b.readUInt32BE(20)}`
  console.log(`      ecrit ${file} — ${d}`)
  return d
}

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ARGS })

console.log('\n===== PLAN 7 — imports =====')
{
  const ctx = await browser.newContext({ viewport: DESK, deviceScaleFactor: 2, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' })
  const page = await ctx.newPage(); page.setDefaultTimeout(T)
  page.on('response', (r) => { if (r.url().includes('mail-imports')) console.log(`      [api] ${r.status()} /api/dispatch/mail-imports`) })
  await connecte(page, process.env.CAPTURE_USER ?? 'admin', process.env.CAPTURE_PASSWORD ?? 'GerardDemo!2026')
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded', timeout: T })
  await page.waitForFunction(() => /Semaine du|CHAUFFEUR/i.test(document.body?.innerText ?? ''), null, { timeout: T, polling: 500 })
  await page.getByRole('button', { name: /^Imports$/i }).first().click()
  await page.waitForTimeout(4000)
  await propre(page, DESK.width, DESK.height)
  const ko = await controle(page)
  out.push({ plan: 'PLAN 7', fichier: 'plan7_imports_source.png', dim: await shot(page, 'plan7_imports_source.png'), ko })
  await ctx.close()
}

console.log('\n===== PLAN 9 — mobile chauffeur (marc.denis) =====')
{
  const ctx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' })
  const page = await ctx.newPage(); page.setDefaultTimeout(T)
  await connecte(page, process.env.DRIVER_USER ?? 'marc.denis', process.env.DRIVER_PASSWORD ?? 'MarcDemo!2026')
  await page.goto(`${BASE}/driver`, { waitUntil: 'domcontentloaded', timeout: T })
  await page.waitForTimeout(5000)
  if (!page.url().includes('/driver')) { console.error(`      ECHEC : redirige vers ${page.url()} — le compte n a pas le role DRIVER.`); }
  await propre(page, MOBILE.width, MOBILE.height)
  const t = await page.evaluate(() => document.body.innerText)
  console.log(`      Marc Denis present : ${/Marc Denis/.test(t) ? 'oui' : 'NON'}`)
  const ko = await controle(page)
  out.push({ plan: 'PLAN 9', fichier: 'plan9_driver_mobile_source.png', dim: await shot(page, 'plan9_driver_mobile_source.png'), ko })
  await ctx.close()
}

await browser.close().catch(() => {})
console.log('\n============ RAPPORT ============')
for (const r of out) console.log(`  ${r.plan}  ${r.fichier.padEnd(36)} ${r.dim}  ${r.ko.length ? 'KO -> ' + r.ko.join(', ') : 'OK'}`)
console.log('=================================\n')
process.exit(out.some((r) => r.ko.length) ? 1 : 0)
