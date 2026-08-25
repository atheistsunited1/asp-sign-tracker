// Username + password -> session tokens. The username->email lookup happens
// server-side with the service role and is NEVER disclosed: every failure --
// unknown username or wrong password -- returns the same 400, and a decoy
// auth attempt keeps timing roughly uniform when the username doesn't exist.
// Brute-force protection is GoTrue's own password rate limiting, since every
// attempt forwards to the token endpoint. (The old client-side
// login_email_for_username RPC leaked the email mapping; this replaces it.)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const fail = () =>
  new Response(JSON.stringify({ error: "Invalid username or password" }), {
    status: 400,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS });
  }

  let body: { username?: string; password?: string };
  try { body = await req.json(); } catch { return fail(); }
  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  if (!username || !password || username.includes("@") || username.length > 64) return fail();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  // ilike with escaped wildcards = case-insensitive equality
  const escaped = username.replace(/([%_\\])/g, "\\$1");
  const { data: row } = await admin
    .from("profiles").select("email").ilike("username", escaped).limit(1).maybeSingle();

  // Decoy keeps the GoTrue round-trip even for unknown usernames (timing).
  const email = row?.email || `decoy-${crypto.randomUUID()}@example.com`;

  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok || !row?.email) return fail();

  const session = await resp.json();
  return new Response(JSON.stringify(session), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
