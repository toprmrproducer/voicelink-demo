"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { VoiceProvider } from "@voiceplatform/shared";

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

const CLONE_PROVIDERS: VoiceProvider[] = ["elevenlabs", "cartesia", "playht"];

export function CloneVoiceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<VoiceProvider>("elevenlabs");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Pick an audio file first");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const buf = await file.arrayBuffer();
      // Chunked base64 to avoid spread-call argument-size errors on
      // larger files (Safari is the strictest at ~64KB).
      let binary = "";
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(
          null,
          Array.from(bytes.subarray(i, i + chunk)),
        );
      }
      const audioBase64 = btoa(binary);

      const res = await fetch("/api/voice-clones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          provider,
          audioBase64,
          fileName: file.name,
          language: "en",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Upload failed (${res.status})`);
        return;
      }
      setSuccess(`Cloned "${name}" — voice id ${body.providerVoiceId}.`);
      setName("");
      setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="voice-name">Voice name</Label>
        <Input
          id="voice-name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rohan — friendly outbound"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="provider">Provider</Label>
        <Select
          value={provider}
          onValueChange={(v) => setProvider((v ?? "elevenlabs") as VoiceProvider)}
        >
          <SelectTrigger id="provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLONE_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="audio">Audio sample (.wav or .mp3)</Label>
        <input
          id="audio"
          type="file"
          accept="audio/wav,audio/mpeg,.wav,.mp3"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block text-sm"
        />
        {file && (
          <p className="text-xs text-zinc-500">
            {file.name} · {(file.size / 1024).toFixed(0)} KB
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-emerald-600">{success}</p>}

      <Button type="submit" disabled={submitting || !file || !name}>
        {submitting ? "Uploading…" : "Clone voice"}
      </Button>
    </form>
  );
}
