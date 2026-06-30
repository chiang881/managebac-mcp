#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import dotenv from "dotenv";

type LoginMode = "manual" | "password";

const envPath = path.resolve(process.cwd(), ".env");
const defaults = {
  MANAGEBAC_LOGIN_MODE: "manual",
  MANAGEBAC_HEADLESS: "true",
  MANAGEBAC_TIMEOUT_MS: "30000",
  MANAGEBAC_LOGIN_COOLDOWN_MS: "900000",
  MANAGEBAC_LOGIN_FORCE: "false",
  MANAGEBAC_STORAGE_STATE: ".managebac/storage-state.json",
  MANAGEBAC_DEBUG_DIR: ".managebac/debug",
};

interface CliOptions {
  help?: boolean;
  baseUrl?: string;
  loginMode?: string;
  email?: string;
  password?: string;
  headless?: string;
  timeoutMs?: string;
  loginCooldownMs?: string;
  loginForce?: string;
  storageState?: string;
  debugDir?: string;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    printUsage();
    return;
  }

  const existing = await readExistingEnv();
  const tty = Boolean(input.isTTY && output.isTTY);

  if (!tty) {
    await writeNonInteractiveEnv(existing, cli);
    return;
  }

  await writeInteractiveEnv(existing, cli);
}

async function writeNonInteractiveEnv(existing: Record<string, string>, cli: CliOptions): Promise<void> {
  const baseUrl = firstValue(cli.baseUrl, process.env.MANAGEBAC_BASE_URL, existing.MANAGEBAC_BASE_URL);
  const loginMode = normalizeLoginMode(
    firstValue(cli.loginMode, process.env.MANAGEBAC_LOGIN_MODE, existing.MANAGEBAC_LOGIN_MODE, defaults.MANAGEBAC_LOGIN_MODE),
  );

  if (!baseUrl) {
    throw new Error(
      "Missing ManageBac instance URL for non-interactive configure. Example: npm run configure -- --base-url=https://your-school.managebac.com --mode=manual",
    );
  }

  const nextEnv = buildEnv(existing, cli, normalizeBaseUrl(baseUrl), loginMode);

  if (loginMode === "password") {
    const email = firstValue(cli.email, process.env.MANAGEBAC_EMAIL, existing.MANAGEBAC_EMAIL);
    const password = firstValue(cli.password, process.env.MANAGEBAC_PASSWORD, existing.MANAGEBAC_PASSWORD);
    if (!email || !password) {
      throw new Error(
        "Password login mode requires MANAGEBAC_EMAIL and MANAGEBAC_PASSWORD, or --email and --password. Prefer --mode=manual when using browser login.",
      );
    }

    nextEnv.MANAGEBAC_EMAIL = email.trim();
    nextEnv.MANAGEBAC_PASSWORD = password;
  }

  await writeEnv(nextEnv);
  printSaved(loginMode);
}

async function writeInteractiveEnv(existing: Record<string, string>, cli: CliOptions): Promise<void> {
  const rl = createInterface({ input, output });

  try {
    const baseUrl =
      cli.baseUrl ||
      (await ask(rl, "ManageBac instance URL, e.g. https://school.managebac.com", existing.MANAGEBAC_BASE_URL || ""));
    const loginMode = normalizeLoginMode(
      cli.loginMode ||
        (await ask(rl, "Login mode: manual or password", existing.MANAGEBAC_LOGIN_MODE || defaults.MANAGEBAC_LOGIN_MODE)),
    );

    if (!baseUrl.trim()) {
      throw new Error("ManageBac instance URL is required.");
    }

    const nextEnv = buildEnv(existing, cli, normalizeBaseUrl(baseUrl), loginMode);

    if (loginMode === "password") {
      const email = cli.email || (await ask(rl, "ManageBac account/email", existing.MANAGEBAC_EMAIL || ""));
      const previousPassword = existing.MANAGEBAC_PASSWORD || "";
      const password =
        cli.password ||
        (await askHidden(previousPassword ? "ManageBac password [press Enter to keep existing]" : "ManageBac password"));

      if (!email.trim()) {
        throw new Error("ManageBac account/email is required for password login mode.");
      }
      if (!password.trim() && !previousPassword) {
        throw new Error("ManageBac password is required for password login mode.");
      }

      nextEnv.MANAGEBAC_EMAIL = email.trim();
      nextEnv.MANAGEBAC_PASSWORD = password || previousPassword;
    }

    await writeEnv(nextEnv);
    printSaved(loginMode);
  } finally {
    rl.close();
  }
}

