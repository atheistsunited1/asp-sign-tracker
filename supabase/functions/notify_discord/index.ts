// Discord notifications, one channel per region. The client sends a region
// code (US state, or ON / NZ); the webhook is looked up generically as
// DISCORD_WEBHOOK_<CODE> with combined-channel aliases, falling back to
// DISCORD_WEBHOOK_DEFAULT — the #uncharted-waters channel — for unmatched or
// not-yet-wired regions. Wiring instructions live in the repo's issue tracker.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Combined / non-US channels share one secret name.
const ALIASES: Record<string, string> = {
  MD: "MD_DC",            // #maryland-and-dc (there is no separate #maryland)
  DC: "MD_DC",
  ON: "CAN_ONTARIO",      // #can-ontario
  NZ: "NEW_ZEALAND",      // #new-zealand
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  const body = await req.json().catch(() => ({}));
  const content = String(body.text ?? body.content ?? "").trim() || "New sighting submitted";
  const photos: string[] = Array.isArray(body.photos) ? body.photos.slice(0, 4) : [];
  const region = (typeof body.state === "string" && body.state.trim().toUpperCase()) || "";

  const username = Deno.env.get("DISCORD_USERNAME") ?? "ASP Notifier";

  // Webhook selection: alias → DISCORD_WEBHOOK_<CODE> → #uncharted-waters default.
  const code = (ALIASES[region] ?? region).replace(/[^A-Z_]/g, "");
  const webhook = (code && Deno.env.get(`DISCORD_WEBHOOK_${code}`)) ||
    Deno.env.get("DISCORD_WEBHOOK_DEFAULT");

  if (!webhook) {
    return new Response(JSON.stringify({ ok: false, error: "missing_webhook" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Up to 10 embeds allowed; we send up to 4, one per photo.
  const embeds = photos.map((url: string) => ({
    type: "image",
    image: { url },
  }));

  const resp = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, username, embeds }),
  });

  const ok = resp.status >= 200 && resp.status < 300;
  return new Response(JSON.stringify({ ok, status: resp.status }), {
    status: ok ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
