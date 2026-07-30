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

import { assignDidAction, type AssignDidState } from "./actions";

interface Props {
  tenants: Tenant[];
}

const initial: AssignDidState = {};

export function AssignDidForm({ tenants }: Props) {
  const [state, formAction, pending] = useActionState(assignDidAction, initial);

  if (tenants.length === 0) {
    return (
      <p className="text-sm text-zinc-600">
        No tenants linked yet. Link a Voicelink client first.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="tenantId">Tenant</Label>
        <Select name="tenantId" defaultValue={tenants[0]._id}>
          <SelectTrigger id="tenantId">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tenants.map((t) => (
              <SelectItem key={t._id} value={t._id}>
                {t.name} · client {t.telephony.providerClientId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="providerNumber">DID (E.164)</Label>
        <Input
          id="providerNumber"
          name="providerNumber"
          required
          maxLength={20}
          placeholder="+919999999999"
        />
        {state.fieldErrors?.providerNumber && (
          <p className="text-xs text-red-600">
            {state.fieldErrors.providerNumber[0]}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="didType">Type</Label>
        <Select name="didType" defaultValue="mobile">
          <SelectTrigger id="didType">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mobile">Mobile</SelectItem>
            <SelectItem value="tollfree">Toll free</SelectItem>
            <SelectItem value="landline">Landline</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="defaultAgentId">Default agent id (optional)</Label>
        <Input
          id="defaultAgentId"
          name="defaultAgentId"
          placeholder="Used for inbound calls when no agent is supplied"
        />
        <p className="text-xs text-zinc-500">
          Leave blank to require explicit agent context per call.
        </p>
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Assigning…" : "Assign DID"}
      </Button>
    </form>
  );
}
