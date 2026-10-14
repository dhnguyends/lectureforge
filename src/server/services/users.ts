import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import type { RegisterInputSchema } from "@/lib/contracts/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { deletePrefix } from "@/lib/storage";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { z } from "zod";

/**
 * Whether this email may create an account. SIGNUP_ALLOWED_EMAILS is a comma-
 * separated list of addresses and/or "@domain" entries; empty means anyone.
 */
export function signupAllowed(email: string, allowList: string): boolean {
  const entries = allowList.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (entries.length === 0) return true;
  const address = email.trim().toLowerCase();
  return entries.some((entry) => (entry.startsWith("@") ? address.endsWith(entry) : address === entry));
}

/**
 * Creates a password user with their personal workspace. Throws 409 on
 * duplicate email. Accounts created from the admin page skip the sign-up
 * allowlist: the administrator decides.
 */
export async function registerUser(
  input: z.output<typeof RegisterInputSchema>,
  ip: string,
  opts: { byAdmin?: boolean; profileId?: string } = {},
): Promise<{ id: string }> {
  if (!opts.byAdmin) await enforceRateLimit("register", ip);
  if (!opts.byAdmin && !signupAllowed(input.email, env().SIGNUP_ALLOWED_EMAILS)) {
    throw forbidden("Sign-up is by invitation on this server. Ask the administrator to add your email.");
  }
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const user = await db.$transaction(async (tx) => {
      // Without an explicit profile an account is Research (no subject restriction).
      const profileId = opts.profileId ?? (await tx.profile.findUnique({ where: { key: "research" }, select: { id: true } }))?.id;
      const created = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash, profileId } });
      await tx.workspace.create({
        data: {
          name: `${input.name}'s workspace`,
          ownerId: created.id,
          personal: true,
          members: { create: { userId: created.id, role: "OWNER" } },
        },
      });
      return created;
    });
    await audit({ userId: user.id, action: "user.register", entityType: "User", entityId: user.id, ip });
    return { id: user.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict("An account with this email already exists. Try signing in.");
    }
    throw err;
  }
}

export type AccountView = {
  id: string;
  name: string | null;
  email: string | null;
  createdAt: string;
  studySets: number;
  profile: { id: string; name: string } | null;
};

/** Every account, newest first, for the admin page. */
export async function listAccounts(): Promise<AccountView[]> {
  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, email: true, createdAt: true, profile: { select: { id: true, name: true } }, _count: { select: { createdStudySets: true } } },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    createdAt: u.createdAt.toISOString(),
    studySets: u._count.createdStudySets,
    profile: u.profile,
  }));
}

export async function setUserProfile(userId: string, profileId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { profileId } }).catch((err: { code?: string }) => {
    if (err.code === "P2025") throw notFound("Account");
    throw err;
  });
}

/**
 * Deletes an account for good: its uploaded files in object storage, then the
 * user row, which cascades to its workspaces, study sets, sources, generated
 * materials, reviews and sessions. Signed-in browsers lose access at once
 * (requireUser checks that the user still exists).
 */
export async function deleteAccount(userId: string): Promise<{ email: string | null; objectsRemoved: number }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, ownedWorkspaces: { select: { id: true } } } }).catch(() => null);
  if (!user) throw notFound("Account");
  let objectsRemoved = 0;
  for (const ws of user.ownedWorkspaces) {
    try {
      objectsRemoved += await deletePrefix(`ws/${ws.id}/`);
    } catch (err) {
      // Keep going: orphaned files are better than a half-deleted account.
      logger.error({ err, workspaceId: ws.id }, "could not delete stored files of a deleted account");
    }
  }
  await db.user.delete({ where: { id: userId } });
  await audit({ userId: null, action: "user.delete", entityType: "User", entityId: userId, metadata: { objectsRemoved } });
  return { email: user.email, objectsRemoved };
}
