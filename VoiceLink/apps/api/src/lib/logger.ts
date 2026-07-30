import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "*.password", "*.token"],
});

export const createLogger = (name: string) => logger.child({ name });
