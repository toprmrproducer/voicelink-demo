/**
 * Simulate a VoiceLink WebSocket-bot inbound call against the running
 * API and verify the full loop: ws-router -> session -> GeminiLive ->
 * audio frames back (the agent's greeting). No PSTN, no telephony fees.
 *
 *   npx tsx scripts/ws-inbound-test.ts [didId] [wsBase]
 *   default didId=919484956633  wsBase=ws://localhost:4000
 */
import WebSocket from "ws";

const didId = process.argv[2] || "919484956633";
const wsBase = process.argv[3] || "ws://localhost:4000";
const url = `${wsBase}/ws/voicelink/${didId}`;

const ws = new WebSocket(url);
let mediaFrames = 0;
let mediaBytes = 0;
let gotOpen = false;

ws.on("open", () => {
  gotOpen = true;
  console.log("WS open ->", url);
  // Twilio/VoiceLink-style start frame (inbound: no callId in URL).
  ws.send(
    JSON.stringify({
      event: "start",
      start: {
        callSid: "test-inbound-" + didId,
        streamSid: "stream-test",
        customParameters: { from: "+910000000000" },
      },
    }),
  );
  // Stream ~1s of µ-law silence (0xFF) in 20ms frames (160 bytes @ 8kHz)
  // so the model has input to react to, like a real caller line.
  let sent = 0;
  const timer = setInterval(() => {
    if (ws.readyState !== ws.OPEN || sent >= 50) {
      clearInterval(timer);
      return;
    }
    const silence = Buffer.alloc(160, 0xff);
    ws.send(JSON.stringify({ event: "media", media: { payload: silence.toString("base64") } }));
    sent++;
  }, 20);
});

ws.on("message", (raw) => {
  let msg: any;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (msg.event === "media" && msg.media?.payload) {
    mediaFrames++;
    mediaBytes += Buffer.from(msg.media.payload, "base64").length;
  }
});

ws.on("error", (e) => console.log("WS error:", (e as Error).message));
ws.on("close", (code, reason) => console.log(`WS close code=${code} reason=${reason?.toString()}`));

setTimeout(() => {
  const seconds = +(mediaBytes / 8000).toFixed(2); // µ-law 8kHz bytes -> seconds
  console.log(
    JSON.stringify(
      { gotOpen, mediaFramesFromAgent: mediaFrames, mediaBytes, approxSecondsAgentSpoke: seconds },
      null,
      2,
    ),
  );
  ws.close();
  process.exit(mediaFrames > 0 ? 0 : 2);
}, 9000);
