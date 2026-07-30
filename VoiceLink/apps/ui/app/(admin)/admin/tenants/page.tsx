import Link from "next/link";

import type { Tenant } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pickTenant } from "@/lib/act-as-tenant";

async function fetchTenants(): Promise<Tenant[]> {
  try {
    const { tenants } = await api.get<{ tenants: Tenant[] }>("/admin/tenants");
    return tenants;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

export default async function TenantsPage() {
  const tenants = await fetchTenants();
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Tenants</h1>
        <Link href="/admin/tenants/link" className={buttonVariants()}>
          Link Voicelink client
        </Link>
      </div>
      {tenants.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No tenants linked yet. Click <strong>Link Voicelink client</strong> to
          bind a Voicelink client_id to a new tenant.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Voicelink client</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((t) => (
              <TableRow key={t._id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>{t.plan}</TableCell>
                <TableCell>{t.status}</TableCell>
                <TableCell>{t.telephony.providerClientId}</TableCell>
                <TableCell>
                  {new Date(t.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <form
                    action={async () => {
                      "use server";
                      await pickTenant(t._id, "/dashboard");
                    }}
                  >
                    <Button type="submit" size="sm" variant="outline">
                      Open as tenant
                    </Button>
                  </form>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
