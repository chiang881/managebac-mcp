import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface ManageBacConfig {
  baseUrl: string;
  loginMode: "manual" | "password";
  email?: string;
  password?: string;
  headless: boolean;
  timeoutMs: number;
  loginCooldownMs: number;
  forceLogin: boolean;
  storageStatePath: string;
  debugDir: string;
  loginFailurePath: string;
}

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loginModeFromEnv(value: string | undefined): "manual" | "password" {
  const normalized = (value || "manual").trim().toLowerCase();
  if (normalized === "manual" || normalized === "password") {
    return normalized;
  }

  throw new Error("Invalid MANAGEBAC_LOGIN_MODE. Use `manual` or `password`.");
}

function absoluteFromPackageRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(packageRoot, value);
}

function normalizeBaseUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withScheme);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function loadConfig(): ManageBacConfig {
  const baseUrl = normalizeBaseUrl(process.env.MANAGEBAC_BASE_URL);
  if (!baseUrl) {
    throw new Error(
      "Missing MANAGEBAC_BASE_URL. Run `npm run configure`, copy .env.example to .env, or pass it in the MCP server env.",
    );
  }

  return {
    baseUrl,
    loginMode: loginModeFromEnv(process.env.MANAGEBAC_LOGIN_MODE),
    email: process.env.MANAGEBAC_EMAIL?.trim(),
    password: process.env.MANAGEBAC_PASSWORD,
    headless: boolFromEnv(process.env.MANAGEBAC_HEADLESS, true),
    timeoutMs: intFromEnv(process.env.MANAGEBAC_TIMEOUT_MS, 30_000),
    loginCooldownMs: intFromEnv(process.env.MANAGEBAC_LOGIN_COOLDOWN_MS, 15 * 60 * 1000),
    forceLogin: boolFromEnv(process.env.MANAGEBAC_LOGIN_FORCE, false),
    storageStatePath: absoluteFromPackageRoot(
      process.env.MANAGEBAC_STORAGE_STATE || ".managebac/storage-state.json",
    ),
    debugDir: absoluteFromPackageRoot(process.env.MANAGEBAC_DEBUG_DIR || ".managebac/debug"),
    loginFailurePath: absoluteFromPackageRoot(".managebac/login-failure.json"),
  };
}

export function requireCredentials(config: ManageBacConfig): void {
  if (!config.email || !config.password) {
    throw new Error(
      "Missing MANAGEBAC_EMAIL or MANAGEBAC_PASSWORD. Run `npm run configure`, copy .env.example to .env, or pass them in the MCP server env.",
    );
  }
}
