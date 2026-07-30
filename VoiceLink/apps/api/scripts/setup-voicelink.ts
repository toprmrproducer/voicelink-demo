/**
 * One-command VoiceLink wiring. For each DID the reseller already has a
 * call-routing record for, this creates a WebSocket bot pointing at our
 * public WS URL and routes that DID (inbound + outbound) to the bot.
 *
 * Requires in apps/api/.env: VOICELINK_RESELLER_TOKEN, VOICELINK_API_BASE,
 * WS_BASE_URL (wss://<your-tunnel-host>).
 *
 *   pnpm --filter @voiceplatform/api exec tsx scripts/setup-voicelink.ts
 */
import "dotenv/config";

const BASE = (process.env.VOICELINK_API_BASE || "https://app.voicelink.co.in/api").replace(/\/+$/, "");
const TOKEN = process.env.VOICELINK_RESELLER_TOKEN;
const WS = process.env.WS_BASE_URL;

if (!TOKEN || !WS) {
  console.error("Set VOICELINK_RESELLER_TOKEN and WS_BASE_URL in apps/api/.env first.");
  process.exit(1);
}
const HTTP = WS.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

async function vl<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/json", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j: unknown;
  try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 200)}`);
  return j as T;
}

async function main() {
  const clients = await vl<{ data: { id: number; name: string }[] }>("GET", "/v1/reseller/clients");
  const clientId = clients.data?.[0]?.id;
  if (!clientId) throw new Error("no client found on this reseller account");
  console.log(`client: ${clients.data[0].name} (${clientId})`);

  const routing = await vl<{ data: { id: number; did_number: number }[] }>("GET", "/v1/call-routing/list");
  if (!routing.data?.length) {
    console.error("No call-routing records. Assign a DID to your client in the VoiceLink dashboard first.");
    process.exit(1);
  }

  for (const r of routing.data) {
    const num = String(r.did_number);
    const bot = await vl<{ data: { id: number } }>("POST", "/v1/websocket-bot/create", {
      bot_name: `RapidX AI - ${num}`,
      websocket_url: `${WS}/ws/voicelink/${num}`,
      webhook_url: `${HTTP}/webhooks/voicelink`,
      status: 1,
      client_id: clientId,
    });
    const botId = bot.data?.id;
    await vl("POST", `/v1/call-routing/update/${r.id}`, {
      for_inbound_call: 3, inbound_websocket_bot_id: botId,
      for_outbound_call: 3, outbound_websocket_bot_id: botId,
      status: 1,
    });
    console.log(`wired ${num} -> websocket bot ${botId} (inbound + outbound)`);
  }
  console.log("Done. Now run scripts/seed.ts, then call from the dashboard.");
}

main().catch((e) => { console.error(e); process.exit(1); });
