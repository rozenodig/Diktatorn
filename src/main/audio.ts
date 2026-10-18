// PCM helpers for 16 kHz mono audio.
export const SAMPLE_RATE = 16_000;

export function concatChunks(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Float samples in [-1, 1] to base64 16-bit little-endian PCM (the speech process wire format). */
export function pcmToBase64(samples: Float32Array): string {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), i * 2);
  }
  return buf.toString("base64");
}

export interface Trimmed {
  samples: Float32Array;
  startMs: number;
  endMs: number;
  /** Sum of detected speech, excluding gaps and padding. */
  speechMs: number;
}

/**
 * Cuts the clip from the first to the last speech segment, plus padding on both sides.
 * Segments are [start, end] in centiseconds. Returns null when there is no speech.
 */
export function trimToSpeech(samples: Float32Array, segments: number[][], padMs: number): Trimmed | null {
  if (segments.length === 0) return null;
  const durationMs = (samples.length / SAMPLE_RATE) * 1000;
  const firstMs = (segments[0]?.[0] ?? 0) * 10;
  const lastMs = (segments.at(-1)?.[1] ?? 0) * 10;
  const startMs = Math.max(0, firstMs - padMs);
  const endMs = Math.min(durationMs, lastMs + padMs);
  const speechMs = segments.reduce((n, [a = 0, b = 0]) => n + (b - a) * 10, 0);
  const toSample = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);
  return { samples: samples.slice(toSample(startMs), toSample(endMs)), startMs, endMs, speechMs };
}
