// TEMPORAIRE — capture publicitaire PLAN 5. Aucune logique produit, aucune ecriture en base.
// PowerShell :
//   $env:CAPTURE_USER="admin"; $env:CAPTURE_PASSWORD="..."; node scripts/capture/plan5-capture.mjs
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.env.CAPTURE_BASE_URL ?? 'http://localhost:3000'
const OUT_DIR = path.resolve('captures')
const OUT = path.join(OUT_DIR, 'plan5_source_4k.png')
const DEBUG = path.join(OUT_DIR, 'plan5_debug.png')

const WEEK_START = '2026-09-14'
const SEMAINE = 'Semaine du 14 septembre 2026'
const HERO = 'GRD-260918-12'
const CHAUFFEURS = ['Marc Denis', 'Karim El Mansouri', 'Julien Morel', 'Sofia Marin']
const PLAQUES = ['GX-482-LM', 'TR-915-KV', 'AB-274-XD', 'TR-338-QP']
const POOL_VIDE = 'Aucune mission à planifier cette semaine'

const VW = 2133
const VH = 1400
const DSF = 2
const MIN_WIDTH = 3840
const T = 60000

const step = (n, m) => console.log(`[${n}] ${m}`)
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) })

const STRATEGIES = [
  {
    nom: 'A - Playwright screenshot (deviceScaleFactor du contexte)',
    launch: {},
    shot: async (page) => page.screenshot({ fullPage: false, type: 'png', animations: 'disabled', caret: 'hide' }),
  },
  {
    nom: 'B - CDP Page.captureScreenshot avec clip.scale = 2',
    launch: {},
    shot: async (page, ctx) => {
      const cdp = await ctx.newCDPSession(page)
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: VW, height: VH, scale: DSF },
      })
      await cdp.detach().catch(() => {})
      return Buffer.from(data, 'base64')
    },
  },
  {
    nom: 'C - Relance avec --force-device-scale-factor=2 et ANGLE SwiftShader',
    launch: {
      args: ['--force-device-scale-factor=2', '--high-dpi-support=1', '--use-angle=swiftshader', '--disable-lcd-text', '--hide-scrollbars'],
    },
    shot: async (page) => page.screenshot({ fullPage: false, type: 'png', animations: 'disabled', caret: 'hide' }),
  },
  {
    nom: "D - Chrome installe (channel 'chrome')",
    launch: { channel: 'chrome' },
    shot: async (page) => page.screenshot({ fullPage: false, type: 'png', animations: 'disabled', caret: 'hide' }),
  },
]

let page = null
let context = null
const overviewCalls = []

async function printDiagnostics(tag) {
  const d = page ? await page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    iw: window.innerWidth, ih: window.innerHeight,
    ow: window.outerWidth, oh: window.outerHeight,
    sw: screen.width, sh: screen.height,
    aw: screen.availWidth, ah: screen.availHeight,
  })).catch(() => null) : null
  console.log(`\n--- diagnostics ${tag} ---`)
  console.log(`  viewport CSS demande      : ${VW} x ${VH}`)
  console.log(`  deviceScaleFactor demande : ${DSF}`)
  if (d) {
    console.log(`  window.devicePixelRatio   : ${d.dpr}`)
    console.log(`  window.innerWidth/Height  : ${d.iw} x ${d.ih}`)
    console.log(`  window.outerWidth/Height  : ${d.ow} x ${d.oh}`)
    console.log(`  screen.width/height       : ${d.sw} x ${d.sh}`)
    console.log(`  screen.avail              : ${d.aw} x ${d.ah}`)
  } else console.log('  (page indisponible)')
  console.log('---\n')
}

async function dumpAndFail(msg) {
  console.error(`\n=== ECHEC : ${msg} ===`)
  if (page) {
    try {
      await mkdir(OUT_DIR, { recursive: true })
      await page.screenshot({ path: DEBUG, fullPage: false, type: 'png' })
      console.error(`URL courante : ${page.url()}`)
      console.error(`Titre        : ${await page.title().catch(() => '(indisponible)')}`)
      console.error(`Debug PNG    : ${DEBUG}`)
      console.error('--- reponses /api/dispatch/overview ---')
      if (!overviewCalls.length) console.error('(aucune requete interceptee)')
      for (const c of overviewCalls) console.error(`  ${c.status}  ${c.url}\n     ${String(c.sample).slice(0, 400)}`)
      const t = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
      console.error('--- 1200 premiers caracteres du DOM ---')
      console.error(t.slice(0, 1200) || '(page vide)')
    } catch (e) { console.error(`(diagnostic impossible : ${e.message})`) }
    await printDiagnostics('au moment de l echec')
  }
  process.exit(1)
}

