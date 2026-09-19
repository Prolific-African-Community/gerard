// TEMPORAIRE — assets UI plans 6 a 10. Aucune logique produit, aucune ecriture en base.
// PowerShell :
//   $env:CAPTURE_USER="admin"; $env:CAPTURE_PASSWORD="GerardDemo!2026"; node scripts/capture/plans6-10-capture.mjs
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.env.CAPTURE_BASE_URL ?? 'http://localhost:3000'
const OUT_DIR = path.resolve('captures')
const VIDEO_DIR = path.join(OUT_DIR, '_video_tmp')
const SEMAINE = 'Semaine du 14 septembre 2026'
const HERO = 'GRD-260918-12'
const DESK = { width: 2133, height: 1400 }
const MOBILE = { width: 430, height: 932 }
const DSF_DESK = 2
const DSF_MOBILE = 3
const T = 60000
const ARGS = ['--force-device-scale-factor=2', '--high-dpi-support=1', '--use-angle=swiftshader', '--disable-lcd-text', '--hide-scrollbars']

const INTERDIT = [
  ['Novotralux', /novotralux/i],
  ['Gerard Fleet', /Gerard Fleet/i],
  ['Demo', /\bdemo\b/i],
  ['Distance a calculer', /Distance à calculer/i],
]
const rapport = []
const log = (m) => console.log(m)
const dims = (b) => `${b.readUInt32BE(16)} x ${b.readUInt32BE(20)}`

async function controle(page, nom) {
  const t = await page.evaluate(() => document.body?.innerText ?? '')
  const ko = INTERDIT.filter(([, re]) => re.test(t)).map(([l]) => l)
  const gerard = /Gerard/.test(t)
  log(`      controle ${nom} : ${ko.length ? 'KO -> ' + ko.join(', ') : 'OK'}${gerard ? '' : ' (wordmark Gerard ABSENT)'}`)
  return { ko, gerard }
}

async function shot(page, file, nom) {
  const p = path.join(OUT_DIR, file)
  await page.screenshot({ path: p, fullPage: false, type: 'png', animations: 'disabled', caret: 'hide' })
  const b = await readFile(p)
  log(`      ecrit ${file} — ${dims(b)} — ${(b.length / 1048576).toFixed(2)} Mo`)
  rapport.push({ nom, fichier: file, dim: dims(b) })
  return p
}

async function login(page) {
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded', timeout: T })
  await page.waitForTimeout(1200)
  if (!page.url().includes('/login')) return
  const u = process.env.CAPTURE_USER, w = process.env.CAPTURE_PASSWORD
  if (!u || !w) throw new Error('CAPTURE_USER / CAPTURE_PASSWORD non definis.')
  const pw = page.locator('input[type="password"]').first()
  await pw.waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('input[type="text"], input:not([type]), input[type="email"]').first().fill(u)
  await pw.fill(w)
  await page.getByRole('button', { name: /se connecter/i }).first().click()
  await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 30000, polling: 300 })
  if (!page.url().includes('/dispatch')) await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded', timeout: T })
}

async function allerSemaine(page) {
  await page.waitForFunction(() => /Semaine du|CHAUFFEUR/i.test(document.body?.innerText ?? ''), null, { timeout: T, polling: 500 })
  for (let i = 0; i < 12; i++) {
    if ((await page.evaluate(() => document.body.innerText)).includes(SEMAINE)) return true
    const b = page.getByRole('button', { name: /^Suivante$/i }).first()
    if (!(await b.count())) break
    await b.click(); await page.waitForTimeout(1500)
  }
  return (await page.evaluate(() => document.body.innerText)).includes(SEMAINE)
}

async function attendreMissions(page) {
  await page.waitForFunction((h) => {
    const t = document.body?.innerText ?? ''
    return new Set(t.match(/GRD-\d{6}-\d{2}/g) || []).size >= 20 && t.includes(h)
  }, HERO, { timeout: T, polling: 500 })
}

const neutraliser = async (page, w, h) => {
  await page.mouse.move(w - 20, h - 20)
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  await page.addStyleTag({ content: '*{caret-color:transparent!important}' })
  await page.waitForTimeout(700)
}

await mkdir(OUT_DIR, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ARGS })
const blocages = []

