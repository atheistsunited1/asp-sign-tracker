// Discord notifications via the ASP Notifier bot (issue #6). The client sends
// a region code (US state, or ON / NZ); it resolves through ALIASES + the
// hard-coded CHANNELS map (channel IDs are stable across renames) and posts
// with the bot token via the REST API -- no gateway, no webhooks. Regions
// without a mapped channel, and failed posts, fall back to #uncharted-waters
// (DEFAULT). Adding a regional channel = add its ID here and redeploy; the
// map is regenerated from GET /guilds/{id}/channels (see issue #6).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Generated 2026-08-25 from the AU guild channel list (33 states + specials;
// unlisted states intentionally route to DEFAULT until their channel exists).
const CHANNELS: Record<string, string> = {
  AL: "1272988528787329147", // alabama
  AR: "1272988579165110424", // arkansas
  CA: "1272987985838604401", // california
  CO: "1272988948561399839", // colorado
  FL: "1521324731922513970", // florida
  GA: "1272988171222909069", // georgia
  ID: "1519699748108501033", // idaho
  IL: "1272988981088223232", // illinois
  IN: "1272989009483923536", // indiana
  IA: "1504222396154908734", // iowa
  KY: "1503249045626552340", // kentucky
  LA: "1272989375596335154", // louisiana
  MA: "1272990584952324257", // massachusetts
  MI: "1517632182393372844", // michigan
  MN: "1272990673577967667", // minnesota
  MS: "1507049310729011332", // mississippi
  MT: "1272990721288310927", // montana
  NE: "1526947989132677181", // nebraska
  NJ: "1272990830130364457", // new-jersey
  NY: "1272990865807114271", // new-york
  NC: "1272991098989576253", // north-carolina
  OH: "1272991129075191924", // ohio
  OK: "1524613023556178011", // oklahoma
  OR: "1272991170972352512", // oregon
  PA: "1503253701668896978", // pennsylvania
  SC: "1272991206120357909", // south-carolina
  TN: "1272991241222492181", // tennessee
  TX: "1272991275326636202", // texas
  UT: "1272991374530187364", // utah
  VA: "1272991461960454266", // virginia
  WA: "1504228546518847658", // washington
  WV: "1519463733913583789", // west-virginia
  WI: "1272991573855965284", // wisconsin
  MD_DC: "1272989540793057331", // maryland-and-dc
  CAN_ONTARIO: "1504224955938767049", // can-ontario
  NEW_ZEALAND: "1504224841925005362", // new-zealand
  DEFAULT: "1504224537380917348", // uncharted-waters
};

// Combined / non-US regions share one channel.
const ALIASES: Record<string, string> = {
  MD: "MD_DC",
  DC: "MD_DC",
  ON: "CAN_ONTARIO",
  NZ: "NEW_ZEALAND",
};

async function postToChannel(channelId: string, payload: unknown, token: string) {
  return await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: "missing_bot_token" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const content = String(body.text ?? body.content ?? "").trim() || "New sighting submitted";
  const photos: string[] = Array.isArray(body.photos) ? body.photos.slice(0, 4) : [];
  const region = (typeof body.state === "string" && body.state.trim().toUpperCase()) || "";

  const code = ALIASES[region] ?? region;
  const channelId = CHANNELS[code] ?? CHANNELS.DEFAULT;

  const embeds = photos.map((url: string) => ({ type: "image", image: { url } }));
  const payload = { content, embeds };

  let resp = await postToChannel(channelId, payload, token);
  if (!resp.ok && channelId !== CHANNELS.DEFAULT) {
    // Deleted channel or permission gap: land the message somewhere visible.
    resp = await postToChannel(CHANNELS.DEFAULT, payload, token);
  }

  const ok = resp.status >= 200 && resp.status < 300;
  return new Response(JSON.stringify({ ok, status: resp.status }), {
    status: ok ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
