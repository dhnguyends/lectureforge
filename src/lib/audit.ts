import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { logger } from "./logger";

export type AuditAction =
  | "user.register"
  | "user.delete"
  | "study_set.create"
  | "study_set.delete"
  | "source.create"
  | "source.rights_confirmed"
  | "source.upload_complete"
  | "source.delete"
  | "source.retry"
  | "export.request"
  | "generation.request";

export async function audit(entry: {
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string;
}): Promise<void> {
  try {
    await db.auditLog.create({ data: entry });
  } catch (err) {
    // Auditing must not break the user's request, but it must be visible.
    logger.error({ err, action: entry.action }, "failed to write audit log");
  }
}