// ============================ A — PLAN 6 : drag & drop (video + stills 4K)
log('\n===== A · PLAN 6 — drag & drop =====')
try {
  await mkdir(VIDEO_DIR, { recursive: true })
  const ctx = await browser.newContext({
    viewport: DESK, deviceScaleFactor: 1, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce',
    recordVideo: { dir: VIDEO_DIR, size: DESK },
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(T)
  await login(page)
  if (!(await allerSemaine(page))) throw new Error(`Semaine « ${SEMAINE} » introuvable.`)
  await attendreMissions(page)
  await neutraliser(page, DESK.width, DESK.height)

  const poolAvant = (await page.evaluate(() => document.body.innerText)).match(/À planifier\s*(\d+)/)?.[1]
  log(`      pool avant : ${poolAvant}`)

  const carte = page.locator(`text=${HERO}`).last()
  const cible = page.locator('text=Déposer').first()
  await carte.scrollIntoViewIfNeeded()
  const a = await carte.boundingBox()
  const b = await cible.boundingBox()
  if (!a || !b) throw new Error('Carte heroine ou cellule cible introuvable dans le DOM.')

  await page.waitForTimeout(1200)                       // marge avant
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  const N = 28                                          // ~0.6 s de trajet
  for (let i = 1; i <= N; i++) {
    await page.mouse.move(
      a.x + a.width / 2 + ((b.x + b.width / 2) - (a.x + a.width / 2)) * (i / N),
      a.y + a.height / 2 + ((b.y + b.height / 2) - (a.y + a.height / 2)) * (i / N),
    )
    await page.waitForTimeout(20)
  }
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(2500)                       // marge apres

  const txt = await page.evaluate(() => document.body.innerText)
  const poolApres = txt.match(/À planifier\s*(\d+)/)?.[1]
  log(`      pool apres : ${poolApres}`)
  if (poolApres !== '3') blocages.push(`PLAN 6 : pool attendu a 3, obtenu ${poolApres}. Drop probablement refuse.`)
  if (!page.url().includes('/dispatch')) blocages.push('PLAN 6 : navigation inattendue pendant le drop.')

  await controle(page, 'plan6')
  const video = page.video()
  await ctx.close()
  const src = await video.path()
  const dest = path.join(OUT_DIR, 'plan6_dragdrop_source.webm')
  await rename(src, dest).catch(async () => writeFile(dest, await readFile(src)))
  log(`      ecrit plan6_dragdrop_source.webm (${DESK.width}x${DESK.height})`)
  rapport.push({ nom: 'PLAN 6 video', fichier: 'plan6_dragdrop_source.webm', dim: `${DESK.width} x ${DESK.height} (webm)` })
} catch (e) {
  blocages.push(`PLAN 6 : ${e.message.split('\n')[0]}`)
  log(`      ECHEC : ${e.message.split('\n')[0]}`)
}

// PLAN 6 — stills 4K avant / apres (etat initial et final, pour montage)
log('\n===== A bis · PLAN 6 — stills 4K avant/apres =====')
try {
  const ctx = await browser.newContext({ viewport: DESK, deviceScaleFactor: DSF_DESK, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' })
  const page = await ctx.newPage(); page.setDefaultTimeout(T)
  await login(page)
  if (!(await allerSemaine(page))) throw new Error('semaine introuvable')
  await attendreMissions(page)
  await neutraliser(page, DESK.width, DESK.height)
  await controle(page, 'plan6-avant')
  await shot(page, 'plan6_avant_4k.png', 'PLAN 6 avant')

  const carte = page.locator(`text=${HERO}`).last()
  const cible = page.locator('text=Déposer').first()
  const a = await carte.boundingBox(); const b = await cible.boundingBox()
  if (a && b) {
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2) - (a.x + a.width / 2)) * (i / 20), a.y + a.height / 2 + ((b.y + b.height / 2) - (a.y + a.height / 2)) * (i / 20))
      await page.waitForTimeout(15)
    }
    await page.mouse.up(); await page.waitForTimeout(2500)
    await neutraliser(page, DESK.width, DESK.height)
    await shot(page, 'plan6_apres_4k.png', 'PLAN 6 apres')
  }
  await ctx.close()
} catch (e) { blocages.push(`PLAN 6 stills : ${e.message.split('\n')[0]}`); log(`      ECHEC : ${e.message.split('\n')[0]}`) }

