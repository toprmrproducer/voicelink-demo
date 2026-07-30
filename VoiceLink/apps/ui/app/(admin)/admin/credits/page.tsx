import Link from "next/link";

import type { Tenant, CreditsLedgerEntry } from "@voiceplatform/shared";

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

interface LedgerPage {
  balance: number;
  entries: CreditsLedgerEntry[];
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

async function fetchTenantLedger(tenantId: string): Promise<LedgerPage | null> {
  try {
    return await api.get<LedgerPage>(`/admin/credits/${tenantId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export default async function AdminCreditsPage() {
  const tenants = await fetchTenants();
  const ledgers = await Promise.all(
    tenants.map(async (t) => ({
      tenant: t,
      ledger: await fetchTenantLedger(t._id),
    })),
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Credits</h1>
        <Link href="/admin/credits/topup" className={buttonVariants()}>
          Top up
        </Link>
      </div>
      {tenants.length === 0 ? (
        <p className="text-sm text-zinc-500">No tenants linked yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Recent entries</TableHead>
              <TableHead className="text-right">Top up</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledgers.map(({ tenant, ledger }) => (
              <TableRow key={tenant._id}>
                <TableCell className="font-medium">{tenant.name}</TableCell>
                <TableCell>{tenant.plan}</TableCell>
                <TableCell
                  className={`text-right font-mono ${
                    (ledger?.balance ?? 0) < 0 ? "text-red-600" : ""
                  }`}
                >
                  {ledger?.balance.toLocaleString() ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  {ledger?.entries.length ?? 0}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/admin/credits/topup?tenantId=${tenant._id}`}
                    className="underline text-sm"
                  >
                    Top up
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
