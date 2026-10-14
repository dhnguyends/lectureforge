import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.SERVICE_NAME ?? "lectureforge-web" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.passwordHash",
      "*.apiKey",
      "*.token",
    ],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;
