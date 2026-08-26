// Orphan photo garbage collector. Path-ownership (DB patch 6) stops MISPLACED
// and pre-claimed objects, but a genuine partial failure (object uploaded, then
// the photos row insert failed) still leaves an object with no photos row.
// Those are invisible (bucket listing is moderator-only) and otherwise never
// collected. This scheduled job lists the sign-photos bucket, and removes any
// object that (a) has no photos.image_url pointing at it AND (b) is older than a
// grace window — the window prevents racing an in-flight upload whose row has
// not yet landed.
//
// Service-role (must list + delete across all owners), gated by x-cron-secret.
// dryRun defaults TRUE: returns candidates without deleting.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("PURGE_CRON_SECRET") || "";
const PHOTO_BUCKET = "sign-photos";
const PUBLIC_TOKEN = "/storage/v1/object/public/sign-photos/";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// photos.image_url (public URL or bare key) -> storage key.
function toStorageKey(urlOrPath: string): string {
  const raw = String(urlOrPath || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, "");
  const idx = raw.indexOf(PUBLIC_TOKEN);
  if (idx < 0) return "";
  try { return decodeURIComponent(raw.slice(idx + PUBLIC_TOKEN.length)); } catch { return raw.slice(idx + PUBLIC_TOKEN.length); }
}

// Enumerate every object in the bucket via a keyset-paginated definer RPC
// (DB patch 7). The Storage list API is per-folder and non-recursive, so at
// production volume walking folders exhausts the worker; one indexed query per
// 1000 rows against storage.objects scales instead.
async function listAllKeys(sb: ReturnType<typeof createClient>): Promise<{ key: string; createdAt: number }[]> {
  const out: { key: string; createdAt: number }[] = [];
  let after: string | null = null;
  const page = 1000;
  for (;;) {
    const { data, error } = await sb.rpc("list_sign_photo_objects", { p_after: after, p_limit: page });
    if (error) throw error;
    const rows = (data || []) as { name: string; created_at: string | null }[];
    for (const r of rows) {
      const created = r.created_at ? Date.parse(r.created_at) : 0;
      out.push({ key: r.name, createdAt: Number.isFinite(created) ? created : 0 });
    }
    if (rows.length < page) break;
    after = rows[rows.length - 1].name;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "missing_service_role_env" }, 500);
  if (CRON_SECRET) {
    const token = req.headers.get("x-cron-secret") || "";
    if (token !== CRON_SECRET) return json({ ok: false, error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dryRun !== false;                       // default true
  const graceHours = Number.isFinite(Number(body?.graceHours)) ? Math.max(1, Number(body.graceHours)) : 24;
  const graceCutoff = Date.now() - graceHours * 3600 * 1000;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    // 1. Every referenced key, from photos.image_url (paged).
    const referenced = new Set<string>();
    let from = 0;
    const page = 1000;
    for (;;) {
      const { data, error } = await sb.from("photos").select("image_url").range(from, from + page - 1);
      if (error) throw error;
      const rows = data || [];
      for (const r of rows) { const k = toStorageKey(r.image_url); if (k) referenced.add(k); }
      if (rows.length < page) break;
      from += page;
    }

    // 2. Every object; an orphan is unreferenced AND older than the grace window.
    const all = await listAllKeys(sb);
    const orphans = all.filter((o) => !referenced.has(o.key) && o.createdAt > 0 && o.createdAt < graceCutoff);
    const tooFresh = all.filter((o) => !referenced.has(o.key) && !(o.createdAt > 0 && o.createdAt < graceCutoff)).length;

    let removed = 0;
    if (!dryRun && orphans.length) {
      for (let i = 0; i < orphans.length; i += 100) {
        const batch = orphans.slice(i, i + 100).map((o) => o.key);
        const { error } = await sb.storage.from(PHOTO_BUCKET).remove(batch);
        if (error) throw error;
        removed += batch.length;
      }
    }

    return json({
      ok: true, dryRun, graceHours,
      objects: all.length, referenced: referenced.size,
      orphanCandidates: orphans.length, skippedWithinGrace: tooFresh,
      removed,
      sample: orphans.slice(0, 20).map((o) => o.key),
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
