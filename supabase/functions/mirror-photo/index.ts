// Mirrors a remote image into Storage unchanged and returns its public URL.
//
// A plain fetch → store proxy: the caller (the KML importer) asks Google for the
// rendition it wants (e.g. `fife=s800-rj-l60`), so the bytes arrive already
// resized and compressed. This function exists only because the image host
// sends no CORS headers, so the browser cannot read the bytes itself.
//
// It uploads AS THE CALLER (the forwarded JWT), NOT the service role, so the
// upload is subject to the `sign-photos` storage RLS — the same path-ownership
// rule (`can_write_sign_photo`) that governs direct client uploads (DB patch 6).
// There is no service-role bypass and no in-code auth gate: RLS is the single
// enforcement point (moderator, or approved member writing to their own pending
// report's folder). verify_jwt=true still requires a signed-in caller.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.5";

type Req = {
  url: string;
  path: string;          // storage key, e.g. {pin_id}/{report_id}/{photo_id}.jpg
  bucket?: string;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const FETCH_TIMEOUT_MS = 30_000;
const MAX_BYTES = 10 * 1024 * 1024; // sanity ceiling — a rendition should be tens of KB

const EXT_FOR_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
};

function json(body: unknown) {
  // Always 200 so the client sees the exact error instead of invoke() swallowing it.
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36" },
    });
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = (await req.json()) as Req;
    if (!body?.url) return json({ ok: false, error: "Missing 'url' in request body" });
    if (!body?.path?.trim()) return json({ ok: false, error: "Missing 'path' in request body" });
    if (!SUPABASE_URL || !ANON_KEY) return json({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" });

    const bucket = (body.bucket || "sign-photos").trim();

    // Upload as the caller: their JWT is forwarded, so storage RLS decides
    // whether this path may be written (path-ownership; no service role).
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ ok: false, error: "unauthorized" });
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const res = await fetchWithTimeout(body.url, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) throw new Error(`not an image: ${contentType || "unknown"}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) throw new Error("empty image");
    if (bytes.length > MAX_BYTES) throw new Error(`too large: ${bytes.length} bytes`);

    // Keep the caller's key; only add an extension if it has none.
    let path = body.path.trim();
    if (!/\.[a-z0-9]{2,5}$/i.test(path)) path += EXT_FOR_TYPE[contentType] || ".jpg";

    const { error: upErr } = await asCaller.storage.from(bucket).upload(path, bytes, {
      contentType,
      upsert: false,
      cacheControl: "31536000",
    });
    if (upErr) throw upErr;

    const { data } = asCaller.storage.from(bucket).getPublicUrl(path);
    return json({ ok: true, status: "mirrored", publicUrl: data.publicUrl, size: bytes.length, contentType });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});
