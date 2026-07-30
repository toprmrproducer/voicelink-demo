import type { ReactNode } from "react";

import { requireUser } from "@/lib/session";
import { Sidebar } from "@/components/layout/sidebar";
import { ActingAsBanner } from "@/components/layout/acting-as-banner";
import { getActingTenantId } from "@/lib/act-as-tenant";
import { api, ApiError } from "@/lib/api";
import type { Tenant } from "@voiceplatform/shared";

async function fetchActingTenant(): Promise<Tenant | null> {
  const id = await getActingTenantId();
  if (!id) return null;
  try {
    const { tenants } = await api.get<{ tenants: Tenant[] }>("/admin/tenants");
    return tenants.find((t) => t._id === id) ?? null;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const actingTenant = user.isSuperadmin ? await fetchActingTenant() : null;
  return (
    <div className="min-h-screen flex">
      <Sidebar isSuperadmin={user.isSuperadmin} />
      <main className="flex-1 px-8 py-6">
        {actingTenant && <ActingAsBanner tenantName={actingTenant.name} />}
        {children}
      </main>
    </div>
  );
}
