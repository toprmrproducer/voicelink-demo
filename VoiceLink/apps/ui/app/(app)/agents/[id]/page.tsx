import { notFound } from "next/navigation";

import type { Agent } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";

import { AgentEditor } from "./agent-editor";

async function fetchAgent(id: string): Promise<Agent | null> {
  try {
    return await api.get<Agent>(`/agents/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

const emptyAgent: Agent = {
  _id: "new",
  tenantId: "",
  name: "",
  prompt: "",
  voice: { provider: "openai-realtime", providerVoiceId: "alloy" },
  llm: { realtimeModel: "gpt-4o-mini-realtime", temperature: 0.7 },
  tools: [],
  greeting: "",
  endCallTriggers: [],
  status: "draft",
  createdAt: new Date(),
  updatedAt: new Date(),
};

export default async function AgentEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (id === "new") return <AgentEditor agent={emptyAgent} />;
  const agent = await fetchAgent(id);
  if (!agent) notFound();
  return <AgentEditor agent={agent} />;
}
