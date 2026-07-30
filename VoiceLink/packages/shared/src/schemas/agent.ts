import { z } from "zod";

export const AgentStatus = z.enum(["draft", "published"]);

export const VoiceProvider = z.enum([
  "openai-realtime",
  "gemini-live",
  "elevenlabs",
  "cartesia",
  "playht",
  "cloned",
]);

export const RealtimeModel = z.enum([
  "gpt-4o-mini-realtime",
  "gpt-4o-realtime",
  "gemini-live-2.0",
]);

export const AgentVoice = z.object({
  provider: VoiceProvider,
  providerVoiceId: z.string(),
  cloneId: z.string().optional(),
});

export const AgentLLM = z.object({
  realtimeModel: RealtimeModel,
  temperature: z.number().min(0).max(2).default(0.7),
});

export const AgentTool = z.object({
  name: z.string(),
  schema: z.record(z.unknown()),
  handlerUrl: z.string().url().optional(),
});

export const Agent = z.object({
  _id: z.string(),
  tenantId: z.string(),
  name: z.string().min(1).max(120),
  prompt: z.string().default(""),
  flowId: z.string().optional(),
  voice: AgentVoice,
  llm: AgentLLM,
  tools: z.array(AgentTool).default([]),
  knowledgeBase: z.string().optional(),
  greeting: z.string().default(""),
  endCallTriggers: z.array(z.string()).default([]),
  status: AgentStatus.default("draft"),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateAgentInput = Agent.omit({
  _id: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  prompt: true,
  flowId: true,
  tools: true,
  knowledgeBase: true,
  greeting: true,
  endCallTriggers: true,
  status: true,
});

export const UpdateAgentInput = CreateAgentInput.partial();

export type AgentStatus = z.infer<typeof AgentStatus>;
export type VoiceProvider = z.infer<typeof VoiceProvider>;
export type RealtimeModel = z.infer<typeof RealtimeModel>;
export type AgentVoice = z.infer<typeof AgentVoice>;
export type AgentLLM = z.infer<typeof AgentLLM>;
export type AgentTool = z.infer<typeof AgentTool>;
export type Agent = z.infer<typeof Agent>;
export type CreateAgentInput = z.infer<typeof CreateAgentInput>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentInput>;
