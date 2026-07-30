import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Forgot password</CardTitle>
        <CardDescription>
          Password reset is not wired up yet. For now, contact your admin to
          re-issue credentials.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/login" className="text-sm underline">
          Back to sign in
        </Link>
      </CardContent>
    </Card>
  );
}
