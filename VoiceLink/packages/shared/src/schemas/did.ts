import { z } from "zod";
import { TelephonyProvider } from "./tenant.js";

/**
 * Did — one row per (telephony-provider phone number, tenant) link.
 *
 * Hardik provisions a number in the Voicelink admin (Add New Client →
 * DID Mapping) and then links it to one of our tenants via
 * `POST /admin/dids/assign`. The webhook receiver looks up the Did row
 * by `providerNumber` (E.164) to resolve the right `tenantId` (+
 * `defaultAgentId` for inbound calls).
 */

export const DidType = z.enum(["tollfree", "mobile", "landline", "unknown"]);
export type DidType = z.infer<typeof DidType>;

export const DidStatus = z.enum(["active", "paused", "expired"]);
export type DidStatus = z.infer<typeof DidStatus>;

export const Did = z.object({
  _id: z.string(),
  tenantId: z.string(),
  provider: TelephonyProvider,
  /** E.164 number, e.g. "+919999999999" — must be unique across all tenants. */
  providerNumber: z.string().min(4).max(20),
  didType: DidType.default("unknown"),
  /** Optional agent to route inbound calls to when no override is supplied. */
  defaultAgentId: z.string().optional(),
  /**
   * Provider-side WS bot id (Voicelink `bot_id`), set by
   * `registerWebSocketBot()` at DID-assign time. The bot's URL is
   * `${WS_BASE_URL}/ws/voicelink/${did._id}` and is what Voicelink
   * connects to when a call lands on this number.
   */
  providerBotId: z.string().optional(),
  status: DidStatus.default("active"),
  assignedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Did = z.infer<typeof Did>;

export const AssignDidInput = z.object({
  tenantId: z.string().min(1),
  provider: TelephonyProvider.default("voicelink"),
  providerNumber: z.string().min(4).max(20),
  didType: DidType.optional(),
  defaultAgentId: z.string().optional(),
});
export type AssignDidInput = z.infer<typeof AssignDidInput>;

export const UpdateDidInput = z
  .object({
    defaultAgentId: z.string().nullable().optional(),
    didType: DidType.optional(),
    status: DidStatus.optional(),
  })
  .strict();
export type UpdateDidInput = z.infer<typeof UpdateDidInput>;
