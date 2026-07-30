import type { Agent } from "@voiceplatform/shared";

import type { RealtimeProvider } from "../adapters/llm/types.js";
import { FakeRealtimeProvider } from "../adapters/llm/fake.js";
import { OpenAiRealtimeProvider } from "../adapters/llm/openai-realtime.js";
import { GeminiLiveProvider } from "../adapters/llm/gemini-live.js";

/**
 * Build a RealtimeProvider for the given agent. The selection is driven
 * by `agent.llm.realtimeModel`. API keys are read from the environment
 * — BYOK per-tenant keys land in a later stream.
 *
 * Honors `REALTIME_MODE=fake` so dev/staging deployments can stand up
 * the WS dataplane without burning OpenAI/Gemini credits, and so the
 * test suite has a single switch to avoid live calls.
 */
export function realtimeForAgent(agent: Agent): RealtimeProvider {
  if (process.env.REALTIME_MODE === "fake") {
    return new FakeRealtimeProvider();
  }

  switch (agent.llm.realtimeModel) {
    case "gpt-4o-mini-realtime":
    case "gpt-4o-realtime": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "OPENAI_API_KEY missing — cannot start a call on an openai-realtime agent. " +
            "Set the env var or flip REALTIME_MODE=fake for non-prod.",
        );
      }
      return new OpenAiRealtimeProvider({
        apiKey,
        model: agent.llm.realtimeModel,
        voice: agent.voice.provider === "openai-realtime"
          ? agent.voice.providerVoiceId
          : undefined,
        systemPrompt: agent.prompt,
        temperature: agent.llm.temperature,
      });
    }
    case "gemini-live-2.0": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY missing — cannot start a gemini-live agent");
      }
      return new GeminiLiveProvider({
        apiKey,
        model: agent.llm.realtimeModel,
        voice: agent.voice.provider === "gemini-live"
          ? agent.voice.providerVoiceId
          : undefined,
        systemPrompt: agent.prompt,
        temperature: agent.llm.temperature,
      });
    }
    default: {
      const _exhaustive: never = agent.llm.realtimeModel;
      throw new Error(`Unknown realtime model: ${_exhaustive}`);
    }
  }
}
