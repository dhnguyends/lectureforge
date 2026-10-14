import { json, parseBody, route } from "@/lib/api";
import { UpdateAnnotationSchema, type AnnotationView } from "@/lib/contracts/viewer";
import { requireSource, requireUser } from "@/server/authz";
import { deleteAnnotation, requireOwnAnnotation, updateAnnotation } from "@/server/services/viewer";

export const PATCH = route<{ annotationId: string }>(async (req, { params }) => {
  const user = await requireUser();
  const row = await requireOwnAnnotation(user.id, params.annotationId);
  await requireSource(user.id, row.sourceId);
  return json<AnnotationView>(await updateAnnotation(row.id, await parseBody(req, UpdateAnnotationSchema)));
});

export const DELETE = route<{ annotationId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const row = await requireOwnAnnotation(user.id, params.annotationId);
  await deleteAnnotation(row.id);
  return new Response(null, { status: 204 });
});
