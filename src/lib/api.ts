import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { HttpError, badRequest } from "./errors";
import { logger } from "./logger";

export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown; requestId: string };
};

type RouteContext<P> = { params: Promise<P> };

/**
 * Wraps a route handler with consistent error mapping and request logging.
 * Handlers throw HttpError / ZodError; everything else becomes a 500 with a
 * request id the user can quote to support.
 */
export function route<P = Record<string, string>>(
  handler: (req: NextRequest, ctx: { params: P; requestId: string }) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: RouteContext<P>): Promise<Response> => {
    const requestId = randomUUID();
    const started = Date.now();
    try {
      const params = await ctx.params;
      const res = await handler(req, { params, requestId });
      logger.info(
        { requestId, method: req.method, path: req.nextUrl.pathname, status: res.status, ms: Date.now() - started },
        "request",
      );
      return res;
    } catch (err) {
      return toErrorResponse(err, requestId, req);
    }
  };
}

function toErrorResponse(err: unknown, requestId: string, req: NextRequest): Response {
  if (err instanceof ZodError) {
    return json<ApiErrorBody>(
      { error: { code: "validation_error", message: "Invalid request.", details: err.issues, requestId } },
      400,
    );
  }
  if (err instanceof HttpError) {
    const headers: Record<string, string> = {};
    const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
    if (err.status === 429 && retry) headers["Retry-After"] = String(retry);
    return json<ApiErrorBody>(
      { error: { code: err.code, message: err.message, details: err.details, requestId } },
      err.status,
      headers,
    );
  }
  logger.error({ err, requestId, method: req.method, path: req.nextUrl.pathname }, "unhandled route error");
  return json<ApiErrorBody>(
    { error: { code: "internal_error", message: "Something went wrong.", requestId } },
    500,
  );
}

export function json<T>(body: T, status = 200, headers?: Record<string, string>): Response {
  return NextResponse.json(body, { status, headers });
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  return schema.parse(raw);
}

/** Best-effort client IP for audit logs and rate limiting. */
export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
