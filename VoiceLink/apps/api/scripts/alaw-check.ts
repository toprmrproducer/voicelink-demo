import { alawEncodeSample, alawDecodeSample, alawToPcm16, pcm16ToAlaw } from "../src/voice-engine/audio-pipeline.js";
// 1) silence byte must be 0xD5 (a-law), not 0xFF (mu-law)
console.log("alaw(0) =", alawEncodeSample(0).toString(16), "(expect d5)");
// 2) round-trip a 440Hz sine at 8kHz, measure mean abs error vs full-scale
const N = 8000, amp = 12000;
const pcm = Buffer.alloc(N*2);
for (let i=0;i<N;i++) pcm.writeInt16LE(Math.round(amp*Math.sin(2*Math.PI*440*i/8000)), i*2);
const rt = alawToPcm16(pcm16ToAlaw(pcm));
let err=0,maxs=0;
for (let i=0;i<N;i++){const a=pcm.readInt16LE(i*2),b=rt.readInt16LE(i*2);err+=Math.abs(a-b);maxs=Math.max(maxs,Math.abs(a));}
console.log("mean abs err =", (err/N).toFixed(1), "/ amp", amp, "=>", ((err/N)/amp*100).toFixed(2)+"% (expect <3%)");
// 3) monotonic-ish: decode of a few codes
console.log("decode(0xd5)=",alawDecodeSample(0xd5),"decode(0x55)=",alawDecodeSample(0x55));