function buildEnv(
  existing: Record<string, string>,
  cli: CliOptions,
  baseUrl: string,
  loginMode: LoginMode,
): Record<string, string> {
  const nextEnv: Record<string, string> = {
    ...defaults,
    ...existing,
    MANAGEBAC_BASE_URL: baseUrl,
    MANAGEBAC_LOGIN_MODE: loginMode,
    MANAGEBAC_HEADLESS: firstValue(cli.headless, process.env.MANAGEBAC_HEADLESS, existing.MANAGEBAC_HEADLESS, defaults.MANAGEBAC_HEADLESS),
    MANAGEBAC_TIMEOUT_MS: firstValue(
      cli.timeoutMs,
      process.env.MANAGEBAC_TIMEOUT_MS,
      existing.MANAGEBAC_TIMEOUT_MS,
      defaults.MANAGEBAC_TIMEOUT_MS,
    ),
    MANAGEBAC_LOGIN_COOLDOWN_MS: firstValue(
      cli.loginCooldownMs,
      process.env.MANAGEBAC_LOGIN_COOLDOWN_MS,
      existing.MANAGEBAC_LOGIN_COOLDOWN_MS,
      defaults.MANAGEBAC_LOGIN_COOLDOWN_MS,
    ),
    MANAGEBAC_LOGIN_FORCE: firstValue(
      cli.loginForce,
      process.env.MANAGEBAC_LOGIN_FORCE,
      existing.MANAGEBAC_LOGIN_FORCE,
      defaults.MANAGEBAC_LOGIN_FORCE,
    ),
    MANAGEBAC_STORAGE_STATE: firstValue(
      cli.storageState,
      process.env.MANAGEBAC_STORAGE_STATE,
      existing.MANAGEBAC_STORAGE_STATE,
      defaults.MANAGEBAC_STORAGE_STATE,
    ),
    MANAGEBAC_DEBUG_DIR: firstValue(cli.debugDir, process.env.MANAGEBAC_DEBUG_DIR, existing.MANAGEBAC_DEBUG_DIR, defaults.MANAGEBAC_DEBUG_DIR),
  };

  if (loginMode === "manual") {
    delete nextEnv.MANAGEBAC_EMAIL;
    delete nextEnv.MANAGEBAC_PASSWORD;
  }

  return nextEnv;
}

async function readExistingEnv(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(envPath, "utf8");
    return dotenv.parse(raw);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function ask(rl: ReturnType<typeof createInterface>, label: string, defaultValue: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${label}${suffix}: `);
  return answer.trim() || defaultValue;
}

async function askHidden(label: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let value = "";

    output.write(`${label}: `);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (char: string) => {
      if (char === "\u0003") {
        cleanup();
        process.kill(process.pid, "SIGINT");
        return;
      }

      if (char === "\r" || char === "\n") {
        output.write("\n");
        cleanup();
        resolve(value);
        return;
      }

      if (char === "\u007f") {
        value = value.slice(0, -1);
        return;
      }

      value += char;
    };

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };

    stdin.on("data", onData);
  });
}

async function writeEnv(values: Record<string, string>): Promise<void> {
  const preferredOrder = [
    "MANAGEBAC_BASE_URL",
    "MANAGEBAC_LOGIN_MODE",
    "MANAGEBAC_EMAIL",
    "MANAGEBAC_PASSWORD",
    "MANAGEBAC_HEADLESS",
    "MANAGEBAC_TIMEOUT_MS",
    "MANAGEBAC_LOGIN_COOLDOWN_MS",
    "MANAGEBAC_LOGIN_FORCE",
    "MANAGEBAC_STORAGE_STATE",
    "MANAGEBAC_DEBUG_DIR",
  ];
  const keys = [...preferredOrder, ...Object.keys(values).filter((key) => !preferredOrder.includes(key))].filter(
    (key, index, all) => values[key] !== undefined && all.indexOf(key) === index,
  );
  const content = `${keys.map((key) => `${key}=${quoteEnv(values[key] ?? "")}`).join("\n")}\n`;

  await fs.writeFile(envPath, content, { mode: 0o600 });
  await fs.chmod(envPath, 0o600);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = normalizeArgKey(rawKey);
    const value = inlineValue ?? args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${rawKey}`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }

    setCliOption(options, key, value);
  }

  return options;
}

function setCliOption(options: CliOptions, key: string, value: string): void {
  switch (key) {
    case "baseUrl":
      options.baseUrl = value;
      break;
    case "mode":
    case "loginMode":
      options.loginMode = value;
      break;
    case "email":
      options.email = value;
      break;
    case "password":
      options.password = value;
      break;
    case "headless":
      options.headless = value;
      break;
    case "timeoutMs":
      options.timeoutMs = value;
      break;
    case "loginCooldownMs":
      options.loginCooldownMs = value;
      break;
    case "loginForce":
      options.loginForce = value;
      break;
    case "storageState":
      options.storageState = value;
      break;
    case "debugDir":
      options.debugDir = value;
      break;
    default:
      throw new Error(`Unknown option: --${key}`);
  }
}

function normalizeArgKey(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function printUsage(): void {
  console.log(`Usage:
  npm run configure
  npm run configure -- --base-url=https://your-school.managebac.com --mode=manual
  npm run configure -- --base-url=https://your-school.managebac.com --mode=password --email=you@example.com --password=secret

Options:
  --base-url            ManageBac instance URL
  --mode, --login-mode  manual or password
  --email               Email for password login mode
  --password            Password for password login mode
  --storage-state       Browser session file path
  --headless            true or false
  --timeout-ms          Playwright timeout in milliseconds
  --login-cooldown-ms   Cooldown after failed password login
  --login-force         true or false
  --debug-dir           Debug output directory`);
}

function printSaved(loginMode: LoginMode): void {
  console.log(`Saved ManageBac configuration to ${envPath}`);
  if (loginMode === "manual") {
    console.log("Next step: run `npm run login` to open a browser and save the ManageBac session.");
    console.log("After login, restart or reconnect your MCP client so it binds a fresh server process.");
  }
}

function firstValue(...values: Array<string | undefined>): string {
  return values.find((value) => value !== undefined && value.trim() !== "") ?? "";
}

function quoteEnv(value: string): string {
  if (/^[A-Za-z0-9_./:@%+-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function normalizeLoginMode(raw: string): LoginMode {
  const value = raw.trim().toLowerCase();
  if (value === "manual" || value === "password") {
    return value;
  }

  throw new Error("Login mode must be `manual` or `password`.");
}

function normalizeBaseUrl(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const url = new URL(withScheme);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
