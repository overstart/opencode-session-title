// opencode-session-title: winston logger factory
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface LoggerOptions {
  debug: boolean;
  logDir?: string;
}

export function createLogger(opts: LoggerOptions): winston.Logger {
  const logDir = opts.logDir || join(process.cwd(), ".opencode", "logs");

  // ponytail: sync mkdir is fine here — called once at plugin init
  mkdirSync(logDir, { recursive: true });

  const transport = new DailyRotateFile({
    filename: join(logDir, "opencode-session-title-%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    maxFiles: "7d",
    format: winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
      winston.format.json(),
    ),
  });

  return winston.createLogger({
    level: opts.debug ? "debug" : "info",
    transports: [transport],
  });
}
