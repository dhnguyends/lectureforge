import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/errors";

/**
 * Academic profiles (Business School, Engineering, Research, …) and their
 * disciplines. Managed on the admin page; a user's profile decides which
 * subjects their study sets can have (anyDiscipline = no restriction).
 */

export type ProfileView = {
  id: string;
  key: string;
  name: string;
  anyDiscipline: boolean;
  disciplines: { id: string; name: string }[];
  users: number;
};

/** What the study-set form offers a user. */
export type UserDisciplines = {
  profile: string | null;
  anyDiscipline: boolean;
  /** Allowed subjects (restricted profiles) or suggestions (any discipline). */
  disciplines: string[];
};

const include = { disciplines: { orderBy: [{ order: "asc" }, { name: "asc" }] }, _count: { select: { users: true } } } satisfies Prisma.ProfileInclude;

export async function listProfiles(): Promise<ProfileView[]> {
  const profiles = await db.profile.findMany({ orderBy: { createdAt: "asc" }, include });
  return profiles.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    anyDiscipline: p.anyDiscipline,
    disciplines: p.disciplines.map((d) => ({ id: d.id, name: d.name })),
    users: p._count.users,
  }));
}

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60) || "profile";

export async function createProfile(input: { name: string; anyDiscipline: boolean }): Promise<{ id: string }> {
  const name = input.name.trim();
  if (await db.profile.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) throw conflict(`A profile named “${name}” already exists.`);
  let key = slug(name);
  for (let i = 2; await db.profile.findUnique({ where: { key } }); i++) key = `${slug(name)}_${i}`;
  const p = await db.profile.create({ data: { key, name, anyDiscipline: input.anyDiscipline }, select: { id: true } });
  return p;
}

export async function deleteProfile(id: string): Promise<void> {
  const p = await db.profile.findUnique({ where: { id }, include: { _count: { select: { users: true } } } }).catch(() => null);
  if (!p) throw notFound("Profile");
  if (p._count.users > 0) throw conflict(`“${p.name}” still has ${p._count.users} account(s). Move them to another profile first.`);
  await db.profile.delete({ where: { id } });
}

export async function addDiscipline(profileId: string, name: string): Promise<{ id: string }> {
  const p = await db.profile.findUnique({ where: { id: profileId }, include: { disciplines: true } }).catch(() => null);
  if (!p) throw notFound("Profile");
  const clean = name.trim();
  if (p.disciplines.some((d) => d.name.toLowerCase() === clean.toLowerCase())) throw conflict(`“${clean}” is already in ${p.name}.`);
  const order = Math.max(0, ...p.disciplines.map((d) => d.order)) + 1;
  return db.discipline.create({ data: { profileId, name: clean, order }, select: { id: true } });
}

export async function removeDiscipline(id: string): Promise<void> {
  await db.discipline.delete({ where: { id } }).catch((err: { code?: string }) => {
    if (err.code === "P2025") throw notFound("Discipline");
    throw err;
  });
}

export async function requireProfile(id: string) {
  const p = await db.profile.findUnique({ where: { id } }).catch(() => null);
  if (!p) throw badRequest("Choose a valid profile.");
  return p;
}

/** The subjects a user may pick for a study set. */
export async function userDisciplines(userId: string): Promise<UserDisciplines> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { profile: { include: { disciplines: { orderBy: [{ order: "asc" }, { name: "asc" }] } } } } });
  const profile = user?.profile;
  if (profile && !profile.anyDiscipline) {
    return { profile: profile.name, anyDiscipline: false, disciplines: profile.disciplines.map((d) => d.name) };
  }
  // Any discipline: suggest every discipline known to any profile.
  const all = await db.discipline.findMany({ select: { name: true }, orderBy: { name: "asc" }, distinct: ["name"] });
  return { profile: profile?.name ?? null, anyDiscipline: true, disciplines: all.map((d) => d.name) };
}

/** Throws if `subject` is not allowed for this user's profile. Returns the normalized subject. */
export async function checkSubject(userId: string, subject: string | undefined): Promise<string | undefined> {
  const allowed = await userDisciplines(userId);
  if (allowed.anyDiscipline) return subject?.trim() || undefined;
  const match = allowed.disciplines.find((d) => d.toLowerCase() === (subject ?? "").trim().toLowerCase());
  if (!match) throw badRequest(`Choose a discipline of the ${allowed.profile} profile: ${allowed.disciplines.join(", ")}.`);
  return match;
}
