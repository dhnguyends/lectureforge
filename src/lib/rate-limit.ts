import { tooManyRequests } from "./errors";
import { redis } from "./redis";

export type RateLimitRule = { limit: number; windowSeconds: number };

/** Limits for expensive or abuse-prone endpoints. */
export const RATE_LIMITS = {
  createSource: { limit: 60, windowSeconds: 3600 },
  createStudySet: { limit: 30, windowSeconds: 3600 },
  generation: { limit: 20, windowSeconds: 3600 },
  tutorMessage: { limit: 120, windowSeconds: 3600 },
  // AI grading of free-text quiz answers.
  quizJudge: { limit: 200, windowSeconds: 3600 },
  register: { limit: 10, windowSeconds: 3600 },
  // Site access password: slows down guessing without bothering a real visitor.
  access: { limit: 10, windowSeconds: 900 },
} satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counter in Redis. Throws a 429 HttpError when exceeded.
 * Fails open if Redis is unreachable so an outage does not lock users out;
 * the queue itself still bounds expensive work.
 */
export async function enforceRateLimit(bucket: keyof typeof RATE_LIMITS, subject: string): Promise<void> {
  const rule = RATE_LIMITS[bucket];
  const window = Math.floor(Date.now() / 1000 / rule.windowSeconds);
  const key = `rl:${bucket}:${subject}:${window}`;
  let count: number;
  try {
    const r = redis();
    count = await r.incr(key);
    if (count === 1) await r.expire(key, rule.windowSeconds);
  } catch {
    return;
  }
  if (count > rule.limit) {
    const resetAt = (window + 1) * rule.windowSeconds;
    throw tooManyRequests(Math.max(1, resetAt - Math.floor(Date.now() / 1000)));
  }
}
