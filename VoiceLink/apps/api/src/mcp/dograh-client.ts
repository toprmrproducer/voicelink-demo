import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createLogger } from "../lib/logger.js";

const log = createLogger("dograh-client");

export type DograhMode = "hosted" | "self-hosted";

export interface DograhClientConfig {
  url: string;
  apiKey?: string;
  mode?: DograhMode;
}

/**
 * Typed wrapper around the Dograh MCP server (hosted or self-hosted).
 * Each instance owns one MCP connection — call `close()` when done.
 *
 * For v1 we share one client per process; per-tenant scoping happens at
 * the REST layer (routes/flows.routes.ts) which checks the tenant before
 * forwarding the call. Once tenants bring their own Dograh keys (BYOK),
 * this will switch to a per-tenant client pool.
 */
export class DograhClient {
  private client: Client;
  private transport: StreamableHTTPClientTransport;
  private connected = false;

  constructor(private cfg: DograhClientConfig) {
    const headers: Record<string, string> = {};
    if (cfg.apiKey) headers["X-API-Key"] = cfg.apiKey;

    this.transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: { headers },
    });
    this.client = new Client(
      { name: "voice-platform-api", version: "0.0.1" },
      { capabilities: {} },
    );
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect(this.transport);
    this.connected = true;
    log.info({ mode: this.cfg.mode ?? "hosted" }, "dograh mcp connected");
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
  }

  private async call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.connect();
    const res = await this.client.callTool({ name, arguments: args });
    return res as T;
  }

  // --- Tool wrappers (a subset; expand as routes demand them) ---

  listWorkflows = () => this.call("list_workflows");
  getWorkflowCode = (id: string) => this.call("get_workflow_code", { id });
  createWorkflow = (input: { name: string; code: string }) =>
    this.call("create_workflow", input);
  saveWorkflow = (input: { id: string; code: string }) =>
    this.call("save_workflow", input);
  listNodeTypes = () => this.call("list_node_types");
}

let singleton: DograhClient | null = null;

/**
 * Returns the process-wide Dograh client, initialized from env on first
 * call. Returns null if Dograh is not configured (DOGRAH_MCP_URL unset)
 * — callers should treat the routes as 503 in that case.
 */
export function getDograhClient(): DograhClient | null {
  if (singleton) return singleton;
  const url = process.env.DOGRAH_MCP_URL;
  if (!url) return null;
  singleton = new DograhClient({
    url,
    apiKey: process.env.DOGRAH_MCP_KEY,
    mode: (process.env.DOGRAH_MODE as DograhMode) ?? "hosted",
  });
  return singleton;
}

// Test seam — let integration tests inject a freshly-configured client
// without polluting the module singleton across tests.
export function _setDograhClientForTesting(client: DograhClient | null): void {
  singleton = client;
}
