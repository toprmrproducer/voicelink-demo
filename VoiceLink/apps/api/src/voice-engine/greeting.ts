import type { RealtimeProvider } from "../adapters/llm/types.js";

/**
 * Trigger the agent's opening line at call start. The provider speaks
 * the greeting; the session-manager wires the resulting audio frames
 * back to the caller.
 */
export function greet(provider: RealtimeProvider, greeting: string): void {
  if (!greeting.trim()) return;
  provider.sendText(greeting);
}
