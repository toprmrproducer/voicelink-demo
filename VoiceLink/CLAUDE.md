# RapidX AI — Voice Platform (VoiceLink + Gemini Live)

RapidX AI branded voice-agent platform. Multi-tenant Node API + Next.js UI that
connects **VoiceLink** telephony (Indian DIDs) to a **Gemini Live** voice agent
for inbound and outbound phone calls.

## Architecture
- `apps/api` — Node/Express API (:4000). MongoDB + Redis. Owns: auth, tenants,
  DIDs, agents, campaigns, credits, the VoiceLink telephony adapter, and the
  realtime voice pipeline (WS bridge + LLM provider).
- `apps/ui` — Next.js 16 dashboard (:3000). Branded "RapidX AI".
- `packages/shared` — zod schemas shared by api + ui. **Build it first**
  (`pnpm --filter @voiceplatform/shared build`) or the api/ui won't resolve types.

## Call flow
- **Inbound**: caller dials a DID → VoiceLink routes to the registered WebSocket
  Bot → opens a WS to `wss://<public>/ws/voicelink/<didId>` → `ws-router` resolves
  DID→agent → `CallSession` bridges µ-law 8k ↔ PCM16 24k ↔ Gemini Live.
- **Outbound**: `POST /v1/add_lead` (VoiceLink) dials the customer and connects
  the same WebSocket Bot.
- VoiceLink also POSTs call events to `/webhooks/voicelink` (format:
  `{event:"call.*", call:{...}}` — handled natively in `webhooks.routes.ts`).

## Key implementation notes (gotchas)
- **Gemini Live provider** (`apps/api/src/adapters/llm/gemini-live.ts`) is the
  real agent brain (the repo shipped it as a stub). Uses `@google/genai`. Model:
  `GEMINI_LIVE_MODEL` (default `gemini-3.1-flash-live-preview`). Gemini Live takes
  16 kHz PCM in / 24 kHz out; the bridge produces 24 kHz, so we downsample 24→16
  on input (`pcm16Resample`). List live models: `GET generativelanguage.googleapis.com/v1beta/models` and filter `bidiGenerateContent`.
- **VoiceLink API base** is `https://app.voicelink.co.in/api` (the creds file has
  the host only — append `/api`). Auth = Sanctum Bearer (token contains a `|`, so
  never `source` the creds file unquoted).
- **Outbound number format**: VoiceLink's carrier rejects full E.164
  (`919307512816`) with cause "38 - Network out of order". Use the NATIONAL number
  (`9307512816`) + `country_code: "91"`. Normalized automatically in
  `adapters/telephony/voicelink/outbound.ts`.
- **DID → bot routing** (inbound + outbound) is set via
  `POST /v1/call-routing/update/{id}` with `for_inbound_call: 3` /
  `for_outbound_call: 3` (3 = Websocket Bot) + the `*_websocket_bot_id`.
  Bots are created via `POST /v1/websocket-bot/create`. There is no DID-list API;
  discover client_id via `GET /v1/reseller/clients` and routing via
  `GET /v1/call-routing/list`.
- Public reachability: VoiceLink's cloud must reach this server, so run a tunnel
  (`cloudflared tunnel --url http://localhost:4000`) and set `WS_BASE_URL` to the
  `wss://` form. Quick tunnels are ephemeral — re-register bots if the URL changes.

## Run locally
```bash
# deps + native datastores (no Docker needed; mongod + redis-server via brew)
pnpm install && pnpm --filter @voiceplatform/shared build
mongod --dbpath ./.mongo-data --port 27017 &   # or brew services
redis-server &                                  # :6379
# api + ui (each loads apps/api/.env via dotenv)
pnpm --filter @voiceplatform/api dev   # :4000
pnpm --filter @voiceplatform/ui dev    # :3000  (PORT=3000)
# seed RapidX tenant + Gemini agent + DIDs + login users
pnpm --filter @voiceplatform/api exec tsx scripts/seed.ts
```
Login (seeded): owner `swati@rapidxai.com` / `RapidX2026`; superadmin
`admin@rapidxai.com` / `RapidXadmin2026`.

## Required env (`apps/api/.env`, gitignored)
`MONGO_URL`, `REDIS_URL`, `JWT_SECRET`, `BYOK_ENCRYPTION_KEY`, `VOICELINK_MODE=live`,
`VOICELINK_API_BASE=https://app.voicelink.co.in/api`, `VOICELINK_RESELLER_TOKEN`,
`GEMINI_API_KEY`, `GEMINI_LIVE_MODEL`, `WS_BASE_URL` (the public wss tunnel).

## Diagnostic scripts (`apps/api/scripts/`)
- `gemini-smoke.ts` / `gemini-raw.ts` — prove Gemini Live connects + speaks.
- `ws-inbound-test.ts` — simulate a VoiceLink WS call locally (start frame →
  agent audio back) without spending a real call.
