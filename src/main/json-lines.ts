// Runs a helper executable that speaks one JSON object per line on stdin/stdout.
// Messages with an "id" answer a request; messages with an "event" are pushed to listeners.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";

interface Pending {
  resolve: (msg: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class JsonLinesProcess extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private exited = false;
  readonly name: string;

  constructor(name: string, command: string, env: NodeJS.ProcessEnv = process.env) {
    super();
    this.name = name;
    this.child = spawn(command, [], { env, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.on("data", (d: Buffer) => process.stderr.write(`[${name}] ${d}`));
    createInterface({ input: this.child.stdout }).on("line", (line) => this.onLine(line));
    this.child.on("error", (err) => this.fail(err));
    this.child.on("exit", (code, signal) => {
      this.fail(new Error(`${name} exited (code ${code}, signal ${signal})`));
      this.emit("exit", code, signal);
    });
  }

  request(cmd: string, payload: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<Record<string, unknown>> {
    if (this.exited) return Promise.reject(new Error(`${this.name} is not running`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name}: '${cmd}' timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, cmd, ...payload });
    });
  }

  /** Asks the helper to exit, then kills it if it has not exited within a second. */
  close(): void {
    if (this.exited) return;
    this.write({ cmd: "shutdown" });
    setTimeout(() => this.exited || this.child.kill(), 1000).unref();
  }

  private write(msg: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stderr.write(`[${this.name}] non-JSON output: ${line}\n`);
      return;
    }
    const pending = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
    if (pending) {
      this.pending.delete(msg.id as number);
      clearTimeout(pending.timer);
      if (msg.ok) pending.resolve(msg);
      else pending.reject(new Error(`${this.name}: ${String(msg.error)}`));
    } else if (typeof msg.event === "string") {
      this.emit("event", msg);
    }
  }

  private fail(err: Error): void {
    this.exited = true;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }
}
