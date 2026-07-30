"use client";

import { useActionState } from "react";

import type { Tenant } from "@voiceplatform/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { topupAction, type TopupState } from "./actions";

interface Props {
  tenants: Tenant[];
  initialTenantId?: string;
}

const initial: TopupState = {};

export function TopupForm({ tenants, initialTenantId }: Props) {
  const [state, formAction, pending] = useActionState(topupAction, initial);

  if (tenants.length === 0) {
    return (
      <p className="text-sm text-zinc-600">
        No tenants linked yet — link one before topping up.
      </p>
    );
  }

  const defaultTenant =
    initialTenantId && tenants.find((t) => t._id === initialTenantId)
      ? initialTenantId
      : tenants[0]._id;

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="tenantId">Tenant</Label>
        <Select name="tenantId" defaultValue={defaultTenant}>
          <SelectTrigger id="tenantId">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tenants.map((t) => (
              <SelectItem key={t._id} value={t._id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="amount">Amount (credits)</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          min={1}
          required
          placeholder="500"
        />
        {state.fieldErrors?.amount && (
          <p className="text-xs text-red-600">{state.fieldErrors.amount[0]}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="type">Type</Label>
        <Select name="type" defaultValue="topup">
          <SelectTrigger id="type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="topup">Topup</SelectItem>
            <SelectItem value="refund">Refund</SelectItem>
            <SelectItem value="adjustment">Adjustment</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="note">Note (optional)</Label>
        <Input id="note" name="note" maxLength={280} placeholder="Welcome bonus" />
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && (
        <p className="text-sm text-emerald-600">
          Done. New balance: {state.success.balance.toLocaleString()}.
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Crediting…" : "Top up"}
      </Button>
    </form>
  );
}
