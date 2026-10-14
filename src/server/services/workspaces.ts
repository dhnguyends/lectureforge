import { db } from "@/lib/db";

/** Every user owns exactly one personal workspace; create it on first need. */
export async function ensurePersonalWorkspace(userId: string, name?: string | null): Promise<string> {
  const existing = await db.workspace.findFirst({ where: { ownerId: userId, personal: true }, select: { id: true } });
  if (existing) return existing.id;
  const ws = await db.workspace.create({
    data: {
      name: name ? `${name}'s workspace` : "My workspace",
      ownerId: userId,
      personal: true,
      members: { create: { userId, role: "OWNER" } },
    },
    select: { id: true },
  });
  return ws.id;
}
