import type { Agent, Did } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { NewCampaignForm } from "./new-campaign-form";

async function fetchAgents(): Promise<Agent[]> {
  try {
    const { agents } = await api.get<{ agents: Agent[] }>("/agents");
    return agents;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

async function fetchDids(): Promise<Did[]> {
  try {
    const { dids } = await api.get<{ dids: Did[] }>("/dids");
    return dids ?? [];
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403))
      return [];
    return [];
  }
}

export default async function NewCampaignPage() {
  const [agents, dids] = await Promise.all([fetchAgents(), fetchDids()]);
  return (
    <div className="max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>New campaign</CardTitle>
          <CardDescription>
            Pick an agent and the DID to dial from. You will upload numbers
            and start the campaign on the next screen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewCampaignForm agents={agents} dids={dids} />
        </CardContent>
      </Card>
    </div>
  );
}
