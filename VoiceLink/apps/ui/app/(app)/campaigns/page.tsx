import Link from "next/link";

import type { Campaign } from "@voiceplatform/shared";

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

async function fetchCampaigns(): Promise<Campaign[]> {
  try {
    const { campaigns } = await api.get<{ campaigns: Campaign[] }>("/campaigns");
    return campaigns;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

const STATUS_CLASSES: Record<Campaign["status"], string> = {
  draft: "text-zinc-500",
  running: "text-emerald-600",
  paused: "text-amber-600",
  done: "text-zinc-400",
};

export default async function CampaignsPage() {
  const campaigns = await fetchCampaigns();
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <Link href="/campaigns/new" className={buttonVariants()}>
          New campaign
        </Link>
      </div>
      {campaigns.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No campaigns yet. Click <strong>New campaign</strong> to set one up.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Numbers</TableHead>
              <TableHead>Dialed</TableHead>
              <TableHead>From DID</TableHead>
              <TableHead className="text-right">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((c) => (
              <TableRow key={c._id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className={STATUS_CLASSES[c.status]}>{c.status}</TableCell>
                <TableCell>{c.stats.total}</TableCell>
                <TableCell>{c.stats.dialed}</TableCell>
                <TableCell>{c.fromDid ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <Link href={`/campaigns/${c._id}`} className="underline text-sm">
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
