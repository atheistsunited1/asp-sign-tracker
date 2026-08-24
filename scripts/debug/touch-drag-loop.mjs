// Touch-dynamics debug harness (mobile ghost-pin drag).
//
// Drives the locally installed Chrome via playwright-core with mobile
// emulation and raw CDP Input.dispatchTouchEvent — trusted touch that runs
// through the browser's real gesture pipeline (touch-action, pointercancel,
// gesture recognition), unlike synthetic clicks or dispatched DOM events.
//
// Requires: the local Supabase stack running (supabase start, schema applied,
// localadmin test user present) and the dev server on :5173 pointed at it.
// Run: node scripts/debug/touch-drag-loop.mjs
//
// Tests: A drag from icon center, B from the visual tip, C from a 28px
// finger-miss (inside the padded hit box), D from 50px outside (control —
// the map should pan). A/B/C green + D pan = touch drag healthy.
import { chromium } from 'playwright-core'
import { createClient } from '@supabase/supabase-js'

const URL_ = 'http://127.0.0.1:54321'
// The two keys below are Supabase's PUBLIC local-dev demo keys (iss: supabase-demo,
// published in the Supabase CLI docs) — not credentials. Safe in a public repo.
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

// Fresh admin session (throwaway local user)
const admin = createClient(URL_, SERVICE)
const email = 'localadmin@example.test'
const password = Math.random().toString(36) + 'A1!'
const { data: list } = await admin.auth.admin.listUsers()
const uid = list.users.find(u => u.email === email)?.id
await admin.auth.admin.updateUserById(uid, { password })
const anon = createClient(URL_, ANON)
const { data: sess, error: sErr } = await anon.auth.signInWithPassword({ email, password })
if (sErr) throw sErr

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
})
const session = sess.session
await context.addInitScript(`
  try { localStorage.setItem('sb-127-auth-token', ${JSON.stringify(JSON.stringify(session))}) } catch {}
`)
const page = await context.newPage()
page.on('console', m => { const t = m.text(); if (/DEBUG-19|error/i.test(t)) console.log('PAGE:', t.slice(0, 160)) })

await page.goto('http://localhost:5173/?ll=41.878100,-87.629800&z=17', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)

