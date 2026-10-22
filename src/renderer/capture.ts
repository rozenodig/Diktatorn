// Hidden window that owns the microphone. Opens it on start, streams 16 kHz mono samples
// into memory, and hands the whole utterance to the main process on stop. While recording it
// also reports how loud the voice is, which the overlay shows.
const api = window.diktatorn.capture;

/** The level goes out 20 times a second; the overlay smooths between updates. */
const LEVEL_INTERVAL_MS = 50;
/** dBFS mapped to level 0 (room noise) and 1 (loud speech close to the microphone). */
const QUIET_DB = -55;
const LOUD_DB = -20;

// Created at window load so the first recording only has to open the microphone.
const ctx = new AudioContext({ sampleRate: 16_000 });
const workletReady = ctx.audioWorklet.addModule("./worklet.js");
let session: { stream: MediaStream; source: MediaStreamAudioSourceNode; node: AudioWorkletNode; chunks: Float32Array[]; meter: ReturnType<typeof setInterval> } | null = null;
let starting: Promise<void> = Promise.resolve();
/** The chosen microphone, or null for the system default. */
let deviceId: string | null = null;

const constraints = (device: string | null): MediaTrackConstraints => ({
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  ...(device ? { deviceId: { exact: device } } : {}),
});

/** Opens the chosen microphone, falling back to the default if it has been unplugged. */
async function openMicrophone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: constraints(deviceId) });
  } catch (err) {
    if (!deviceId || (err as Error).name !== "OverconstrainedError") throw err;
    return navigator.mediaDevices.getUserMedia({ audio: constraints(null) });
  }
}

/** The loudness of the last 64 ms as 0–1, from its RMS in decibels. */
function level(analyser: AnalyserNode, samples: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const x of samples) sum += x * x;
  const db = 10 * Math.log10(sum / samples.length + 1e-12);
  return Math.min(1, Math.max(0, (db - QUIET_DB) / (LOUD_DB - QUIET_DB)));
}

async function start(): Promise<void> {
  const t0 = performance.now();
  await workletReady;
  const stream = await openMicrophone();
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
  const source = ctx.createMediaStreamSource(stream);
  source.connect(node);
  node.connect(ctx.destination); // keeps the node in the rendered graph; it outputs silence
  const analyser = new AnalyserNode(ctx, { fftSize: 1024 });
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  await ctx.resume();
  const meter = setInterval(() => api.level(level(analyser, samples)), LEVEL_INTERVAL_MS);
  session = { stream, source, node, chunks, meter };
}

async function finish(deliver: boolean): Promise<void> {
  await starting;
  const s = session;
  session = null;
  if (!s) return;
  clearInterval(s.meter);
  // Ask the worklet to flush its partial block, then give it one render quantum to arrive.
  s.node.port.postMessage("flush");
  await new Promise((r) => setTimeout(r, 30));
  s.stream.getTracks().forEach((t) => t.stop());
  s.source.disconnect();
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
api.onDevice((id) => (deviceId = id));
