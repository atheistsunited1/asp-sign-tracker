// Computed-style snapshot for behaviour-neutral CSS moves.
// Build, serve the preview, open `/`, optionally click things to open panels, then dump every element under the
// selected roots as { path, tag, classes, rect, styles } — and compare two dumps.
//
//   npm run build && node scripts/style-snapshot.mjs --out snap-a.json
//   node scripts/style-snapshot.mjs --compare snap-a.json snap-b.json
//
// Env: SNAP_ROOTS  (comma list of root selectors; default: the app shell)
//      SNAP_CLICKS (comma list of selectors to click before the dump, in order; default: the burger)
//      SNAP_WIDTHS (comma list of viewport widths; default 1200,390)   SMOKE_PORT / CHROME_PATH as smoke-routes.mjs
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

if (args[0] === '--compare') {
  const [a, b] = [JSON.parse(readFileSync(args[1], 'utf8')), JSON.parse(readFileSync(args[2], 'utf8'))]
  let diffs = 0
  for (const width of Object.keys({ ...a, ...b })) {
    const A = a[width] || [], B = b[width] || []
    if (A.length !== B.length) { console.log(`[${width}] element count ${A.length} → ${B.length}`); diffs++ }
    const byPath = new Map(B.map((e) => [e.path, e]))
    for (const ea of A) {
      const eb = byPath.get(ea.path)
      if (!eb) { console.log(`[${width}] missing in B: ${ea.path}`); diffs++; continue }
      for (const k of Object.keys(ea.styles)) {
        if (ea.styles[k] !== eb.styles[k]) { console.log(`[${width}] ${ea.path} ${k}: ${ea.styles[k]} → ${eb.styles[k]}`); diffs++ }
      }
      if (JSON.stringify(ea.rect) !== JSON.stringify(eb.rect)) { console.log(`[${width}] ${ea.path} rect ${JSON.stringify(ea.rect)} → ${JSON.stringify(eb.rect)}`); diffs++ }
    }
  }
  console.log(diffs ? `style-snapshot: ${diffs} difference(s)` : 'style-snapshot: identical')
  process.exit(diffs ? 1 : 0)
}

const out = opt('--out') || 'style-snapshot.json'
const port = Number(process.env.SMOKE_PORT || 4178)
const roots = (process.env.SNAP_ROOTS || '.topbar,.status-banner,.drawer,.side-tray').split(',')
const clicks = (process.env.SNAP_CLICKS || '.burger').split(',').filter(Boolean)
const widths = (process.env.SNAP_WIDTHS || '1200,390').split(',').map(Number)
const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => existsSync(p))

if (!existsSync('dist/index.html')) { console.error('style-snapshot: run `npm run build` first'); process.exit(2) }
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', shell: true })
await new Promise((r) => setTimeout(r, 4000))
const browser = await chromium.launch({ headless: true, executablePath: chrome })
const result = {}
try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 800 } })
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle', timeout: 30000 })
    for (const sel of clicks) { try { await page.click(sel, { timeout: 3000 }) } catch (e) { console.log(`click ${sel} skipped: ${e.message.split('\n')[0]}`) } }
    await page.waitForTimeout(600)   // let transitions settle
    result[width] = await page.evaluate((roots) => {
      const out = []
      const pathOf = (el) => {
        const parts = []
        for (let e = el; e && e.nodeType === 1 && parts.length < 12; e = e.parentElement) {
          const idx = e.parentElement ? Array.from(e.parentElement.children).filter((c) => c.tagName === e.tagName).indexOf(e) : 0
          parts.unshift(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}:${idx}`)
        }
        return parts.join('>')
      }
      for (const root of roots) {
        for (const el of document.querySelectorAll(root)) {
          for (const node of [el, ...el.querySelectorAll('*')]) {
            const cs = getComputedStyle(node)
            const styles = {}
            for (let i = 0; i < cs.length; i++) { const k = cs[i]; styles[k] = cs.getPropertyValue(k) }
            const r = node.getBoundingClientRect()
            out.push({ path: pathOf(node), tag: node.tagName, classes: node.className, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], styles })
          }
        }
      }
      return out
    }, roots)
    console.log(`[${width}] ${result[width].length} elements`)
    await page.close()
  }
} finally {
  await browser.close(); srv.kill()
}
writeFileSync(out, JSON.stringify(result))
console.log('wrote', out)
