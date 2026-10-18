// Speech model manifest. Every file is pinned to a Hugging Face commit and verified by
// SHA-256 and exact size after download.
import { homedir } from "node:os";
import { join } from "node:path";

export type ModelId = "kb-whisper-medium" | "kb-whisper-large" | "whisper-large-v3-turbo" | "silero-vad";

export interface ModelFile {
  id: ModelId;
  url: string;
  sha256: string;
  bytes: number;
  file: string;
  license: string;
}

const hf = (repo: string, rev: string, file: string) => `https://huggingface.co/${repo}/resolve/${rev}/${file}`;

export const MODELS: Record<ModelId, ModelFile> = {
  "kb-whisper-medium": {
    id: "kb-whisper-medium",
    url: hf("KBLab/kb-whisper-medium", "0abe10b9d7f75d0902656e5c06c5c4d549604dc5", "ggml-model-q5_0.bin"),
    sha256: "7f8762e0ade9e0073674c0d5acae942a0b1ea98add9baa008ee89c94eaba43d0",
    bytes: 539_212_484,
    file: "kb-whisper-medium-q5_0.bin",
    license: "Apache-2.0",
  },
  "kb-whisper-large": {
    id: "kb-whisper-large",
    url: hf("KBLab/kb-whisper-large", "d5d5984b4d8f7c4847a8ea203f1976285fb28300", "ggml-model-q5_0.bin"),
    sha256: "6d2863812d7410322bb7d8647a5c7260761300fa946714c9ed66d22bb30bcb19",
    bytes: 1_081_140_203,
    file: "kb-whisper-large-q5_0.bin",
    license: "Apache-2.0",
  },
  "whisper-large-v3-turbo": {
    id: "whisper-large-v3-turbo",
    url: hf("ggerganov/whisper.cpp", "5359861c739e955e79d9a303bcbc70fb988958b1", "ggml-large-v3-turbo-q5_0.bin"),
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    bytes: 574_041_195,
    file: "whisper-large-v3-turbo-q5_0.bin",
    license: "MIT",
  },
  "silero-vad": {
    id: "silero-vad",
    url: hf("ggml-org/whisper-vad", "9ffd54a1e1ee413ddf265af9913beaf518d1639b", "ggml-silero-v6.2.0.bin"),
    sha256: "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987",
    bytes: 885_098,
    file: "silero-v6.2.0.bin",
    license: "MIT",
  },
};

/** Models used when the user has not chosen otherwise. */
export const DEFAULT_MODELS = { sv: "kb-whisper-medium", en: "whisper-large-v3-turbo", vad: "silero-vad" } as const;

/** Matches Electron's app.getPath("userData") for productName "Diktatorn". */
export function defaultUserDataDir(): string {
  return join(homedir(), "Library", "Application Support", "Diktatorn");
}

export function modelPath(id: ModelId, userDataDir = defaultUserDataDir()): string {
  return join(userDataDir, "models", MODELS[id].file);
}
