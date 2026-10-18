// Hidden window that owns the microphone. Opens it on start, streams 16 kHz mono samples
// into memory, and hands the whole utterance to the main process on stop.
const api = window.diktatorn.capture;

let ctx: AudioContext | null = null;
let session: { stream: MediaStream; node: AudioWorkletNode; chunks: Float32Array[] } | null = null;
let starting: Promise<void> = Promise.resolve();

async function start(): Promise<void> {
  const t0 = performance.now();
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: 16_000 });
    await ctx.audioWorklet.addModule("./worklet.js");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const node = new AudioWorkletNode(ctx, "pcm-tap");
  const chunks: Float32Array[] = [];
  let first = true;
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    chunks.push(e.data);
    if (first) {
      first = false;
      api.started(performance.now() - t0);
    }
  };
  ctx.createMediaStreamSource(stream).connect(node);
  node.connect(ctx.destination); // keeps the node in the rendered graph; it outputs silence
  await ctx.resume();
  session = { stream, node, chunks };
}

async function finish(deliver: boolean): Promise<void> {
  await starting;
  const s = session;
  session = null;
  if (!s) return;
  // Ask the worklet to flush its partial block, then give it one render quantum to arrive.
  s.node.port.postMessage("flush");
  await new Promise((r) => setTimeout(r, 30));
  s.stream.getTracks().forEach((t) => t.stop());
  s.node.disconnect();
  if (!deliver) return;
  const total = s.chunks.reduce((n, c) => n + c.length, 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const c of s.chunks) {
    samples.set(c, offset);
    offset += c.length;
  }
  api.audio(samples);
}

const report = (err: unknown) => api.error(err instanceof Error ? err.message : String(err));

api.onStart(() => {
  starting = start().catch(report);
});
api.onStop(() => void finish(true).catch(report));
api.onCancel(() => void finish(false).catch(report));
