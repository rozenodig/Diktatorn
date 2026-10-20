// Downloads a model file to a partial file next to its destination, verifies size and
// SHA-256, then renames it into place, so a model file is either complete and verified or
// absent. An interrupted or cancelled download keeps its partial file and resumes from it.
import { createHash, type Hash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ModelFile } from "./models.ts";

export type Progress = (receivedBytes: number, totalBytes: number) => void;

export async function isModelPresent(model: ModelFile, path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.size === model.bytes && (await sha256File(path)) === model.sha256;
}

export async function downloadModel(
  model: ModelFile,
  path: string,
  opts: { onProgress?: Progress; signal?: AbortSignal } = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.part`;
  let received = (await stat(partial).catch(() => null))?.size ?? 0;
  if (received >= model.bytes) {
    await rm(partial, { force: true });
    received = 0;
  }

  const res = await fetch(model.url, {
    headers: received > 0 ? { Range: `bytes=${received}-` } : {},
    signal: opts.signal,
  });
  const hash = createHash("sha256");
  if (received > 0 && res.status === 206) {
    await hashFile(partial, hash);
  } else if (received > 0) {
    // The server ignored the range request and is sending the whole file again.
    received = 0;
  }
  if (!res.ok || !res.body) throw new Error(`${model.id}: HTTP ${res.status}`);

  const count = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length;
      hash.update(chunk);
      opts.onProgress?.(received, model.bytes);
      done(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(res.body),
    count,
    createWriteStream(partial, { flags: received > 0 ? "a" : "w" }),
    { signal: opts.signal },
  );

  const digest = hash.digest("hex");
  if (received !== model.bytes || digest !== model.sha256) {
    await rm(partial, { force: true });
    throw new Error(`${model.id}: verification failed (got ${received} bytes, sha256 ${digest})`);
  }
  await rename(partial, path);
}

async function hashFile(path: string, hash: Hash): Promise<void> {
  for await (const chunk of createReadStream(path)) hash.update(chunk);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await hashFile(path, hash);
  return hash.digest("hex");
}