// ============================ B — PLAN 7 : imports
log('\n===== B · PLAN 7 — imports =====')
try {
  const ctx = await browser.newContext({ viewport: DESK, deviceScaleFactor: DSF_DESK, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' })
  const page = await ctx.newPage(); page.setDefaultTimeout(T)
  await login(page)
  await allerSemaine(page)
  await page.getByRole('button', { name: /^Imports$/i }).first().click()
  await page.waitForTimeout(3000)
  await neutraliser(page, DESK.width, DESK.height)
  const c = await controle(page, 'plan7')
  if (c.ko.length) blocages.push(`PLAN 7 : termes interdits visibles -> ${c.ko.join(', ')}`)
  await shot(page, 'plan7_imports_source.png', 'PLAN 7')
  await ctx.close()
} catch (e) { blocages.push(`PLAN 7 : ${e.message.split('\n')[0]}`); log(`      ECHEC : ${e.message.split('\n')[0]}`) }

// ============================ C — PLAN 8 : carte
log('\n===== C · PLAN 8 — carte =====')
try {
  const ctx = await browser.newContext({ viewport: DESK, deviceScaleFactor: DSF_DESK, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' })
  const page = await ctx.newPage(); page.setDefaultTimeout(T)
  await login(page)
  await allerSemaine(page)
  await page.getByRole('button', { name: /^Carte$/i }).first().click()
  await page.waitForTimeout(8000)   // tuiles Google Maps
  await neutraliser(page, DESK.width, DESK.height)
  const c = await controle(page, 'plan8')
  if (c.ko.length) blocages.push(`PLAN 8 : termes interdits visibles -> ${c.ko.join(', ')}`)
  await shot(page, 'plan8_map_source.png', 'PLAN 8')
  await ctx.close()
} catch (e) { blocages.push(`PLAN 8 : ${e.message.split('\n')[0]}`); log(`      ECHEC : ${e.message.split('\n')[0]}`) }

// ============================ D — PLAN 9 : mobile chauffeur
log('\n===== D · PLAN 9 — mobile chauffeur =====')
try {
  const ctx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: DSF_MOBILE, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' })
  const page = await ctx.newPage(); page.setDefaultTimeout(T)
  await login(page)
  await page.goto(`${BASE}/driver`, { waitUntil: 'domcontentloaded', timeout: T })
  await page.waitForTimeout(5000)
  await neutraliser(page, MOBILE.width, MOBILE.height)
  const c = await controle(page, 'plan9')
  if (c.ko.length) blocages.push(`PLAN 9 : termes interdits visibles -> ${c.ko.join(', ')}`)
  const t = await page.evaluate(() => document.body.innerText)
  if (!/Marc Denis/.test(t)) blocages.push('PLAN 9 : ecran chauffeur non associe a Marc Denis (compte admin). Voir rapport.')
  await shot(page, 'plan9_driver_mobile_source.png', 'PLAN 9')
  await ctx.close()
} catch (e) { blocages.push(`PLAN 9 : ${e.message.split('\n')[0]}`); log(`      ECHEC : ${e.message.split('\n')[0]}`) }

// ============================ E — PLAN 10 : mobile dispatcher
log('\n===== E · PLAN 10 — mobile dispatcher =====')
try {
  const ctx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: DSF_MOBILE, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce' })
  const page = await ctx.newPage(); page.setDefaultTimeout(T)
  await login(page)
  await page.waitForTimeout(4000)
  await neutraliser(page, MOBILE.width, MOBILE.height)
  const c = await controle(page, 'plan10')
  if (c.ko.length) blocages.push(`PLAN 10 : termes interdits visibles -> ${c.ko.join(', ')}`)
  await shot(page, 'plan10_dispatcher_mobile_source.png', 'PLAN 10')
  await ctx.close()
} catch (e) { blocages.push(`PLAN 10 : ${e.message.split('\n')[0]}`); log(`      ECHEC : ${e.message.split('\n')[0]}`) }

await browser.close().catch(() => {})

log('\n============ RAPPORT ============')
for (const r of rapport) log(`  ${r.fichier.padEnd(38)} ${r.dim}`)
log('\nBlocages :')
if (!blocages.length) log('  aucun')
else for (const b of blocages) log(`  - ${b}`)
log('=================================\n')
process.exit(blocages.length ? 1 : 0)
