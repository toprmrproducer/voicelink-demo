import { z } from "zod";

/**
 * Voicelink call-event webhook payload.
 *
 * Voicelink lets the reseller configure the field NAMES per webhook in the
 * "Add Call Event API" UI. The canonical names below are what we ask for —
 * see the dynamic field list in the Voicelink admin (Event Type, Unique ID,
 * Customer Number, Virtual Number, Agent Number, Call Type, Call Date,
 * Duration, Answer Duration, Status, Recording Path, Hangup Cause, Call Id,
 * plus optional Header 1..5 and Other).
 *
 * Reference: docs/superpowers - Architecture.md §2 "Voicelink call-event
 * webhook contract".
 *
 * Q2 (signature verification scheme) is still unresolved — see verifyWebhook
 * in the TelephonyProvider interface.
 */

export const VoicelinkEventType = z.enum([
  "ringing",
  "answered",
  "completed",
  "failed",
]);
export type VoicelinkEventType = z.infer<typeof VoicelinkEventType>;

export const VoicelinkCallTypeWebhook = z.enum(["inbound", "outbound"]);
export type VoicelinkCallTypeWebhook = z.infer<typeof VoicelinkCallTypeWebhook>;

export const VoicelinkCallStatus = z.enum([
  "answered",
  "busy",
  "noanswer",
  "failed",
]);
export type VoicelinkCallStatus = z.infer<typeof VoicelinkCallStatus>;

/**
 * Optional/nullable helpers. Voicelink will send empty strings for missing
 * fields when the user picks them in the webhook UI. Coerce empty-string ⇒
 * undefined so consumers can treat them uniformly as `field ?? null`.
 */
const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === "string" && v.length > 0 ? v : undefined))
  .optional();

const optionalNumber = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined || v === "") return undefined;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  })
  .optional();

export const VoicelinkCallEvent = z
  .object({
    event_type: VoicelinkEventType,
    unique_id: z.string().min(1),
    call_id: z.string().min(1),
    customer_number: z.string().min(1),
    virtual_number: z.string().min(1),
    agent_number: optionalString,
    call_type: VoicelinkCallTypeWebhook,
    call_date: z.string().min(1), // ISO-8601 with offset
    duration: optionalNumber, // seconds, ring + talk
    answer_duration: optionalNumber, // talk-only seconds — billing
    status: VoicelinkCallStatus,
    recording_path: optionalString,
    hangup_cause: optionalString,
  })
  // Reseller can attach Header 1..5 and Other custom fields — preserve them
  // so tenant-supplied custom_parameters round-trip back to us.
  .passthrough();
export type VoicelinkCallEvent = z.infer<typeof VoicelinkCallEvent>;

/**
 * Maps a Voicelink event_type + status pair to our canonical CallStatus enum
 * (see schemas/call.ts).
 */
export function voicelinkToCallStatus(
  event_type: VoicelinkEventType,
  status: VoicelinkCallStatus,
): "queued" | "ringing" | "inprogress" | "completed" | "failed" {
  if (event_type === "ringing") return "ringing";
  if (event_type === "answered") return "inprogress";
  if (event_type === "completed") {
    return status === "answered" ? "completed" : "failed";
  }
  return "failed";
}
