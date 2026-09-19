// TEMPORAIRE — PLAN 9 uniquement. Aucun code produit modifie, aucun seed touche.
import { chromium } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.env.CAPTURE_BASE_URL ?? 'http://localhost:3000'
const OUT = path.resolve('captures')
const FILE = 'plan9_driver_mobile_source.png'
const M = { width: 430, height: 932 }
const T = 60000
const ARGS = ['--force-device-scale-factor=2', '--high-dpi-support=1', '--use-angle=swiftshader', '--disable-lcd-text', '--hide-scrollbars']

const browser = await chromium.launch({ headless: true, args: ARGS })
const ctx = await browser.newContext({
  viewport: M, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce',
})
const page = await ctx.newPage()
page.setDefaultTimeout(T)

try {
  console.log('[1] Connexion marc.denis')
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: T })
  const pw = page.locator('input[type="password"]').first()
  await pw.waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('input[type="text"], input:not([type]), input[type="email"]').first().fill(process.env.DRIVER_USER ?? 'marc.denis')
  await pw.fill(process.env.DRIVER_PASSWORD ?? 'MarcDemo!2026')
  await page.getByRole('button', { name: /se connecter/i }).first().click()
  await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 30000, polling: 300 })

  console.log('[2] Ouverture /driver')
  await page.goto(`${BASE}/driver`, { waitUntil: 'domcontentloaded', timeout: T })
  await page.waitForFunction(() => /MISSION PRINCIPALE/i.test(document.body?.innerText ?? ''), null, { timeout: T, polling: 400 })
  await page.waitForTimeout(3000)
  console.log(`      URL : ${page.url()}`)

  console.log('[3] Positionnement sur MISSION PRINCIPALE')
  // Ancrage : le bloc mission remonte a ~24 px du haut du viewport.
  const y = await page.evaluate(() => {
    const cible = [...document.querySelectorAll('*')].find(
      (el) => el.children.length === 0 && /MISSION PRINCIPALE/i.test(el.textContent ?? ''),
    )
    if (!cible) return null
    const bloc = cible.closest('section, article, div[class*="rounded"], div') ?? cible
    const top = bloc.getBoundingClientRect().top + window.scrollY - 24
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' })
    return Math.max(0, top)
  })
  if (y === null) throw new Error('Bloc « MISSION PRINCIPALE » introuvable.')
  await page.waitForTimeout(1200)
  console.log(`      scrollY = ${Math.round(y)}`)

  console.log('[4] Neutralisation survol / focus / caret')
  await page.mouse.move(M.width - 12, M.height - 12)
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  await page.addStyleTag({ content: '*{caret-color:transparent!important}' })
  await page.waitForTimeout(800)

  console.log('[5] Verification du contenu visible dans le cadre')
  const vis = await page.evaluate(() => {
    const H = window.innerHeight
    const dansCadre = []
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walk.nextNode())) {
      const s = (n.textContent ?? '').trim()
      if (!s) continue
      const r = n.parentElement?.getBoundingClientRect()
      if (!r || r.height === 0) continue
      if (r.top >= -8 && r.bottom <= H + 8) dansCadre.push(s)
    }
    return dansCadre.join('\n')
  })
  const attendus = [
    ['mission (reference)', /GRD-\d{6}-\d{2}/],
    ['pickup', /pickup|chargement|enl[eè]vement/i],
    ['livraison', /livraison|delivery/i],
    ['horaires', /\d{1,2}[h:]\d{2}/],
    ['distance', /\d+\s?km/i],
    ['duree', /\d+\s?h\s?\d{0,2}|\bdur[ée]e\b/i],
    ['statut', /en cours|assign[ée]e|[àa] faire|termin[ée]e|en mission|statut/i],
    ['navigation', /naviguer|itin[ée]raire|navigation|ouvrir dans|maps|gps/i],
    ['Gerard', /Gerard/i],
    ['Marc', /Marc/i],
  ]
  let manquants = 0
  for (const [label, re] of attendus) {
    const ok = re.test(vis)
    console.log(`      ${ok ? 'OK  ' : 'KO  '}${label}`)
    if (!ok) manquants++
  }
  const interdits = [['Novotralux', /novotralux/i], ['Gerard Fleet', /Gerard Fleet/i], ['Demo', /\bdemo\b/i], ['erreur', /Application error|Unhandled Runtime|returned 404/i]]
  const ko = interdits.filter(([, re]) => re.test(vis)).map(([l]) => l)
  console.log(`      confidentialite : ${ko.length ? 'KO -> ' + ko.join(', ') : 'OK'}`)

  console.log('[6] Capture')
  await mkdir(OUT, { recursive: true })
  const p = path.join(OUT, FILE)
  await page.screenshot({ path: p, fullPage: false, type: 'png', animations: 'disabled', caret: 'hide' })
  const b = await readFile(p)
  console.log('\n--------------------------------------------')
  console.log(`Dimensions : ${b.readUInt32BE(16)} x ${b.readUInt32BE(20)} px`)
  console.log(`Fichier    : ${p}`)
  console.log(`Poids      : ${(b.length / 1048576).toFixed(2)} Mo`)
  console.log(`Elements attendus manquants : ${manquants}`)
  console.log(`Termes interdits : ${ko.length ? ko.join(', ') : 'aucun'}`)
  console.log(manquants || ko.length ? 'PLAN 9 A REVOIR' : 'PLAN 9 OK')
  console.log('--------------------------------------------\n')
  console.log('--- texte effectivement visible dans le cadre ---')
  console.log(vis.slice(0, 1400))
  console.log('--- fin ---')
} catch (e) {
  console.error(`ECHEC : ${e.message.split('\n')[0]}`)
  await mkdir(OUT, { recursive: true })
  await page.screenshot({ path: path.join(OUT, 'plan9_debug.png'), fullPage: false, type: 'png' }).catch(() => {})
  console.error(`URL : ${page.url()}`)
  console.error((await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')).slice(0, 1000))
  process.exitCode = 1
} finally {
  await ctx.close().catch(() => {})
  await browser.close().catch(() => {})
}
