// Headless smoke: build preview + load each route, report redirects, map presence and console/page errors.
// Usage: npm run build && node scripts/smoke-routes.mjs   (needs Chrome; uses playwright-core from devDependencies)
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const port = Number(process.env.SMOKE_PORT || 4177)
const routes = (process.env.SMOKE_ROUTES || '/,/dashboard,/export,/reports,/import-kml').split(',')
const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => existsSync(p))

const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', shell: true })
await new Promise((r) => setTimeout(r, 4000))
const browser = await chromium.launch({ headless: true, executablePath: chrome })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`) })

let failed = false
for (const path of routes) {
  try {
    await page.goto(`http://localhost:${port}${path}`, { waitUntil: 'networkidle', timeout: 30000 })
    const landed = page.url().replace(`http://localhost:${port}`, '')
    const hasMap = (await page.$('.leaflet-container')) !== null
    console.log(`${path.padEnd(12)} → ${landed.padEnd(12)} ${hasMap ? 'leaflet map present' : ''}`)
  } catch (e) { failed = true; console.log(`${path} FAILED: ${e.message}`) }
}
console.log('errors:', errors.length ? errors.slice(0, 10) : 'none')
await browser.close(); srv.kill()
process.exit(failed || errors.some((e) => e.startsWith('pageerror')) ? 1 : 0)
