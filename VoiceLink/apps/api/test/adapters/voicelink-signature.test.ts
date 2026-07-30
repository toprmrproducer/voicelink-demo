import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

import {
  verifyVoicelinkWebhook,
  __resetSignatureWarningForTests,
} from "../../src/adapters/telephony/voicelink/signature.js";

const secret = "test-secret";
const body = Buffer.from(JSON.stringify({ event_type: "ringing", unique_id: "x" }));

function sign(buf: Buffer, key: string): string {
  return createHmac("sha256", key).update(buf).digest("hex");
}

describe("verifyVoicelinkWebhook", () => {
  beforeEach(() => __resetSignatureWarningForTests());

  it("returns true (passthrough) when no secret is configured", () => {
    expect(verifyVoicelinkWebhook({}, body)).toBe(true);
  });

  it("returns false when secret is configured but header missing", () => {
    expect(verifyVoicelinkWebhook({}, body, { secret })).toBe(false);
  });

  it("accepts a bare-hex signature", () => {
    const hex = sign(body, secret);
    expect(
      verifyVoicelinkWebhook(
        { "x-voicelink-signature": hex },
        body,
        { secret },
      ),
    ).toBe(true);
  });

  it("accepts an `algo=<hex>` signature", () => {
    const hex = sign(body, secret);
    expect(
      verifyVoicelinkWebhook(
        { "x-voicelink-signature": `hmac-sha256=${hex}` },
        body,
        { secret },
      ),
    ).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const hex = sign(body, "different-secret");
    expect(
      verifyVoicelinkWebhook(
        { "x-voicelink-signature": hex },
        body,
        { secret },
      ),
    ).toBe(false);
  });

  it("rejects a signature for a tampered body", () => {
    const hex = sign(body, secret);
    const tampered = Buffer.concat([body, Buffer.from("XXX")]);
    expect(
      verifyVoicelinkWebhook(
        { "x-voicelink-signature": hex },
        tampered,
        { secret },
      ),
    ).toBe(false);
  });

  it("supports a custom header name", () => {
    const hex = sign(body, secret);
    expect(
      verifyVoicelinkWebhook(
        { "x-vlink-sig": hex },
        body,
        { secret, header: "x-vlink-sig" },
      ),
    ).toBe(true);
    // Default header name should fail in that case.
    expect(
      verifyVoicelinkWebhook(
        { "x-voicelink-signature": hex },
        body,
        { secret, header: "x-vlink-sig" },
      ),
    ).toBe(false);
  });

  it("rejects garbage in the signature header", () => {
    expect(
      verifyVoicelinkWebhook(
        { "x-voicelink-signature": "not-hex!!" },
        body,
        { secret },
      ),
    ).toBe(false);
  });

  it("works on string bodies (UTF-8 encoded)", () => {
    const str = "{\"a\":1}";
    const hex = createHmac("sha256", secret).update(str, "utf8").digest("hex");
    expect(
      verifyVoicelinkWebhook(
        { "x-voicelink-signature": hex },
        str,
        { secret },
      ),
    ).toBe(true);
  });
});
