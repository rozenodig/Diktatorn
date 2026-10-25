// File helpers for signing an app bundle (see package.ts).
import { closeSync, openSync, readdirSync, readSync, realpathSync } from "node:fs";
import { join } from "node:path";

/**
 * Real paths of the files (or directories) under `dir`, each once: frameworks reach the same files
 * through Versions/Current symlinks. Throws on a symlink that leads out of `dir`, because whatever
 * it points to would be shipped and run without being signed.
 */
export function walk(dir: string, directories = false): string[] {
  const root = realpathSync(dir);
  const found = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const path = join(entry.parentPath, entry.name);
    const real = realpathSync(path);
    if (real !== root && !real.startsWith(`${root}/`)) throw new Error(`${path} leads out of ${dir} to ${real}`);
    if (directories ? entry.isDirectory() : entry.isFile()) found.add(real);
  }
  return [...found];
}

export function isMachO(file: string): boolean {
  const head = Buffer.alloc(4);
  const fd = openSync(file, "r");
  const bytes = readSync(fd, head, 0, 4, 0);
  closeSync(fd);
  return bytes === 4 && [0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(head.readUInt32BE(0));
}