async function prepare(browser, tag) {
  context = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: DSF,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    reducedMotion: 'reduce',
  })
  page = await context.newPage()
  page.setDefaultTimeout(T)
  page.on('console', (m) => { if (m.type() === 'error') console.log(`      [console] ${m.text().slice(0, 200)}`) })
  page.on('response', async (res) => {
    const u = res.url()
    if (!u.includes('/api/dispatch/overview')) return
    let sample = ''
    try { sample = (await res.text()).slice(0, 2000) } catch { sample = '(corps illisible)' }
    overviewCalls.push({ url: u, status: res.status(), sample })
    console.log(`      [api] ${res.status()} ${u.replace(BASE, '')}`)
  })

  step(1, `[${tag}] Ouverture de ${BASE}/dispatch`)
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded', timeout: T })
  await page.waitForTimeout(1500)
  console.log(`      URL : ${page.url()}`)

  if (page.url().includes('/login')) {
    step(2, 'Login')
    const user = process.env.CAPTURE_USER
    const pass = process.env.CAPTURE_PASSWORD
    if (!user || !pass) await dumpAndFail('CAPTURE_USER / CAPTURE_PASSWORD non definis.')
    const pw = page.locator('input[type="password"]').first()
    await pw.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null)
    await page.locator('input[type="text"], input:not([type]), input[type="email"]').first().fill(user)
    await pw.fill(pass)
    await page.getByRole('button', { name: /se connecter/i }).first().click()
    await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 30000, polling: 300 }).catch(() => null)
    console.log(`      URL apres soumission : ${page.url()}`)
    if (page.url().includes('/login')) { console.error('\nLOGIN FAILED'); await dumpAndFail('Toujours sur /login.') }
    console.log('      LOGIN OK')
    if (!page.url().includes('/dispatch')) await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded', timeout: T })
  } else step(2, 'Session deja active')

  step(3, 'Attente du shell du board')
  await page.waitForFunction(() => {
    const t = document.body?.innerText ?? ''
    return location.pathname.includes('/dispatch') && (/Semaine du/i.test(t) || /CHAUFFEUR/i.test(t))
  }, null, { timeout: T, polling: 500 }).catch(() => null)
  if (!page.url().includes('/dispatch')) await dumpAndFail(`URL inattendue : ${page.url()}`)

  step(4, `Navigation vers ${SEMAINE}`)
  let ok = false
  for (let i = 0; i < 12; i++) {
    const t = await page.evaluate(() => document.body?.innerText ?? '')
    if (t.includes(SEMAINE)) { ok = true; break }
    const btn = page.getByRole('button', { name: /^Suivante$/i }).first()
    if (!(await btn.count())) break
    await btn.click()
    await page.waitForTimeout(1500)
  }
  if (!ok) await dumpAndFail(`Semaine ${SEMAINE} introuvable.`)
  console.log('      semaine OK')

  step(5, `Attente d un 200 sur /api/dispatch/overview?weekStart=${WEEK_START}`)
  const good = () => overviewCalls.some((c) => c.status === 200 && c.url.includes(`weekStart=${WEEK_START}`))
  const deadline = Date.now() + T
  while (!good() && Date.now() < deadline) await page.waitForTimeout(500)
  if (!good()) {
    const w = overviewCalls.filter((c) => c.url.includes('weekStart'))
    await dumpAndFail(`Aucun 200 pour weekStart=${WEEK_START}. ` + (w.length ? `Observe : ${w.map((c) => `${c.status} ${c.url.split('?')[1]}`).join(' | ')}` : 'aucune requete weekStart.'))
  }
  console.log('      overview 200 OK')

  step(6, 'Attente du rendu des cartes mission')
  await page.waitForFunction((hero) => {
    const t = document.body?.innerText ?? ''
    return new Set(t.match(/GRD-\d{6}-\d{2}/g) || []).size >= 20 && t.includes(hero)
  }, HERO, { timeout: T, polling: 500 }).catch(() => null)

  step(7, 'Assertions bloquantes')
  const body = await page.evaluate(() => document.body.innerText)
  const refs = [...new Set(body.match(/GRD-\d{6}-\d{2}/g) || [])]
  const checks = [
    ...CHAUFFEURS.map((n) => [`chauffeur ${n}`, body.includes(n)]),
    ...PLAQUES.map((p) => [`plaque ${p}`, body.includes(p)]),
    [`mission ${HERO}`, body.includes(HERO)],
    ['compteur A planifier 4', /À planifier\s*4\b/.test(body)],
    ['pas de pool vide', !body.includes(POOL_VIDE)],
    ['23 references mission', refs.length === 23],
    ['wordmark Gerard', /Gerard/.test(body)],
    ['aucun Gerard Fleet', !/Gerard Fleet/i.test(body)],
    ['aucun Demo', !/\bdemo\b/i.test(body)],
    ['aucun Novotralux', !/novotralux/i.test(body)],
    ['aucun Distance a calculer', !/Distance à calculer/i.test(body)],
    ['un seul Deposer', (body.match(/Déposer/g) || []).length === 1],
  ]
  let bad = 0
  for (const [label, pass] of checks) { console.log(`      ${pass ? 'OK  ' : 'KO  '}${label}`); if (!pass) bad++ }
  console.log(`      references trouvees : ${refs.length}`)
  if (bad) await dumpAndFail(`${bad} assertion(s) en echec - aucune capture produite.`)

  step(8, 'Neutralisation des survols et du curseur')
  await page.mouse.move(VW - 30, VH - 30)
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  await page.addStyleTag({ content: '*{caret-color:transparent!important}' })
  await page.waitForTimeout(800)
}

