import { requireUser } from "@/lib/session";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { LogoutButton } from "./logout-button";

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Read-only for now. Profile editing lands soon.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 text-sm">
            <Row label="User id" value={user._id} mono />
            <Row label="Tenant id" value={user.tenantId ?? "—"} mono />
            <Row label="Role" value={user.role} />
            <Row label="Superadmin" value={user.isSuperadmin ? "yes" : "no"} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardContent>
          <LogoutButton />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-zinc-100 dark:border-zinc-900 pb-2 last:border-0 last:pb-0">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : ""}>{value}</dd>
    </div>
  );
}
