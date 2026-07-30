import Link from "next/link";

import type { Agent } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

async function fetchAgents(): Promise<Agent[]> {
  try {
    const { agents } = await api.get<{ agents: Agent[] }>("/agents");
    return agents;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

export default async function AgentsPage() {
  const agents = await fetchAgents();
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <Link href="/agents/new" className={buttonVariants()}>
          New agent
        </Link>
      </div>
      {agents.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No agents yet. Click <strong>New agent</strong> to create one.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Voice</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((agent) => (
              <TableRow key={agent._id}>
                <TableCell className="font-medium">{agent.name}</TableCell>
                <TableCell>{agent.status}</TableCell>
                <TableCell>
                  {agent.voice.provider} / {agent.voice.providerVoiceId}
                </TableCell>
                <TableCell>{agent.llm.realtimeModel}</TableCell>
                <TableCell className="text-right">
                  <Link href={`/agents/${agent._id}`} className="underline text-sm">
                    Open
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
