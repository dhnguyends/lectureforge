/**
 * Installs the local models the app is configured to use:
 *  - the Whisper model in the speech-to-text service (docker compose "stt")
 *  - the tutor, vision-OCR and embedding models in Ollama
 * Safe to re-run; already-installed models are skipped.
 *   npm run models:init
 */
import "dotenv/config";
import { env } from "../src/lib/env";

const e = env();

async function ensureWhisper() {
  const base = e.TRANSCRIPTION_BASE_URL.replace(/\/$/, "");
  if (e.TRANSCRIPTION_PROVIDER !== "openai-compatible" || base.includes("api.openai.com")) {
    console.log("Speech-to-text: hosted provider configured; nothing to install.");
    return;
  }
  const res = await fetch(`${base}/models`).catch(() => null);
  if (!res?.ok) {
    console.warn(`Speech-to-text service not reachable at ${base}. Start it with: docker compose up -d stt`);
    return;
  }
  const installed = ((await res.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? [];
  if (installed.includes(e.TRANSCRIPTION_MODEL)) {
    console.log(`Speech-to-text: ${e.TRANSCRIPTION_MODEL} already installed.`);
    return;
  }
  console.log(`Speech-to-text: downloading ${e.TRANSCRIPTION_MODEL} (several GB, one time)…`);
  const dl = await fetch(`${base}/models/${e.TRANSCRIPTION_MODEL}`, { method: "POST" });
  console.log(dl.ok ? "  done." : `  failed: HTTP ${dl.status} ${await dl.text()}`);
}

async function ensureOllama() {
  const base = e.OLLAMA_BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/api/tags`).catch(() => null);
  if (!res?.ok) {
    console.warn(`Ollama not reachable at ${base}. Install and start Ollama, then re-run.`);
    return;
  }
  const have = new Set(((await res.json()) as { models: { name: string }[] }).models.map((m) => m.name));
  const wanted = new Set([e.TUTOR_MODEL]);
  if (e.OCR_PROVIDER === "ollama-vision" || e.OCR_PROVIDER === "hybrid") wanted.add(e.OCR_VISION_MODEL);
  if (e.EMBEDDING_PROVIDER !== "none" && e.EMBEDDING_BASE_URL.includes(new URL(base).host)) wanted.add(e.EMBEDDING_MODEL);
  for (const name of wanted) {
    const tagged = name.includes(":") ? name : `${name}:latest`;
    if (have.has(name) || have.has(tagged)) {
      console.log(`Ollama: ${name} already installed.`);
      continue;
    }
    console.log(`Ollama: pulling ${name}…`);
    const pull = await fetch(`${base}/api/pull`, { method: "POST", body: JSON.stringify({ model: name, stream: false }) });
    console.log(pull.ok ? "  done." : `  failed: HTTP ${pull.status} ${await pull.text()}`);
  }
}

async function main() {
  await ensureOllama();
  await ensureWhisper();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
