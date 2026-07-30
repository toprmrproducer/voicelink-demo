import Link from "next/link";

import type { Did, Tenant } from "@voiceplatform/shared";

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

async function fetchDids(): Promise<Did[]> {
  try {
    const { dids } = await api.get<{ dids: Did[] }>("/admin/dids");
    return dids;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

async function fetchTenants(): Promise<Tenant[]> {
  try {
    const { tenants } = await api.get<{ tenants: Tenant[] }>("/admin/tenants");
    return tenants;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

export default async function AdminDidsPage() {
  const [dids, tenants] = await Promise.all([fetchDids(), fetchTenants()]);
  const tenantById = new Map(tenants.map((t) => [t._id, t.name]));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">DIDs</h1>
        <Link href="/admin/dids/assign" className={buttonVariants()}>
          Assign DID
        </Link>
      </div>
      {dids.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No DIDs assigned yet. Click <strong>Assign DID</strong> to link a
          Voicelink number to a tenant.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Tenant</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Bot</TableHead>
              <TableHead>Assigned</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dids.map((d) => (
              <TableRow key={d._id}>
                <TableCell className="font-mono text-xs">
                  {d.providerNumber}
                </TableCell>
                <TableCell>
                  {tenantById.get(d.tenantId) ?? d.tenantId}
                </TableCell>
                <TableCell>{d.provider}</TableCell>
                <TableCell>{d.didType}</TableCell>
                <TableCell>{d.status}</TableCell>
                <TableCell>
                  {d.providerBotId ? (
                    <span className="font-mono text-xs">{d.providerBotId}</span>
                  ) : (
                    <span className="text-amber-600 text-xs">unregistered</span>
                  )}
                </TableCell>
                <TableCell>
                  {new Date(d.assignedAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
