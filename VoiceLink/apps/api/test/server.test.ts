import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import type { Server } from "http";

let server: Server;

beforeAll(async () => {
  const app = createApp();
  server = app.listen(0);
});

afterAll(() => {
  server?.close();
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(server).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", timestamp: expect.any(String) });
  });
});
