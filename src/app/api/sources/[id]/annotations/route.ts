import { json, parseBody, route } from "@/lib/api";
import { CreateAnnotationSchema, type AnnotationView } from "@/lib/contracts/viewer";
import { requireSource, requireUser } from "@/server/authz";
import { createAnnotation, listAnnotations } from "@/server/services/viewer";

/** The caller's private highlights and notes on this source. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireSource(user.id, params.id);
  return json<{ annotations: AnnotationView[] }>({ annotations: await listAnnotations(user.id, params.id) }, 200, { "Cache-Control": "private, no-store" });
});

/** Viewers may annotate too: annotations are private to their author. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  await requireSource(user.id, params.id);
  const input = await parseBody(req, CreateAnnotationSchema);
  return json<AnnotationView>(await createAnnotation(user.id, params.id, input), 201);
});
