// AudioWorklet that copies the microphone input out of the audio thread in ~100 ms blocks.
// Runs inside a 16 kHz AudioContext, so Chromium has already resampled the device audio.

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: typeof AudioWorkletProcessor): void;

const BLOCK = 1600; // 100 ms at 16 kHz

class PcmTap extends AudioWorkletProcessor {
  private buf = new Float32Array(BLOCK);
  private n = 0;

  constructor() {
    super();
    this.port.onmessage = () => this.flush(); // any message = flush the remainder
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.buf[this.n++] = input[i] ?? 0;
      if (this.n === BLOCK) this.flush();
    }
    return true;
  }

  private flush(): void {
    this.port.postMessage(this.buf.slice(0, this.n));
    this.n = 0;
  }
}

registerProcessor("pcm-tap", PcmTap);
