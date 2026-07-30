import type { Tenant } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { TopupForm } from "./topup-form";

async function fetchTenants(): Promise<Tenant[]> {
  try {
    const { tenants } = await api.get<{ tenants: Tenant[] }>("/admin/tenants");
    return tenants;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

export default async function TopupPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const tenants = await fetchTenants();
  const params = await searchParams;
  return (
    <div className="max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>Top up tenant credits</CardTitle>
          <CardDescription>
            Add credits to a tenant. Use a note for audit visibility (welcome
            bonus, refund-for-call-X, etc.).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TopupForm tenants={tenants} initialTenantId={params.tenantId} />
        </CardContent>
      </Card>
    </div>
  );
}
