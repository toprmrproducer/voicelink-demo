"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { Campaign } from "@voiceplatform/shared";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  campaign: Campaign;
}

const STATUS_CLASSES: Record<Campaign["status"], string> = {
  draft: "text-zinc-500",
  running: "text-emerald-600",
  paused: "text-amber-600",
  done: "text-zinc-400",
};

export function CampaignDetail({ campaign: initial }: Props) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [replaceOnImport, setReplaceOnImport] = useState(false);

  async function action(path: string, label: string) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign._id}/${path}`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `${label} failed (${res.status})`);
        return;
      }
      // start/pause/resume return the campaign; dial-now returns { status, callId }.
      if (body && body._id) {
        setCampaign(body as Campaign);
      } else {
        // refetch
        const refreshed = await fetch(`/api/campaigns/${campaign._id}`);
        if (refreshed.ok) {
          setCampaign((await refreshed.json()) as Campaign);
        }
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy("import");
    setError(null);
    setImportMsg(null);
    try {
      const buf = await file.arrayBuffer();
      // base64-encode in chunks to avoid huge spread call
      let binary = "";
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(
          null,
          Array.from(bytes.subarray(i, i + chunk)),
        );
      }
      const csvBase64 = btoa(binary);
      const res = await fetch(
        `/api/campaigns/${campaign._id}/numbers/import`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ csvBase64, replace: replaceOnImport }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Import failed (${res.status})`);
        return;
      }
      setImportMsg(
        `Imported ${body.imported} number(s). Rejected ${body.rejected ?? 0}. Total: ${body.total}.`,
      );
      // refresh campaign so stats.total updates
      const refreshed = await fetch(`/api/campaigns/${campaign._id}`);
      if (refreshed.ok) {
        setCampaign((await refreshed.json()) as Campaign);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
      e.target.value = ""; // allow re-uploading the same file
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete campaign "${campaign.name}"? This cannot be undone.`))
      return;
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign._id}`, {
        method: "DELETE",
      });
      if (res.status === 204) {
        router.replace("/campaigns");
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Delete failed (${res.status})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  const isRunning = campaign.status === "running";
  const isPaused = campaign.status === "paused";
  const canStart = !isRunning && campaign.numbers.length > 0 && Boolean(campaign.fromDid);

  return (
    <div className="mt-3">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <p className="text-sm text-zinc-500">
            Status:{" "}
            <span className={`font-medium ${STATUS_CLASSES[campaign.status]}`}>
              {campaign.status}
            </span>
            {" · From "}
            <span className="font-mono text-xs">{campaign.fromDid ?? "—"}</span>
            {" · Pacing "}
            {campaign.schedule.pacingCallsPerMinute}/min
          </p>
        </div>
        <div className="flex gap-2">
          {!isRunning && (
            <Button
              onClick={() => action("start", "start")}
              disabled={!canStart || busy !== null}
            >
              {busy === "start" ? "Starting…" : isPaused ? "Resume" : "Start"}
            </Button>
          )}
          {isRunning && (
            <>
              <Button
                variant="secondary"
                onClick={() => action("pause", "pause")}
                disabled={busy !== null}
              >
                {busy === "pause" ? "Pausing…" : "Pause"}
              </Button>
              <Button
                variant="outline"
                onClick={() => action("dial-now", "dial-now")}
                disabled={busy !== null}
              >
                {busy === "dial-now" ? "Dialing…" : "Dial one"}
              </Button>
            </>
          )}
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={busy !== null}
          >
            Delete
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Stat label="Total" value={campaign.stats.total} />
        <Stat label="Dialed" value={campaign.stats.dialed} />
        <Stat label="Connected" value={campaign.stats.connected} />
        <Stat
          label="Failed"
          value={campaign.stats.failed}
          tone={campaign.stats.failed > 0 ? "warn" : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Numbers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-600">
            Upload a CSV. The first column must be the phone number (E.164
            preferred). Extra columns are passed through as <code>customData</code>.
          </p>
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input
              type="checkbox"
              checked={replaceOnImport}
              onChange={(e) => setReplaceOnImport(e.target.checked)}
            />
            Replace existing numbers (default appends)
          </label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleImport}
            disabled={busy !== null || isRunning}
            className="block text-sm"
          />
          {isRunning && (
            <p className="text-xs text-amber-600">
              Pause the campaign before importing more numbers.
            </p>
          )}
          {importMsg && (
            <p className="text-xs text-emerald-600">{importMsg}</p>
          )}
          <p className="text-sm text-zinc-700">
            Cursor at row <strong>{campaign.cursor}</strong> /{" "}
            {campaign.numbers.length}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-normal text-zinc-500">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent
        className={`text-2xl font-semibold ${tone === "warn" ? "text-amber-600" : ""}`}
      >
        {value}
      </CardContent>
    </Card>
  );
}
