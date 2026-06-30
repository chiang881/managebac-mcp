import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ManageBacConfig } from "./config.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const startedAt = new Date().toISOString();

interface PackageJson {
  version?: string;
}

export interface RuntimeInfo {
  name: string;
  version: string;
  build: string;
  pid: number;
  startedAt: string;
  node: string;
  cwd: string;
  packageRoot: string;
  baseUrl: string;
  loginMode: ManageBacConfig["loginMode"];
  storageStatePath: string;
  storageStateExists: boolean;
}

export function getRuntimeInfo(config: ManageBacConfig): RuntimeInfo {
  return {
    name: "managebac-mcp",
    version: packageVersion(),
    build: buildHash(),
    pid: process.pid,
    startedAt,
    node: process.version,
    cwd: process.cwd(),
    packageRoot,
    baseUrl: config.baseUrl,
    loginMode: config.loginMode,
    storageStatePath: config.storageStatePath,
    storageStateExists: fs.existsSync(config.storageStatePath),
  };
}

export function runtimeBanner(config: ManageBacConfig): string {
  const info = getRuntimeInfo(config);
  return [
    "managebac-mcp startup",
    `version=${info.version}`,
    `build=${info.build}`,
    `pid=${info.pid}`,
    `startedAt=${info.startedAt}`,
    `mode=${info.loginMode}`,
    `baseUrl=${info.baseUrl}`,
    `storageState=${info.storageStateExists ? "present" : "missing"}`,
    `storageStatePath=${info.storageStatePath}`,
    `cwd=${info.cwd}`,
  ].join(" ");
}

function packageVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(packageRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as PackageJson;
    return parsed.version || "unknown";
  } catch {
    return "unknown";
  }
}

function buildHash(): string {
  if (process.env.MANAGEBAC_BUILD_SHA?.trim()) {
    return process.env.MANAGEBAC_BUILD_SHA.trim();
  }

  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}
