/**
 * Standalone proof that GeminiLiveProvider connects to Gemini Live and
 * speaks audio back — no telephony, no Mongo, no server. Run:
 *   GEMINI_API_KEY=... npx tsx scripts/gemini-smoke.ts
 * Exits 0 if audio frames were received, 2 otherwise.
 */
import { GeminiLiveProvider } from "../src/adapters/llm/gemini-live.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("FAIL: GEMINI_API_KEY not set");
  process.exit(1);
}

const provider = new GeminiLiveProvider({
  apiKey,
  model: "gemini-live-2.0",
  voice: process.env.GEMINI_VOICE || "Puck",
  systemPrompt:
    "You are RapidX AI's friendly phone receptionist. Keep every reply to one short sentence.",
});

let audioBytes = 0;
let frames = 0;
let text = "";
let errored = "";
provider.onAudio((f) => {
  audioBytes += f.length;
  frames++;
});
provider.onText((t) => {
  text += t;
});
provider.onError((e) => {
  errored = e.message;
});

await provider.connect();
console.log("connected to Gemini Live; sending opening prompt...");
provider.sendText(
  "Greet the caller: say you are the RapidX AI assistant and ask how you can help. One sentence.",
);

await new Promise((r) => setTimeout(r, 8000));
await provider.close();

const approxSeconds = +(audioBytes / 2 / 24000).toFixed(2);
console.log(
  JSON.stringify(
    { frames, audioBytes, approxSecondsOfSpeech: approxSeconds, text, errored },
    null,
    2,
  ),
);
process.exit(audioBytes > 0 && !errored ? 0 : 2);
