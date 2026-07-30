"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { linkTenantAction, type LinkTenantState } from "./actions";

const initial: LinkTenantState = {};

export function LinkTenantForm() {
  const [state, formAction, pending] = useActionState(linkTenantAction, initial);
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="name">Tenant name</Label>
        <Input id="name" name="name" required maxLength={120} placeholder="Acme Telesales" />
        {state.fieldErrors?.name && (
          <p className="text-xs text-red-600">{state.fieldErrors.name[0]}</p>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor="voicelinkClientId">Voicelink client_id</Label>
        <Input
          id="voicelinkClientId"
          name="voicelinkClientId"
          type="number"
          min={1}
          required
          placeholder="1234"
        />
        {state.fieldErrors?.voicelinkClientId && (
          <p className="text-xs text-red-600">
            {state.fieldErrors.voicelinkClientId[0]}
          </p>
        )}
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Linking…" : "Link tenant"}
      </Button>
    </form>
  );
}
