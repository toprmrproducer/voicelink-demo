import type { CreditsLedgerEntry } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface LedgerPage {
  balance: number;
  entries: CreditsLedgerEntry[];
}

async function fetchLedger(): Promise<LedgerPage> {
  try {
    return await api.get<LedgerPage>("/credits?limit=100");
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { balance: 0, entries: [] };
    }
    throw err;
  }
}

const TYPE_CLASSES: Record<CreditsLedgerEntry["type"], string> = {
  topup: "text-emerald-600",
  refund: "text-emerald-600",
  call: "text-zinc-600",
  adjustment: "text-amber-600",
};

export default async function CreditsPage() {
  const { balance, entries } = await fetchLedger();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Credits</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-normal text-zinc-500">
            Current balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p
            className={`text-4xl font-semibold ${balance < 0 ? "text-red-600" : ""}`}
          >
            {balance.toLocaleString()}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            1 credit ≈ 1 second of talk time. Top up via your account
            manager — self-serve billing arrives later.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No ledger entries yet. Activity appears as soon as a top-up
              lands or your first call completes.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance after</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e._id}>
                    <TableCell className="text-sm text-zinc-600 whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className={TYPE_CLASSES[e.type]}>
                      {e.type}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono ${e.amount < 0 ? "text-red-600" : "text-emerald-600"}`}
                    >
                      {e.amount > 0 ? "+" : ""}
                      {e.amount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {e.balanceAfter.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm text-zinc-600">
                      {e.note ?? (e.callId ? `call ${e.callId.slice(0, 8)}…` : "—")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
