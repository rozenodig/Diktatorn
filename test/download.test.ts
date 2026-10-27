// Model downloads against a local HTTP server: verification, cancel and resume.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { downloadModel } from "../src/main/download.ts";
import type { ModelFile } from "../src/main/models.ts";

const body = randomBytes(256 * 1024);
const sha256 = createHash("sha256").update(body).digest("hex");
let server: Server;
let base: string;
let dir: string;
let honourRange = true;
let ranges: string[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "diktatorn-download-"));
  server = createServer((req, res) => {
    const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    if (range) ranges.push(range[1]!);
    const start = honourRange && range ? Number(range[1]) : 0;
    res.writeHead(start > 0 ? 206 : 200, { "content-length": body.length - start });
    // Send slowly in small chunks so a download can be cancelled part-way.
    let offset = start;
    const timer = setInterval(() => {
      if (offset >= body.length) {
        clearInterval(timer);
        res.end();
        return;
      }
      res.write(body.subarray(offset, offset + 16 * 1024));
      offset += 16 * 1024;
    }, 5);
    res.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const model = (overrides: Partial<ModelFile> = {}): ModelFile => ({
  id: "silero-vad",
  name: "test",
  url: `${base}/model.bin`,
  sha256,
  bytes: body.length,
  file: "model.bin",
  license: "MIT",
  ...overrides,
});

test("a complete download is verified and moved into place", async () => {
  const path = join(dir, "a.bin");
  await downloadModel(model(), path);
  assert.deepEqual(readFileSync(path), body);
  assert.equal(existsSync(`${path}.part`), false);
});

test("a corrupt download is rejected and leaves nothing behind", async () => {
  const path = join(dir, "b.bin");
  await assert.rejects(downloadModel(model({ sha256: "0".repeat(64) }), path), /verification failed/);
  assert.equal(existsSync(path), false);
  assert.equal(existsSync(`${path}.part`), false);
});

test("a download larger than the pinned size stops early and leaves nothing behind", async () => {
  const path = join(dir, "e.bin");
  let largest = 0;
  await assert.rejects(
    downloadModel(model({ bytes: 64 * 1024 }), path, { onProgress: (received) => (largest = received) }),
    /more than 65536 bytes/,
  );
  assert.ok(largest <= 64 * 1024, `progress reported ${largest} bytes`);
  assert.equal(existsSync(path), false);
  assert.equal(existsSync(`${path}.part`), false);
});

test("a cancelled download resumes from its partial file", async () => {
  const path = join(dir, "c.bin");
  const abort = new AbortController();
  ranges = [];
  await assert.rejects(
    downloadModel(model(), path, {
      signal: abort.signal,
      onProgress: (received) => received >= 64 * 1024 && abort.abort(),
    }),
  );
  const partial = statSync(`${path}.part`).size;
  assert.ok(partial > 0 && partial < body.length, `partial file of ${partial} bytes`);

  await downloadModel(model(), path);
  assert.deepEqual(ranges, [String(partial)], "the second request asked for the rest only");
  assert.deepEqual(readFileSync(path), body);
});

test("a server that ignores the range request still yields a verified file", async () => {
  const path = join(dir, "d.bin");
  const abort = new AbortController();
  await assert.rejects(
    downloadModel(model(), path, { signal: abort.signal, onProgress: (r) => r >= 64 * 1024 && abort.abort() }),
  );
  honourRange = false;
  try {
    await downloadModel(model(), path);
  } finally {
    honourRange = true;
  }
  assert.deepEqual(readFileSync(path), body);
});
