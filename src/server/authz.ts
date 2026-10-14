import type { StudySet, WorkspaceRole } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { forbidden, notFound, unauthorized } from "@/lib/errors";

export type CurrentUser = { id: string; email: string | null | undefined };

export async function requireUser(): Promise<CurrentUser> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw unauthorized();
  // Sessions are signed cookies: a deleted account must lose access at once.
  const exists = await db.user.findUnique({ where: { id }, select: { id: true } }).catch(() => null);
  if (!exists) throw unauthorized();
  return { id, email: session.user.email };
}

const RANK: Record<WorkspaceRole, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads a study set the user may access with at least `min` role.
 * - Must be a member of the owning workspace.
 * - PRIVATE sets are visible only to their creator, even in shared workspaces.
 * Missing and forbidden both surface as 404 unless the user can see the set
 * but lacks the role for this action (403).
 */
export async function requireStudySet(
  userId: string,
  studySetId: string,
  min: WorkspaceRole = "VIEWER",
): Promise<StudySet & { role: WorkspaceRole }> {
  if (!UUID_RE.test(studySetId)) throw notFound("Study set");
  const set = await db.studySet.findFirst({
    where: { id: studySetId, deletedAt: null, workspace: { members: { some: { userId } } } },
    include: { workspace: { select: { members: { where: { userId }, select: { role: true } } } } },
  });
  if (!set) throw notFound("Study set");
  if (set.visibility === "PRIVATE" && set.createdById !== userId) throw notFound("Study set");
  const role = set.workspace.members[0]?.role;
  if (!role) throw notFound("Study set");
  if (RANK[role] < RANK[min]) throw forbidden();
  const { workspace: _ws, ...rest } = set;
  return { ...rest, role };
}

/** Resolves a source through its study set so the same rules apply. */
export async function requireSource(userId: string, sourceId: string, min: WorkspaceRole = "VIEWER") {
  if (!UUID_RE.test(sourceId)) throw notFound("Source");
  const source = await db.source.findUnique({ where: { id: sourceId } });
  if (!source) throw notFound("Source");
  const studySet = await requireStudySet(userId, source.studySetId, min);
  return { source, studySet };
}
