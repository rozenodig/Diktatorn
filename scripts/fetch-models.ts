// Development helper: downloads the default speech models (or the ids given as arguments)
// into the app's model directory. Usage: npm run fetch-models [-- gemma-4-e2b-it-qat]
import { downloadModel, isModelPresent } from "../src/main/download.ts";
import { DEFAULT_MODELS, MODELS, modelPath, type ModelId } from "../src/main/models.ts";

const requested = process.argv.slice(2) as ModelId[];
const ids: ModelId[] = requested.length > 0 ? requested : Object.values(DEFAULT_MODELS);

for (const id of ids) {
  const model = MODELS[id];
  if (!model) throw new Error(`unknown model '${id}', expected one of: ${Object.keys(MODELS).join(", ")}`);
  const path = modelPath(id);
  if (await isModelPresent(model, path)) {
    console.log(`${id}: present`);
    continue;
  }
  let lastPct = -1;
  await downloadModel(model, path, {
    onProgress: (got, total) => {
      const pct = Math.floor((got / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) process.stdout.write(`\r${id}: ${pct}%`);
      lastPct = pct;
    },
  });
  console.log(`\r${id}: downloaded and verified -> ${path}`);
}
