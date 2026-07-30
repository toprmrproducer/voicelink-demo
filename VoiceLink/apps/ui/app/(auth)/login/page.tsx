import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-bold tracking-tight">
          RapidX<span className="text-blue-600"> AI</span>
        </CardTitle>
        <p className="text-sm text-zinc-500">Sign in to your voice agent dashboard</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <LoginForm />
        <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
          <Link
            href="/admin"
            className={buttonVariants({ variant: "outline", className: "w-full mt-4" })}
          >
            Admin Panel
          </Link>
          <p className="text-xs text-zinc-500 mt-2 text-center">
            Sign in with your superadmin credentials
          </p>
        </div>
        <p className="text-sm text-zinc-500">
          New here?{" "}
          <Link href="/signup" className="underline">
            Create an account
          </Link>
        </p>
        <p className="text-sm text-zinc-500">
          <Link href="/forgot-password" className="underline">
            Forgot password?
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