const cdp = await context.newCDPSession(page)
async function touchDrag(x1, y1, x2, y2, steps = 12) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] })
  for (let i = 1; i <= steps; i++) {
    const x = x1 + (x2 - x1) * i / steps
    const y = y1 + (y2 - y1) * i / steps
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
async function touchTap(x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await page.waitForTimeout(60)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

const state = () => page.evaluate(() => {
  const d = document.querySelector('.leaflet-marker-draggable')
  const img = d?.querySelector('img') || d
  const r = img?.getBoundingClientRect()
  return {
    ghost: r ? { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2), tipY: Math.round(r.bottom) } : null,
    popup: (document.querySelector('.leaflet-popup-content')?.textContent || '').slice(0, 50),
    url: location.search,
  }
})

// 1) tap the pin (center of viewport at start) to open popup
await touchTap(195, 450)
await page.waitForTimeout(2500)
let s = await state()
console.log('after pin tap:', JSON.stringify(s))

// 2) tap Toggle Drag (find its position)
const btn = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Toggle Drag'))
  if (!b) return null
  b.scrollIntoView({ block: 'center' })
  const r = b.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
console.log('toggle btn at:', JSON.stringify(btn))
if (!btn) { console.log('POPUP TEXT:', (await state()).popup); // 5) TEST C: touch-drag starting 30px OUTSIDE the icon rect (fat-finger miss)
await page.evaluate(() => { const c = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Cancel')); c?.click() })
await page.waitForTimeout(800)
s = await state()
if (!s.ghost) {
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Toggle Drag')); b?.click() })
  await page.waitForTimeout(800)
  s = await state()
}
if (s.ghost) {
  const b3 = s
  const startX = s.ghost.cx
  const startY = s.ghost.tipY + 28   // 28px below the VISUAL tip — inside the 32px pad
  await touchDrag(startX, startY, startX + 80, startY - 120)
  await page.waitForTimeout(1200)
  const after3 = await state()
  const movedPopup = after3.popup.includes('Pin moved')
  console.log('TEST C (28px finger miss, inside pad): dragWorked=', movedPopup)

  // TEST D: well outside the pad (~50px left of the visual edge) — map pan expected
  await page.evaluate(() => { const c = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Cancel')); c?.click() })
  await page.waitForTimeout(800)
  let s4 = await state()
  if (!s4.ghost) {
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Toggle Drag')); b?.click() })
    await page.waitForTimeout(800)
    s4 = await state()
  }
  if (s4.ghost) {
    const sx = s4.ghost.cx - 12 - 32 - 50
    const sy = s4.ghost.cy
    await touchDrag(sx, sy, sx + 80, sy - 120)
    await page.waitForTimeout(1500)
    const after4 = await state()
    console.log('TEST D (50px outside pad): movedPopup=', after4.popup.includes('Pin moved'), 'mapPanned=', after4.url !== s4.url)
  }
}

await browser.close(); process.exit(1) }
await page.tap('text=Toggle Drag')
await page.waitForTimeout(1200)
s = await state()
console.log('after toggle tap:', JSON.stringify(s))

if (!s.ghost) { console.log('VERDICT: toggle tap did not enable drag (mobile tap on button failed)'); // 5) TEST C: touch-drag starting 30px OUTSIDE the icon rect (fat-finger miss)
await page.evaluate(() => { const c = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Cancel')); c?.click() })
await page.waitForTimeout(800)
s = await state()
if (!s.ghost) {
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Toggle Drag')); b?.click() })
  await page.waitForTimeout(800)
  s = await state()
}
if (s.ghost) {
  const b3 = s
  const startX = s.ghost.cx
  const startY = s.ghost.tipY + 28   // 28px below the VISUAL tip — inside the 32px pad
  await touchDrag(startX, startY, startX + 80, startY - 120)
  await page.waitForTimeout(1200)
  const after3 = await state()
  const movedPopup = after3.popup.includes('Pin moved')
  console.log('TEST C (28px finger miss, inside pad): dragWorked=', movedPopup)

  // TEST D: well outside the pad (~50px left of the visual edge) — map pan expected
  await page.evaluate(() => { const c = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Cancel')); c?.click() })
  await page.waitForTimeout(800)
  let s4 = await state()
  if (!s4.ghost) {
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Toggle Drag')); b?.click() })
    await page.waitForTimeout(800)
    s4 = await state()
  }
  if (s4.ghost) {
    const sx = s4.ghost.cx - 12 - 32 - 50
    const sy = s4.ghost.cy
    await touchDrag(sx, sy, sx + 80, sy - 120)
    await page.waitForTimeout(1500)
    const after4 = await state()
    console.log('TEST D (50px outside pad): movedPopup=', after4.popup.includes('Pin moved'), 'mapPanned=', after4.url !== s4.url)
  }
}

await browser.close(); process.exit(0) }

// 3) TEST A: touch-drag from ghost ICON CENTER
const before = s
await touchDrag(s.ghost.cx, s.ghost.cy, s.ghost.cx + 80, s.ghost.cy - 120)
await page.waitForTimeout(1200)
let after = await state()
const mapPannedA = after.url !== before.url
const ghostMovedA = after.ghost && (Math.abs(after.ghost.cx - before.ghost.cx) > 20 || Math.abs(after.ghost.cy - before.ghost.cy) > 20)
console.log('TEST A (icon center): ghostMoved=', ghostMovedA, 'mapPanned=', mapPannedA, 'popup=', after.popup)

// reset if it moved (cancel via popup button if present)
await page.evaluate(() => { const c = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Cancel')); c?.click() })
await page.waitForTimeout(800)

// 4) TEST B: touch-drag from the LATLNG POINT (bottom tip — where users aim)
s = await state()
if (!s.ghost) {
  // drag was disabled by cancel; re-enable
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Toggle Drag')); b?.click() })
  await page.waitForTimeout(800)
  s = await state()
}
if (s.ghost) {
  const startX = s.ghost.cx
  const startY = s.ghost.tipY - 3   // the pointy tail at the latlng — the red dot users aim at
  const b2 = s
  await touchDrag(startX, startY, startX + 80, startY - 120)
  await page.waitForTimeout(1200)
  after = await state()
  const mapPannedB = after.url !== b2.url
  const ghostMovedB = after.ghost && (Math.abs(after.ghost.cx - b2.ghost.cx) > 20 || Math.abs(after.ghost.cy - b2.ghost.cy) > 20)
  console.log('TEST B (latlng tip): ghostMoved=', ghostMovedB, 'mapPanned=', mapPannedB, 'popup=', after.popup)
}

// 5) TEST C: touch-drag starting 30px OUTSIDE the icon rect (fat-finger miss)
await page.evaluate(() => { const c = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Cancel')); c?.click() })
await page.waitForTimeout(800)
s = await state()
if (!s.ghost) {
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Toggle Drag')); b?.click() })
  await page.waitForTimeout(800)
  s = await state()
}
if (s.ghost) {
  const b3 = s
  const startX = s.ghost.cx
  const startY = s.ghost.tipY + 28   // 28px below the VISUAL tip — inside the 32px pad
  await touchDrag(startX, startY, startX + 80, startY - 120)
  await page.waitForTimeout(1200)
  const after3 = await state()
  const movedPopup = after3.popup.includes('Pin moved')
  console.log('TEST C (28px finger miss, inside pad): dragWorked=', movedPopup)

  // TEST D: well outside the pad (~50px left of the visual edge) — map pan expected
  await page.evaluate(() => { const c = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Cancel')); c?.click() })
  await page.waitForTimeout(800)
  let s4 = await state()
  if (!s4.ghost) {
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Toggle Drag')); b?.click() })
    await page.waitForTimeout(800)
    s4 = await state()
  }
  if (s4.ghost) {
    const sx = s4.ghost.cx - 12 - 32 - 50
    const sy = s4.ghost.cy
    await touchDrag(sx, sy, sx + 80, sy - 120)
    await page.waitForTimeout(1500)
    const after4 = await state()
    console.log('TEST D (50px outside pad): movedPopup=', after4.popup.includes('Pin moved'), 'mapPanned=', after4.url !== s4.url)
  }
}

await browser.close()
