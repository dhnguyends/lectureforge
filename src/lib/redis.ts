import { Redis, type RedisOptions } from "ioredis";
import { env } from "./env";

const globalForRedis = globalThis as unknown as { redis?: Redis };

/** Shared connection for rate limiting and queue producers. */
export function redis(): Redis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = createRedis();
  }
  return globalForRedis.redis;
}

/**
 * BullMQ workers need their own blocking connection with
 * `maxRetriesPerRequest: null`; producers can share one.
 */
export function createRedis(opts: RedisOptions = {}): Redis {
  return new Redis(env().REDIS_URL, { maxRetriesPerRequest: null, ...opts });
}
