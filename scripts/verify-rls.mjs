#!/usr/bin/env node
/**
 * verify-rls.mjs — executable definition of done for the RLS hardening
 * (issue #7, patches 000001/000002).
 *
 * Probes the live Supabase REST API as each actor and checks that forbidden
 * operations fail and permitted ones succeed.
 *
 * Usage:
 *   node scripts/verify-rls.mjs                  # anon probes only (read-only, always safe)
 *   VERIFY_MEMBER_EMAIL=… VERIFY_MEMBER_PASSWORD=… node scripts/verify-rls.mjs
 *   VERIFY_ADMIN_EMAIL=…  VERIFY_ADMIN_PASSWORD=…  node scripts/verify-rls.mjs
 *   node scripts/verify-rls.mjs --write          # adds member write-lifecycle probes;
 *                                                # leaves one pending test pin labelled
 *                                                # "RLS-VERIFY test pin" for a moderator to deny.
 *
 * Connection comes from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (env or root .env).
 * Safety: this script never mutates rows it did not create, and every
 * purge_soft_deleted_rows probe passes HARMLESS_CUTOFF (1970) so no row can be
 * eligible for hard deletion. Never probe that function with its default cutoff.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')

// Any purge probe must pass an explicit cutoff older than the project itself, so
// no row is ever eligible for hard deletion by this script.
const HARMLESS_CUTOFF = '1970-01-01T00:00:00.000Z'

function loadEnv() {
  const env = { ...process.env }
  for (const file of ['.env', '.env.local']) {
    try {
      for (const line of readFileSync(resolve(root, file), 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
        if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    } catch { /* file absent is fine */ }
  }
  return env
}

const env = loadEnv()
const URL = env.VITE_SUPABASE_URL
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
if (!URL || !ANON_KEY) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (env or .env).')
  process.exit(2)
}

