import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
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

function toStoragePath(urlOrPath: string): string {
  const raw = String(urlOrPath || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) return raw;
  const token = "/storage/v1/object/public/sign-photos/";
  const idx = raw.indexOf(token);
  if (idx < 0) return "";
  return decodeURIComponent(raw.slice(idx + token.length));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "missing_service_role_env" }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (CRON_SECRET) {
      const token = req.headers.get("x-cron-secret") || "";
      if (!token || token !== CRON_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
          status: 401,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json().catch(() => ({}));
    const days = Number.isFinite(Number(body?.days)) ? Math.max(1, Number(body.days)) : 30;
    const pageSize = Number.isFinite(Number(body?.pageSize)) ? Math.max(100, Number(body.pageSize)) : 1000;
    const dryRun = body?.dryRun === true;

    const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const reportIds: string[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from("reports")
        .select("id")
        .eq("is_deleted", true)
        .not("deleted_at", "is", null)
        .lte("deleted_at", cutoffIso)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) break;
      for (const r of rows) {
        if (r?.id) reportIds.push(String(r.id));
      }
      if (rows.length < pageSize) break;
      from += rows.length;
    }

    let storageRemoved = 0;
    const warnings: string[] = [];

    if (reportIds.length) {
      const reportChunks = chunk(reportIds, 200);
      for (const ids of reportChunks) {
        const { data: photos, error: phErr } = await sb
          .from("photos")
          .select("image_url")
          .in("report_id", ids);
        if (phErr) {
          warnings.push(`photo_query_failed:${phErr.message}`);
          continue;
        }
        const paths = (Array.isArray(photos) ? photos : [])
          .map((p: Record<string, unknown>) => toStoragePath(String(p?.image_url || "")))
          .filter(Boolean);
        if (!paths.length) continue;

        if (!dryRun) {
          const pathChunks = chunk(paths, 100);
          for (const c of pathChunks) {
            const { error: rmErr } = await sb.storage.from(PHOTO_BUCKET).remove(c);
            if (rmErr) warnings.push(`storage_remove_warning:${rmErr.message}`);
            else storageRemoved += c.length;
          }
        }
      }
    }

    let purgeResult: unknown = null;
    if (!dryRun) {
      const { data, error } = await sb.rpc("purge_soft_deleted_rows", { cutoff: cutoffIso });
      if (error) throw error;
      purgeResult = data;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        cutoff: cutoffIso,
        days,
        reportCandidates: reportIds.length,
        storageRemoved,
        dryRun,
        purgeResult,
        warnings,
      }),
      {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      },
    );
  }
});

