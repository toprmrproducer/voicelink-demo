"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { Agent, RealtimeModel, VoiceProvider } from "@voiceplatform/shared";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  agent: Agent;
}

interface LibraryVoice {
  provider: VoiceProvider;
  providerVoiceId: string;
  name: string;
  language?: string;
  gender?: string;
}

const VOICE_PROVIDERS: VoiceProvider[] = [
  "openai-realtime",
  "gemini-live",
  "elevenlabs",
  "cartesia",
  "playht",
  "cloned",
];

const REALTIME_MODELS: RealtimeModel[] = [
  "gpt-4o-mini-realtime",
  "gpt-4o-realtime",
  "gemini-live-2.0",
];

export function AgentEditor({ agent }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<Agent>(agent);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<LibraryVoice[]>([]);

  const isNew = agent._id === "new";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/voices", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { voices: [] }))
      .then((j: { voices: LibraryVoice[] }) => {
        if (!cancelled) setVoices(j.voices ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function buildPayload() {
    // Strip server-managed fields. _id/tenantId/createdAt/updatedAt are
    // either set by the server on create or untouchable on update.
    const { _id, tenantId, createdAt, updatedAt, ...rest } = draft;
    void _id;
    void tenantId;
    void createdAt;
    void updatedAt;
    return rest;
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const url = isNew ? "/api/agents" : `/api/agents/${draft._id}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Save failed (${res.status})`);
        return;
      }
      const saved = body as Agent;
      setDraft(saved);
      setSavedAt(new Date());
      if (isNew) {
        router.replace(`/agents/${saved._id}`);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (isNew) return;
    if (!confirm(`Delete agent "${draft.name || draft._id}"? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${draft._id}`, { method: "DELETE" });
      if (res.status === 204) {
        router.replace("/agents");
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.campaigns) {
        setError(
          `Cannot delete — ${body.campaigns} active campaign(s) reference this agent. Pause or reassign them first.`,
        );
      } else {
        setError(body.error ?? `Delete failed (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  const voicesForProvider = voices.filter(
    (v) => v.provider === draft.voice.provider,
  );
  const usesLibrary = voicesForProvider.length > 0 && draft.voice.provider !== "cloned";

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">
            {isNew ? "New agent" : draft.name || "(unnamed agent)"}
          </h1>
          <p className="text-sm text-zinc-500">
            Status: <span className="font-medium">{draft.status}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && !error && (
            <span className="text-xs text-zinc-500">
              Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          {!isNew && (
            <Button
              variant="destructive"
              onClick={remove}
              disabled={deleting || saving}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          )}
          <Button onClick={save} disabled={saving || deleting}>
            {saving ? "Saving…" : isNew ? "Create" : "Save"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-6 space-y-1">
        <Label htmlFor="name">Agent name</Label>
        <Input
          id="name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. Inbound qualifier"
        />
      </div>

      <Tabs defaultValue="prompt" className="space-y-4">
        <TabsList>
          <TabsTrigger value="prompt">Prompt</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
          <TabsTrigger value="model">Model</TabsTrigger>
        </TabsList>

        <TabsContent value="prompt">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-1">
                <Label htmlFor="greeting">Greeting</Label>
                <Textarea
                  id="greeting"
                  rows={3}
                  value={draft.greeting}
                  onChange={(e) => setDraft({ ...draft, greeting: e.target.value })}
                  placeholder="What the agent says when the call connects."
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="prompt">System prompt</Label>
                <Textarea
                  id="prompt"
                  rows={16}
                  value={draft.prompt}
                  onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                  placeholder="Define the agent's role, tone, and rules."
                  className="font-mono text-sm"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="voice">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-1">
                <Label htmlFor="voice-provider">Provider</Label>
                <Select
                  value={draft.voice.provider}
                  onValueChange={(value) => {
                    const provider = value as VoiceProvider;
                    // When switching providers, preselect the first voice
                    // from that provider's library so the picker isn't stale.
                    const first = voices.find((v) => v.provider === provider);
                    setDraft({
                      ...draft,
                      voice: {
                        ...draft.voice,
                        provider,
                        providerVoiceId: first?.providerVoiceId ?? "",
                      },
                    });
                  }}
                >
                  <SelectTrigger id="voice-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VOICE_PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {usesLibrary ? (
                <div className="space-y-1">
                  <Label htmlFor="voice-id">Voice</Label>
                  <Select
                    value={draft.voice.providerVoiceId}
                    onValueChange={(value) =>
                      setDraft({
                        ...draft,
                        voice: { ...draft.voice, providerVoiceId: value ?? "" },
                      })
                    }
                  >
                    <SelectTrigger id="voice-id">
                      <SelectValue placeholder="Pick a voice" />
                    </SelectTrigger>
                    <SelectContent>
                      {voicesForProvider.map((v) => (
                        <SelectItem key={v.providerVoiceId} value={v.providerVoiceId}>
                          {v.name}
                          {v.gender ? ` · ${v.gender}` : ""}
                          {v.language ? ` · ${v.language}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="voice-id">Voice id</Label>
                  <Input
                    id="voice-id"
                    value={draft.voice.providerVoiceId}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        voice: { ...draft.voice, providerVoiceId: e.target.value },
                      })
                    }
                    placeholder={
                      draft.voice.provider === "cloned"
                        ? "Your cloned voice id"
                        : "Voice id"
                    }
                  />
                  {draft.voice.provider === "cloned" && (
                    <p className="text-xs text-zinc-500">
                      Find cloned voice ids under <strong>Voice clones</strong>.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="model">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-1">
                <Label htmlFor="model">Realtime model</Label>
                <Select
                  value={draft.llm.realtimeModel}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      llm: { ...draft.llm, realtimeModel: value as RealtimeModel },
                    })
                  }
                >
                  <SelectTrigger id="model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REALTIME_MODELS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="temperature">
                  Temperature ({draft.llm.temperature.toFixed(2)})
                </Label>
                <Input
                  id="temperature"
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={draft.llm.temperature}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      llm: {
                        ...draft.llm,
                        temperature: Number(e.target.value),
                      },
                    })
                  }
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
