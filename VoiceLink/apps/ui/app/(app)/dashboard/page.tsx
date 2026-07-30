import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { PlaceCall } from "./place-call";

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-normal text-zinc-500">
              Active agents
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">—</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-normal text-zinc-500">
              Calls today
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">—</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-normal text-zinc-500">
              Credits remaining
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">—</CardContent>
        </Card>
      </div>
      <PlaceCall />
      <p className="mt-8 text-sm text-zinc-500">
        Live metrics arrive once Stream S1 ships the calls/campaign data.
      </p>
    </div>
  );
}
