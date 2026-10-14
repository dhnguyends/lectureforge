import { randomUUID } from "node:crypto";
import { route } from "@/lib/api";
import { SendMessageFieldsSchema, type TutorStreamEventWire } from "@/lib/contracts/tutor";
import { badRequest } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { uploadBuffer } from "@/lib/storage";
import { sniff } from "@/lib/uploads/sniff";
import { AiError } from "@/server/ai";
import { requireStudySet, requireUser } from "@/server/authz";
import { getTutorModel } from "@/server/tutor/model";
import { answerTurn, imageKey, requireConversation } from "@/server/tutor/service";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;

/**
 * Sends a message to the tutor (multipart: text, action, optional image) and
 * streams the reply as server-sent events: user → sources → delta… → done.
 */
export const POST = route<{ id: string; cid: string }>(async (req, { params }) => {
  const user = await requireUser();
  const set = await requireStudySet(user.id, params.id);
  await requireConversation(user.id, params.id, params.cid);
  await enforceRateLimit("tutorMessage", user.id);

  const form = await req.formData().catch(() => {
    throw badRequest("Expected a multipart form.");
  });
  const fields = SendMessageFieldsSchema.parse({ text: form.get("text") ?? "", action: form.get("action") || undefined });

  let image: { base64: string; key: string; mimeType: string } | null = null;
  const file = form.get("image");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMAGE_BYTES) throw badRequest("Images can be up to 8 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const family = sniff(bytes.subarray(0, 64));
    if (!(family in IMAGE_TYPES)) throw badRequest("Attach a PNG, JPEG or WebP image.");
    const mimeType = IMAGE_TYPES[family as keyof typeof IMAGE_TYPES];
    const key = imageKey(set, params.cid, `${randomUUID()}.${family === "jpeg" ? "jpg" : family}`);
    await uploadBuffer(key, bytes, mimeType);
    image = { base64: Buffer.from(bytes).toString("base64"), key, mimeType };
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: TutorStreamEventWire) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The client went away; the turn still finishes and is saved.
        }
      };
      try {
        await answerTurn({
          set,
          conversationId: params.cid,
          userId: user.id,
          text: fields.text,
          action: fields.action ?? null,
          image,
          model: getTutorModel(),
          signal: req.signal,
          emit,
        });
      } catch (err) {
        logger.error({ err, conversationId: params.cid }, "tutor turn failed");
        emit({ type: "error", message: err instanceof AiError ? err.userMessage : "The tutor could not answer right now. Please try again." });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
});
