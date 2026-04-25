import { mkdirSync, createWriteStream, type WriteStream } from "node:fs";
import path from "node:path";

import type { LogLevel } from "../core/types.js";

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

type LogContext = Record<string, unknown>;

export interface AppLogger {
  child(bindings: LogContext): AppLogger;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

class FileConsoleLogger implements AppLogger {
  constructor(
    private readonly stream: WriteStream,
    private readonly minLevel: LogLevel,
    private readonly bindings: LogContext = {}
  ) {}

  child(bindings: LogContext): AppLogger {
    return new FileConsoleLogger(this.stream, this.minLevel, {
      ...this.bindings,
      ...bindings
    });
  }

  debug(message: string, context: LogContext = {}): void {
    this.log("debug", message, context);
  }

  info(message: string, context: LogContext = {}): void {
    this.log("info", message, context);
  }

  warn(message: string, context: LogContext = {}): void {
    this.log("warn", message, context);
  }

  error(message: string, context: LogContext = {}): void {
    this.log("error", message, context);
  }

  private log(level: LogLevel, message: string, context: LogContext): void {
    if (levelWeight[level] < levelWeight[this.minLevel]) {
      return;
    }

    const record = {
      time: new Date().toISOString(),
      level,
      message,
      ...this.bindings,
      ...context
    };

    const line = JSON.stringify(record);
    this.stream.write(`${line}\n`);

    const consoleLine = `[${record.time}] ${level.toUpperCase()} ${message}`;
    const details = { ...this.bindings, ...context };

    if (Object.keys(details).length === 0) {
      console.log(consoleLine);
      return;
    }

    console.log(consoleLine, details);
  }
}

export function createLogger(logsDir: string, level: LogLevel): AppLogger {
  mkdirSync(logsDir, { recursive: true });

  const filePath = path.join(
    logsDir,
    `banner-docente-${new Date().toISOString().replaceAll(":", "-")}.log`
  );

  const stream = createWriteStream(filePath, {
    flags: "a",
    encoding: "utf8"
  });

  return new FileConsoleLogger(stream, level);
}
