import type { Call } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

async function fetchCalls(): Promise<Call[]> {
  try {
    const { calls } = await api.get<{ calls: Call[] }>("/calls?limit=100");
    return calls;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

const STATUS_CLASSES: Record<Call["status"], string> = {
  queued: "text-zinc-500",
  ringing: "text-blue-600",
  inprogress: "text-emerald-600",
  completed: "text-zinc-700",
  failed: "text-red-600",
};

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default async function CallsPage() {
  const calls = await fetchCalls();
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Calls</h1>
      </div>
      {calls.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No calls yet. Start a campaign or wait for inbound traffic.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.map((c) => (
              <TableRow key={c._id}>
                <TableCell className="text-sm text-zinc-600 whitespace-nowrap">
                  {new Date(c.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>{c.direction === "out" ? "Outbound" : "Inbound"}</TableCell>
                <TableCell className="font-mono text-xs">{c.fromNumber}</TableCell>
                <TableCell className="font-mono text-xs">{c.toNumber}</TableCell>
                <TableCell className={STATUS_CLASSES[c.status]}>{c.status}</TableCell>
                <TableCell className="text-right">
                  {formatDuration(c.durationSec)}
                </TableCell>
                <TableCell className="text-right">{c.costCredits || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
