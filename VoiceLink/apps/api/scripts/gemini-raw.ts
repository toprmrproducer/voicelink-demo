/**
 * Raw Gemini Live probe — bypasses our provider to find the correct
 * model id + message shape for the API-key (Developer) endpoint.
 *   GEMINI_API_KEY=... npx tsx scripts/gemini-raw.ts <model> [v1alpha|v1beta]
 */
import { GoogleGenAI, Modality } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY!;
const model = process.argv[2] || "gemini-2.0-flash-exp";
const apiVersion = process.argv[3] || undefined;

const ai = new GoogleGenAI(
  apiVersion ? { apiKey, httpOptions: { apiVersion } } : { apiKey },
);

let audioBytes = 0;
let msgs = 0;
console.log(`probe model=${model} apiVersion=${apiVersion ?? "default"}`);

const session = await ai.live.connect({
  model,
  config: {
    responseModalities: [Modality.AUDIO],
    systemInstruction: "You are a friendly receptionist. One short sentence.",
  },
  callbacks: {
    onopen: () => console.log("OPEN"),
    onmessage: (m: any) => {
      msgs++;
      const sc = m.serverContent;
      const parts = sc?.modelTurn?.parts ?? [];
      for (const p of parts) {
        if (p.inlineData?.data) audioBytes += Buffer.from(p.inlineData.data, "base64").length;
        if (p.text) console.log("TEXT:", p.text);
      }
      const keys = Object.keys(m).filter((k) => (m as any)[k] != null);
      console.log(`MSG#${msgs} keys=${keys.join(",")} setupComplete=${!!m.setupComplete} turnComplete=${!!sc?.turnComplete} interrupted=${!!sc?.interrupted} audioBytes=${audioBytes}`);
    },
    onerror: (e: any) => console.log("ERROR:", e?.message ?? String(e)),
    onclose: (e: any) => console.log(`CLOSE code=${e?.code} reason=${e?.reason}`),
  },
});

console.log("sending text turn...");
session.sendClientContent({ turns: [{ role: "user", parts: [{ text: "Hello, are you there?" }] }], turnComplete: true });
await new Promise((r) => setTimeout(r, 7000));
session.close();
console.log(`DONE model=${model} totalMsgs=${msgs} audioBytes=${audioBytes}`);
process.exit(audioBytes > 0 ? 0 : 2);
