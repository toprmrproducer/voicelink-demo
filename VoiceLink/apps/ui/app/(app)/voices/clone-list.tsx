"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { VoiceClone } from "@voiceplatform/shared";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Props {
  clones: VoiceClone[];
}

export function CloneList({ clones }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(c: VoiceClone) {
    if (!confirm(`Delete cloned voice "${c.name}"? This cannot be undone.`))
      return;
    setBusyId(c._id);
    setError(null);
    try {
      const res = await fetch(`/api/voice-clones/${c._id}`, {
        method: "DELETE",
      });
      if (res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Delete failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  if (clones.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No cloned voices yet. Upload a sample above.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Voice id</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Delete</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clones.map((c) => (
            <TableRow key={c._id}>
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell>{c.provider}</TableCell>
              <TableCell className="font-mono text-xs">
                {c.providerVoiceId}
              </TableCell>
              <TableCell>
                {new Date(c.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => remove(c)}
                  disabled={busyId !== null}
                >
                  {busyId === c._id ? "Deleting…" : "Delete"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
