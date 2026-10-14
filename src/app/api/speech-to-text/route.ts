import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { json, route } from "@/lib/api";
import { badRequest, HttpError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sniff } from "@/lib/uploads/sniff";
import { requireUser } from "@/server/authz";
import { PipelineError } from "@/server/pipeline/errors";
import { getTranscriptionProvider } from "@/server/providers/transcription";

const MAX_BYTES = 20 * 1024 * 1024;
const AUDIO: Record<string, [string, string]> = {
  matroska: ["webm", "audio/webm"],
  ogg: ["ogg", "audio/ogg"],
  "iso-bmff": ["m4a", "audio/mp4"],
  wav: ["wav", "audio/wav"],
  mp3: ["mp3", "audio/mpeg"],
};

/** Voice input: transcribes a short recording with the configured speech-to-text service. */
export const POST = route(async (req) => {
  const user = await requireUser();
  await enforceRateLimit("tutorMessage", user.id);
  const form = await req.formData().catch(() => {
    throw badRequest("Expected a multipart form.");
  });
  const file = form.get("audio");
  if (!(file instanceof File) || file.size === 0) throw badRequest("No audio received.");
  if (file.size > MAX_BYTES) throw badRequest("Recordings can be up to 20 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = AUDIO[sniff(bytes.subarray(0, 64))];
  if (!kind) throw badRequest("Unsupported audio format.");

  const path = join(tmpdir(), `lf-voice-${randomUUID()}.${kind[0]}`);
  await writeFile(path, bytes);
  try {
    const language = (form.get("language") as string | null) || null;
    const result = await getTranscriptionProvider().transcribe({ filePath: path, mimeType: kind[1], language, diarize: false });
    return json({ text: result.segments.map((s) => s.text).join(" ").trim() });
  } catch (err) {
    if (err instanceof PipelineError) throw new HttpError(err.retryable ? 503 : 422, "transcription_failed", err.userMessage);
    throw err;
  } finally {
    await rm(path, { force: true });
  }
});