await mkdir(OUT_DIR, { recursive: true })
const resultats = []
let gagnant = null

for (const strat of STRATEGIES) {
  console.log(`\n==================== ${strat.nom} ====================`)
  let browser = null
  try {
    browser = await chromium.launch({ headless: true, ...strat.launch })
  } catch (e) {
    console.log(`      indisponible : ${e.message.split('\n')[0]}`)
    resultats.push({ nom: strat.nom, w: 0, h: 0, note: 'lancement impossible' })
    continue
  }
  try {
    await prepare(browser, strat.nom.slice(0, 1))
    step(9, 'Capture')
    const buf = await strat.shot(page, context)
    const { w, h } = pngSize(buf)
    console.log(`      resultat : ${w} x ${h} px`)
    await printDiagnostics(strat.nom.slice(0, 1))
    resultats.push({ nom: strat.nom, w, h })
    if (w >= MIN_WIDTH) {
      await writeFile(OUT, buf)
      gagnant = { nom: strat.nom, w, h, poids: buf.length }
    }
  } catch (e) {
    console.log(`      erreur : ${e.message.split('\n')[0]}`)
    resultats.push({ nom: strat.nom, w: 0, h: 0, note: e.message.split('\n')[0] })
  } finally {
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
    context = null
    page = null
  }
  if (gagnant) break
}

console.log('\n============ RECAPITULATIF ============')
for (const r of resultats) console.log(`  ${(r.w ? `${r.w} x ${r.h}` : 'echec').padEnd(13)} ${r.nom}${r.note ? ` (${r.note})` : ''}`)
console.log('=======================================\n')

if (gagnant) {
  console.log(`Dimensions : ${gagnant.w} x ${gagnant.h} px`)
  console.log(`Fichier    : ${OUT}`)
  console.log(`Poids      : ${(gagnant.poids / 1048576).toFixed(2)} Mo`)
  console.log(`Strategie  : ${gagnant.nom}`)
  console.log('CAPTURE PLAN 5 TERMINEE')
} else {
  const best = resultats.reduce((a, b) => (b.w > a.w ? b : a), { w: 0, h: 0, nom: '-' })
  console.error(`ECHEC : aucune strategie n a atteint ${MIN_WIDTH} px de large.`)
  console.error(`Meilleur resultat : ${best.w} x ${best.h} (${best.nom})`)
  console.error('Aucun fichier plan5_source_4k.png ecrit.')
  await unlink(OUT).catch(() => {})
  process.exit(1)
}
