// 16 kHz mono 16-bit WAV files, the format benchmark recordings are stored in.
import { SAMPLE_RATE, toPcm16 } from "./audio.ts";

export function encodeWav(samples: Float32Array): Buffer {
  const data = toPcm16(samples);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32); // bytes per frame
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Reads a 16 kHz mono 16-bit PCM WAV file, skipping any chunks other than "fmt " and "data". */
export function decodeWav(bytes: Buffer): Float32Array {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a WAV file");
  }
  let format: { codec: number; channels: number; rate: number; bits: number } | null = null;
  for (let pos = 12; pos + 8 <= bytes.length; ) {
    const id = bytes.toString("ascii", pos, pos + 4);
    const size = bytes.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      format = {
        codec: bytes.readUInt16LE(body),
        channels: bytes.readUInt16LE(body + 2),
        rate: bytes.readUInt32LE(body + 4),
        bits: bytes.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      if (!format) throw new Error("WAV data chunk before its format chunk");
      const { codec, channels, rate, bits } = format;
      if (codec !== 1 || channels !== 1 || rate !== SAMPLE_RATE || bits !== 16) {
        throw new Error(`expected ${SAMPLE_RATE} Hz mono 16-bit PCM, got codec ${codec}, ${channels} ch, ${rate} Hz, ${bits} bit`);
      }
      const end = Math.min(body + size, bytes.length);
      const samples = new Float32Array((end - body) >> 1);
      for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(body + i * 2) / 32768;
      return samples;
    }
    pos = body + size + (size & 1); // chunks are padded to an even length
  }
  throw new Error("WAV file has no data chunk");
}
