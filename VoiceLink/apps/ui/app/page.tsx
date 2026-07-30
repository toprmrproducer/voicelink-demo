import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/session";
import { getActingTenantId } from "@/lib/act-as-tenant";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // SAs with an "act as tenant" cookie active land on the tenant
  // dashboard. Without the cookie, SAs land on the admin panel.
  if (user.isSuperadmin) {
    const acting = await getActingTenantId();
    redirect(acting ? "/dashboard" : "/admin/tenants");
  }
  redirect("/dashboard");
}
