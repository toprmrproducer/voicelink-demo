/**
 * Voicelink WebSocket bot lifecycle — wraps /v1/websocket-bot/*.
 *
 * NOT YET tested against real Voicelink staging (Q3). Request shape matches
 * the OpenAPI CreateWebsocketBotRequest schema verbatim.
 */

import type { WSBotHandle, WSBotInput } from "../types.js";
import type { VoicelinkClient } from "./client.js";

interface CreateBotRequest {
  bot_name: string;
  websocket_url: string;
  webhook_url?: string;
  status: 0 | 1;
  client_id: number;
}

interface CreateBotResponse {
  id?: number;
  bot_id?: number;
  data?: { id?: number; bot_id?: number };
}

export async function registerWebSocketBot(
  client: VoicelinkClient,
  input: WSBotInput,
): Promise<WSBotHandle> {
  const clientIdNum = Number(input.providerClientId);
  if (!Number.isFinite(clientIdNum)) {
    throw new Error(
      `providerClientId must be numeric for Voicelink, got "${input.providerClientId}"`,
    );
  }
  const body: CreateBotRequest = {
    bot_name: input.name,
    websocket_url: input.websocketUrl,
    status: input.active === false ? 0 : 1,
    client_id: clientIdNum,
  };
  if (input.webhookUrl !== undefined) body.webhook_url = input.webhookUrl;

  const res = await client.request<CreateBotResponse>(
    "POST",
    "/v1/websocket-bot/create",
    body,
  );
  const id = res.id ?? res.bot_id ?? res.data?.id ?? res.data?.bot_id;
  if (id === undefined) {
    throw new Error(
      `websocket-bot/create succeeded but no id in response: ${JSON.stringify(res)}`,
    );
  }
  return {
    providerBotId: String(id),
    websocketUrl: input.websocketUrl,
    active: input.active ?? true,
  };
}
