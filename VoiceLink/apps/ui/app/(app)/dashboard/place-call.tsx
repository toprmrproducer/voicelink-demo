"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Status = { kind: "idle" | "calling" | "ok" | "err"; msg?: string };

export function PlaceCall() {
  const [number, setNumber] = useState("9307512816");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function call() {
    setStatus({ kind: "calling" });
    try {
      const res = await fetch("/api/calls/dial", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toNumber: number.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({ kind: "err", msg: data.error ?? `Call failed (${res.status})` });
        return;
      }
      setStatus({ kind: "ok", msg: `Calling ${data.from} to ${data.to}. Pick up your phone.` });
    } catch (e) {
      setStatus({ kind: "err", msg: (e as Error).message });
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Place a call</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-zinc-500">
          Enter a number and the RapidX AI agent will call it. For India, enter the
          10-digit number (e.g. 9307512816).
        </p>
        <div className="flex gap-2 max-w-md">
          <Input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="phone number"
            inputMode="tel"
          />
          <Button onClick={call} disabled={status.kind === "calling"}>
            {status.kind === "calling" ? "Calling…" : "Call me"}
          </Button>
        </div>
        {status.msg && (
          <p className={`text-sm ${status.kind === "err" ? "text-red-600" : "text-green-600"}`}>
            {status.msg}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
