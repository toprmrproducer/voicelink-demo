/**
 * Seed RapidX AI tenant + Gemini agent + the two VoiceLink DIDs + login
 * users. Idempotent: upserts by stable ids. Run:
 *   npx tsx scripts/seed.ts
 */
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcrypt";

const MONGO_URL = process.env.MONGO_URL!;
const VOICELINK_CLIENT_ID = 1264; // SWATI PRASAD (discovered via /v1/reseller/clients)

const TENANT_ID = "rapidx-tenant";
const AGENT_ID = "rapidx-receptionist";
const DIDS = [
  { number: "919484956633", botId: "140" },
  { number: "919484956952", botId: "141" },
];

const SUPERADMIN = { email: "admin@rapidxai.com", password: "RapidXadmin2026" };
const OWNER = { email: "swati@rapidxai.com", password: "RapidX2026" };

async function main() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const db = client.db();
  const now = new Date();

  // ---- Tenant ----
  await db.collection("tenants").updateOne(
    { _id: TENANT_ID as any },
    {
      $set: {
        name: "RapidX AI",
        plan: "scale",
        status: "active",
        telephony: { provider: "voicelink", providerClientId: VOICELINK_CLIENT_ID, walletThresholdNotify: 0 },
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  // ---- Agent (Gemini Live) ----
  await db.collection("agents").updateOne(
    { _id: AGENT_ID as any },
    {
      $set: {
        tenantId: TENANT_ID,
        name: "RapidX AI Receptionist",
        prompt:
          "You are the AI phone receptionist for RapidX AI, an AI automation agency that builds voice agents, " +
          "workflow automations, and custom AI systems for businesses. Be warm, concise, and professional. " +
          "Answer questions about RapidX AI's services, understand what the caller needs, and offer to book a " +
          "discovery call or take a message with their name and number. Keep replies to one or two short " +
          "sentences. Speak naturally for a phone call. Never use the dash character in your speech.",
        voice: { provider: "gemini-live", providerVoiceId: "Puck" },
        llm: { realtimeModel: "gemini-live-2.0", temperature: 0.7 },
        tools: [],
        greeting:
          "Open the call now: warmly greet the caller, say you are the RapidX AI assistant, and ask how you can help today. Keep it to one short sentence.",
        endCallTriggers: [],
        status: "published",
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  // ---- DIDs (id = phone number so WS path = /ws/voicelink/<number>) ----
  for (const d of DIDS) {
    await db.collection("dids").updateOne(
      { _id: d.number as any },
      {
        $set: {
          tenantId: TENANT_ID,
          provider: "voicelink",
          providerNumber: d.number,
          didType: "mobile",
          defaultAgentId: AGENT_ID,
          providerBotId: d.botId,
          status: "active",
          updatedAt: now,
        },
        $setOnInsert: { assignedAt: now, createdAt: now },
      },
      { upsert: true },
    );
  }

  // ---- Users ----
  async function upsertUser(email: string, password: string, opts: { superadmin: boolean; tenantId: string | null }) {
    const passwordHash = await bcrypt.hash(password, 10);
    const existing = await db.collection("users").findOne({ email });
    if (existing) {
      await db.collection("users").updateOne(
        { email },
        { $set: { passwordHash, isSuperadmin: opts.superadmin, tenantId: opts.tenantId, role: "owner", updatedAt: now } },
      );
    } else {
      await db.collection("users").insertOne({
        _id: new ObjectId().toString() as any,
        email,
        passwordHash,
        role: "owner",
        isSuperadmin: opts.superadmin,
        tenantId: opts.tenantId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  await upsertUser(SUPERADMIN.email, SUPERADMIN.password, { superadmin: true, tenantId: null });
  await upsertUser(OWNER.email, OWNER.password, { superadmin: false, tenantId: TENANT_ID });

  // Give the tenant 1,000,000 credits (balance lives in the `credits`
  // collection; the sidebar reads it via getBalance()).
  await db.collection("credits").updateOne(
    { _id: TENANT_ID as any },
    { $set: { tenantId: TENANT_ID, balance: 1_000_000, unit: "minutes", updatedAt: now } },
    { upsert: true },
  );

  console.log(JSON.stringify({
    tenant: TENANT_ID,
    agent: AGENT_ID,
    dids: DIDS.map((d) => d.number),
    superadmin: SUPERADMIN.email,
    owner: OWNER.email,
  }, null, 2));
  await client.close();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
