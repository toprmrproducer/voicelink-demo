"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { Agent, Did, Campaign } from "@voiceplatform/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  agents: Agent[];
  dids: Did[];
}

export function NewCampaignForm({ agents, dids }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState<string>(agents[0]?._id ?? "");
  const [fromDid, setFromDid] = useState<string>("");
  const [pacing, setPacing] = useState<number>(10);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          agentId,
          fromDid: fromDid || undefined,
          schedule: {
            startAt: new Date(),
            timezone: "Asia/Kolkata",
            pacingCallsPerMinute: pacing,
            retries: 0,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Create failed (${res.status})`);
        return;
      }
      const created = body as Campaign;
      router.replace(`/campaigns/${created._id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (agents.length === 0) {
    return (
      <p className="text-sm text-zinc-600">
        Create an agent first — campaigns dial through an agent.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="name">Campaign name</Label>
        <Input
          id="name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme outbound — May batch"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="agent">Agent</Label>
        <Select value={agentId} onValueChange={(v) => setAgentId(v ?? "")}>
          <SelectTrigger id="agent">
            <SelectValue placeholder="Pick an agent" />
          </SelectTrigger>
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a._id} value={a._id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="did">From DID (optional, required to start)</Label>
        {dids.length > 0 ? (
          <Select value={fromDid} onValueChange={(v) => setFromDid(v ?? "")}>
            <SelectTrigger id="did">
              <SelectValue placeholder="Pick a DID" />
            </SelectTrigger>
            <SelectContent>
              {dids.map((d) => (
                <SelectItem key={d._id} value={d.providerNumber}>
                  {d.providerNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id="did"
            value={fromDid}
            onChange={(e) => setFromDid(e.target.value)}
            placeholder="+919999999999"
          />
        )}
        <p className="text-xs text-zinc-500">
          The DID must already be assigned to your tenant in Voicelink.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="pacing">Pacing (calls per minute)</Label>
        <Input
          id="pacing"
          type="number"
          min={1}
          max={600}
          value={pacing}
          onChange={(e) => setPacing(Number(e.target.value) || 1)}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button type="submit" disabled={submitting || !name || !agentId}>
        {submitting ? "Creating…" : "Create campaign"}
      </Button>
    </form>
  );
}
