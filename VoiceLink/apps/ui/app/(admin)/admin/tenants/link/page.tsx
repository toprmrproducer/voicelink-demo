import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { LinkTenantForm } from "./link-form";

export default function LinkTenantPage() {
  return (
    <div className="max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>Link a Voicelink client</CardTitle>
          <CardDescription>
            Each tenant corresponds to one Voicelink client_id. Onboard the
            client in the Voicelink reseller portal first, then link them here
            so they show up in this dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LinkTenantForm />
        </CardContent>
      </Card>
    </div>
  );
}
