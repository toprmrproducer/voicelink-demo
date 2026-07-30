import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { DograhClient } from "../../src/mcp/dograh-client.js";

// These tests hit the real hosted Dograh MCP. They auto-skip when no
// DOGRAH_MCP_KEY is set so CI without secrets stays green; they run
// locally / in production-test environments when the key is provided.

const URL = process.env.DOGRAH_MCP_URL ?? "https://app.dograh.com/api/v1/mcp/";
const KEY = process.env.DOGRAH_MCP_KEY;
const itLive = KEY ? it : it.skip;

let client: DograhClient;

beforeAll(async () => {
  if (!KEY) return;
  client = new DograhClient({ url: URL, apiKey: KEY, mode: "hosted" });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.close();
});

describe("Dograh MCP hosted client (live)", () => {
  itLive("connects and lists workflows", async () => {
    const result = await client.listWorkflows();
    expect(result).toBeDefined();
  });

  itLive("lists node types", async () => {
    const result = await client.listNodeTypes();
    expect(result).toBeDefined();
  });
});
