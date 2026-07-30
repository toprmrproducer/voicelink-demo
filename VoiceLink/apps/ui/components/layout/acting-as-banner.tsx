import { Button } from "@/components/ui/button";
import { clearTenant } from "@/lib/act-as-tenant";

interface Props {
  tenantName: string;
}

/**
 * Shown on tenant-scoped pages when a superadmin is impersonating a
 * tenant. The "Back to admin" button clears the act-as cookie and
 * returns the SA to /admin/tenants.
 */
export function ActingAsBanner({ tenantName }: Props) {
  return (
    <div className="mb-6 flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <div>
        <span className="font-medium">Acting as tenant:</span>{" "}
        <span>{tenantName}</span>
      </div>
      <form
        action={async () => {
          "use server";
          await clearTenant("/admin/tenants");
        }}
      >
        <Button type="submit" size="sm" variant="outline">
          Back to admin
        </Button>
      </form>
    </div>
  );
}