const results = []
function record(actor, name, pass, detail = '') {
  results.push({ actor, name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${actor}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// A denied operation may surface as an explicit error (42501 permission denied)
// or, for RLS-filtered UPDATE/DELETE, as zero affected rows.
const denied = (error, data) => !!error || (Array.isArray(data) && data.length === 0)

async function anonProbes() {
  const anon = createClient(URL, ANON_KEY)
  const actor = 'anon'

  {
    const { data, error } = await anon.from('pins').select('id,is_deleted').limit(5)
    record(actor, 'may read public pins', !error && Array.isArray(data),
      error ? error.message : `${data.length} row(s)`)
    if (data?.some(p => p.is_deleted)) record(actor, 'sees no soft-deleted pins', false)
  }
  for (const table of ['profiles', 'reports', 'photos']) {
    const { data, error } = await anon.from(table).select('*').limit(1)
    record(actor, `cannot read ${table}`, !!error || data.length === 0,
      error ? error.code : data.length ? 'ROWS RETURNED' : 'empty')
  }
  {
    const { error } = await anon.from('pins')
      .insert({ lat: 0, lng: 0, sign_text: 'RLS-VERIFY anon insert (must fail)' })
    record(actor, 'cannot insert pins', !!error, error?.code ?? 'INSERT SUCCEEDED')
  }
  {
    const { data, error } = await anon.from('pins')
      .update({ sign_text: 'RLS-VERIFY anon update (must fail)' })
      .eq('id', '00000000-0000-0000-0000-000000000000').select()
    record(actor, 'cannot update pins', denied(error, data), error?.code ?? '')
  }
  {
    // NEVER call this with the default cutoff: purge_soft_deleted_rows() hard-
    // deletes every soft-deleted row older than the cutoff. HARMLESS_CUTOFF is
    // before the project existed, so nothing is eligible even if the call is
    // permitted — the probe tests authorization, not deletion.
    const { error } = await anon.rpc('purge_soft_deleted_rows', { cutoff: HARMLESS_CUTOFF })
    record(actor, 'cannot execute purge_soft_deleted_rows', !!error, error?.code ?? 'EXECUTED')
  }
  {
    const { error } = await anon.rpc('login_email_for_username', { u: '__rls_verify_nobody__' })
    record(actor, 'may call login_email_for_username', !error, error?.message ?? '')
  }
}

async function signIn(label, email, password) {
  const client = createClient(URL, ANON_KEY)
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) {
    record(label, 'sign in', false, error.message)
    return null
  }
  return { client, uid: data.user.id }
}

async function memberProbes(email, password) {
  const actor = 'member'
  const s = await signIn(actor, email, password)
  if (!s) return
  const { client, uid } = s

  {
    const { data, error } = await client.from('reports').select('id,submitted_by,is_deleted').limit(50)
    record(actor, 'may read reports', !error, error?.message ?? `${data?.length} row(s)`)
    if (data?.some(r => r.is_deleted)) record(actor, 'sees no soft-deleted reports', false)

    const foreign = data?.find(r => r.submitted_by && r.submitted_by !== uid)
    if (foreign) {
      const { data: upd, error: uerr } = await client.from('reports')
        .update({ is_deleted: false }).eq('id', foreign.id).select()
      record(actor, "cannot update another member's report", denied(uerr, upd), uerr?.code ?? '')
    } else {
      record(actor, "cannot update another member's report", true, 'skipped: no foreign report visible')
    }
  }
  {
    // Patch 000004 model: approved members see all profile ROWS (contributor
    // directory) but the email/zip COLUMNS are withheld from authenticated.
    const { data, error } = await client.from('profiles').select('id, username')
    record(actor, 'may read the contributor directory', !error && data.length >= 1,
      error?.message ?? `${data?.length} row(s)`)
    const { error: colErr } = await client.from('profiles').select('email').limit(1)
    record(actor, 'cannot select email column', !!colErr, colErr?.code ?? 'READABLE')
    const { error: zipErr } = await client.from('profiles').select('zip').limit(1)
    record(actor, 'cannot select zip column', !!zipErr, zipErr?.code ?? 'READABLE')
  }
  {
    const { data, error } = await client.from('profiles')
      .update({ role: 'admin', is_approved: true }).eq('id', uid).select()
    record(actor, 'cannot self-escalate role/approval', denied(error, data), error?.code ?? '')
  }
  {
    const { error } = await client.rpc('purge_soft_deleted_rows', { cutoff: HARMLESS_CUTOFF })
    record(actor, 'cannot execute purge_soft_deleted_rows', !!error, error?.code ?? 'EXECUTED')
  }

  if (WRITE) {
    const { data: pin, error } = await client.from('pins')
      .insert({ lat: 0.001, lng: 0.001, sign_text: 'RLS-VERIFY test pin', submitted_by: uid })
      .select().single()
    record(actor, 'may insert a pin (enters pending)', !error && pin?.is_approved === false,
      error?.message ?? `is_approved=${pin?.is_approved}`)
    if (pin) {
      const { data: ok } = await client.from('pins')
        .update({ sign_text: 'RLS-VERIFY test pin (edited)' }).eq('id', pin.id).select()
      record(actor, 'may edit own pending pin', ok?.length === 1)
      const { data: esc, error: eerr } = await client.from('pins')
        .update({ is_approved: true }).eq('id', pin.id).select()
      record(actor, 'cannot approve own pin', denied(eerr, esc), eerr?.code ?? '')
      console.log(`  note: test pin ${pin.id} left pending — deny it from the deleted-pins/moderation UI.`)
    }
  }
  await client.auth.signOut()
}

async function adminProbes(email, password) {
  const actor = 'admin'
  const s = await signIn(actor, email, password)
  if (!s) return
  const { client, uid } = s

  {
    const { data, error } = await client.from('profiles').select('id')
    record(actor, 'may read all profiles', !error && data.length >= 1, error?.message ?? `${data?.length} row(s)`)
  }
  {
    // RETURNING must name permitted columns only — select('*') after an update
    // would hit the withheld email/zip columns and fail on column privilege.
    // Same-value role write: the guard trigger only rejects actual changes.
    const { data, error } = await client.from('profiles')
      .update({ role: 'admin' }).eq('id', uid).select('id, role')
    record(actor, 'may write own profile', !error && data?.length === 1,
      error?.message ?? '')
  }
  await client.auth.signOut()
}

console.log(`Target: ${URL}${WRITE ? '  (write probes ON)' : '  (read-only probes)'}`)
await anonProbes()
if (env.VERIFY_MEMBER_EMAIL && env.VERIFY_MEMBER_PASSWORD) {
  await memberProbes(env.VERIFY_MEMBER_EMAIL, env.VERIFY_MEMBER_PASSWORD)
} else {
  console.log('note: member probes skipped (set VERIFY_MEMBER_EMAIL / VERIFY_MEMBER_PASSWORD)')
}
if (env.VERIFY_ADMIN_EMAIL && env.VERIFY_ADMIN_PASSWORD) {
  await adminProbes(env.VERIFY_ADMIN_EMAIL, env.VERIFY_ADMIN_PASSWORD)
} else {
  console.log('note: admin probes skipped (set VERIFY_ADMIN_EMAIL / VERIFY_ADMIN_PASSWORD)')
}

const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} probes passed`)
process.exit(failed.length ? 1 : 0)
