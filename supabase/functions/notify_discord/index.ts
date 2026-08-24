// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // optionally lock to your Netlify origin
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  const body = await req.json().catch(() => ({}));
  // accept either { text } or { content } from the client
  const content = String(body.text ?? body.content ?? "").trim() || "New sighting submitted";
  const photos: string[] = Array.isArray(body.photos) ? body.photos.slice(0, 4) : [];
  const state = (typeof body.state === "string" && body.state.trim().toUpperCase()) || "";

  const username = Deno.env.get("DISCORD_USERNAME") ?? "ASP Notifier";

  // Webhook selection
  const defaultHook = Deno.env.get("DISCORD_WEBHOOK_DEFAULT");
  const hooks: Record<string, string | undefined> = {
    "CA": Deno.env.get("DISCORD_WEBHOOK_CA"),
    "SC": Deno.env.get("DISCORD_WEBHOOK_SC"),
    "TX": Deno.env.get("DISCORD_WEBHOOK_TX"),
    "NC": Deno.env.get("DISCORD_WEBHOOK_NC"),
    "OR": Deno.env.get("DISCORD_WEBHOOK_OR"),
    "GA": Deno.env.get("DISCORD_WEBHOOK_GA"),
  };
  const webhook = hooks[state] || defaultHook;

  if (!webhook) {
    return new Response(JSON.stringify({ ok: false, error: "missing_webhook" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Up to 10 embeds allowed; we’ll send up to 4, one per photo.
  const embeds = photos.map((url: string) => ({
    type: "image",
    image: { url },
  }));
  
  const resp = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Discord webhooks expect { content, username, avatar_url, embeds? }
    body: JSON.stringify({ content, username, embeds }),
  });

  // Discord usually returns 204 No Content on success
  const ok = resp.status >= 200 && resp.status < 300;
  return new Response(JSON.stringify({ ok, status: resp.status }), {
    status: ok ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
