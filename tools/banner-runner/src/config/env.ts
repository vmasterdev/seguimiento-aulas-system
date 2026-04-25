import "dotenv/config";

import path from "node:path";

import { z } from "zod";

import type { LogLevel } from "../core/types.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("file:./banner-docente.db"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  STORAGE_ROOT: z.string().default("storage"),
  LOGS_DIR: z.string().default("storage/logs"),
  EVIDENCE_DIR: z.string().default("storage/evidence"),
  EXPORTS_DIR: z.string().default("storage/exports"),
  AUTH_DIR: z.string().default("storage/auth"),
  BANNER_BASE_URL: z.string().url().default("https://example.org"),
  BANNER_LOGIN_URL: z.string().url().default("https://example.org/login"),
  BANNER_SEARCH_URL: z.string().url().default("https://example.org/search"),
  BANNER_USERNAME: z.string().optional().default(""),
  BANNER_PASSWORD: z.string().optional().default(""),
  BANNER_PROFILE_PATH: z.string().default("./config/banner.profile.json"),
  BANNER_STORAGE_STATE_PATH: z.string().default("storage/auth/banner-storage-state.json"),
  BANNER_BROWSER_PROFILE_DIR: z.string().default("storage/auth/edge-profile"),
  BANNER_BROWSER_CHANNEL: z.string().optional().default("msedge"),
  BANNER_REMOTE_DEBUGGING_URL: z.string().optional().default(""),
  BANNER_LOOKUP_ENGINE: z.enum(["ui", "backend"]).default("backend"),
  BANNER_HEADLESS: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  BANNER_SLOW_MO_MS: z.coerce.number().int().min(0).default(0),
  BANNER_NAVIGATION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  BANNER_ACTION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),
  BANNER_RETRY_ATTEMPTS: z.coerce.number().int().min(0).default(2),
  BANNER_BATCH_WORKERS: z.coerce.number().int().min(1).max(10).default(1)
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  database: {
    url: string;
  };
  logging: {
    level: LogLevel;
    logsDir: string;
  };
  storage: {
    root: string;
    evidenceDir: string;
    exportsDir: string;
    authDir: string;
  };
  banner: {
    baseUrl: string;
    loginUrl: string;
    searchUrl: string;
    username: string;
    password: string;
    profilePath: string;
    storageStatePath: string;
    browserProfileDir: string;
    browserChannel: string;
    remoteDebuggingUrl: string;
    lookupEngine: "ui" | "backend";
    headless: boolean;
    slowMoMs: number;
    navigationTimeoutMs: number;
    actionTimeoutMs: number;
    retryAttempts: number;
    batchWorkers: number;
  };
}

let cachedConfig: AppConfig | null = null;

function resolvePath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.resolve(process.cwd(), filePath);
}

export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const parsed = envSchema.parse(process.env);

  cachedConfig = {
    nodeEnv: parsed.NODE_ENV,
    database: {
      url: parsed.DATABASE_URL
    },
    logging: {
      level: parsed.LOG_LEVEL,
      logsDir: resolvePath(parsed.LOGS_DIR)
    },
    storage: {
      root: resolvePath(parsed.STORAGE_ROOT),
      evidenceDir: resolvePath(parsed.EVIDENCE_DIR),
      exportsDir: resolvePath(parsed.EXPORTS_DIR),
      authDir: resolvePath(parsed.AUTH_DIR)
    },
    banner: {
      baseUrl: parsed.BANNER_BASE_URL,
      loginUrl: parsed.BANNER_LOGIN_URL,
      searchUrl: parsed.BANNER_SEARCH_URL,
      username: parsed.BANNER_USERNAME,
      password: parsed.BANNER_PASSWORD,
      profilePath: resolvePath(parsed.BANNER_PROFILE_PATH),
      storageStatePath: resolvePath(parsed.BANNER_STORAGE_STATE_PATH),
      browserProfileDir: resolvePath(parsed.BANNER_BROWSER_PROFILE_DIR),
      browserChannel: parsed.BANNER_BROWSER_CHANNEL,
      remoteDebuggingUrl: parsed.BANNER_REMOTE_DEBUGGING_URL,
      lookupEngine: parsed.BANNER_LOOKUP_ENGINE,
      headless: parsed.BANNER_HEADLESS,
      slowMoMs: parsed.BANNER_SLOW_MO_MS,
      navigationTimeoutMs: parsed.BANNER_NAVIGATION_TIMEOUT_MS,
      actionTimeoutMs: parsed.BANNER_ACTION_TIMEOUT_MS,
      retryAttempts: parsed.BANNER_RETRY_ATTEMPTS,
      batchWorkers: parsed.BANNER_BATCH_WORKERS
    }
  };

  return cachedConfig;
}
