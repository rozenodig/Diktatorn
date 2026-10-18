// Downloads a model file to a temporary path, verifies size and SHA-256, then renames it
// into place, so a model file is either complete and verified or absent.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ModelFile } from "./models.ts";

export type Progress = (receivedBytes: number, totalBytes: number) => void;

export async function isModelPresent(model: ModelFile, path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.size === model.bytes && (await sha256File(path)) === model.sha256;
}

export async function downloadModel(model: ModelFile, path: string, onProgress?: Progress): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.part`;
  const res = await fetch(model.url);
  if (!res.ok || !res.body) throw new Error(`${model.id}: HTTP ${res.status}`);

  let received = 0;
  const hash = createHash("sha256");
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    hash.update(chunk);
    onProgress?.(received, model.bytes);
  });
  await pipeline(body, createWriteStream(partial));

  const digest = hash.digest("hex");
  if (received !== model.bytes || digest !== model.sha256) {
    await rm(partial, { force: true });
    throw new Error(`${model.id}: verification failed (got ${received} bytes, sha256 ${digest})`);
  }
  await rename(partial, path);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
