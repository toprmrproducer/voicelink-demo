import type { Tenant } from "@voiceplatform/shared";

import { api, ApiError } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { AssignDidForm } from "./assign-form";

async function fetchTenants(): Promise<Tenant[]> {
  try {
    const { tenants } = await api.get<{ tenants: Tenant[] }>("/admin/tenants");
    return tenants;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

export default async function AssignDidPage() {
  const tenants = await fetchTenants();
  return (
    <div className="max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>Assign a DID</CardTitle>
          <CardDescription>
            Link a Voicelink number (E.164) to one of our tenants. Re-running
            with the same tenant is idempotent. A different tenant returns 409.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AssignDidForm tenants={tenants} />
        </CardContent>
      </Card>
    </div>
  );
}
