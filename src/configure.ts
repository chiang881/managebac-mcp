#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env");
const defaults = {
  MANAGEBAC_HEADLESS: "true",
  MANAGEBAC_TIMEOUT_MS: "30000",
  MANAGEBAC_STORAGE_STATE: ".managebac/storage-state.json",
  MANAGEBAC_DEBUG_DIR: ".managebac/debug",
};

async function main(): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Interactive terminal required. Set MANAGEBAC_BASE_URL, MANAGEBAC_EMAIL, and MANAGEBAC_PASSWORD manually in non-interactive deployments.");
  }

  const existing = await readExistingEnv();
  const rl = createInterface({ input, output });

  try {
    const baseUrl = await ask(rl, "ManageBac instance URL, e.g. https://school.managebac.com", existing.MANAGEBAC_BASE_URL || "");
    const email = await ask(rl, "ManageBac account/email", existing.MANAGEBAC_EMAIL || "");
    const previousPassword = existing.MANAGEBAC_PASSWORD || "";
    const password = await askHidden(
      previousPassword ? "ManageBac password [press Enter to keep existing]" : "ManageBac password",
    );

    if (!baseUrl.trim()) {
      throw new Error("ManageBac instance URL is required.");
    }
    if (!email.trim()) {
      throw new Error("ManageBac account/email is required.");
    }
    if (!password.trim() && !previousPassword) {
      throw new Error("ManageBac password is required.");
    }

    const nextEnv: Record<string, string> = {
      ...defaults,
      ...existing,
      MANAGEBAC_BASE_URL: normalizeBaseUrl(baseUrl),
      MANAGEBAC_EMAIL: email.trim(),
      MANAGEBAC_PASSWORD: password || previousPassword,
    };

    await writeEnv(nextEnv);
    console.log(`Saved ManageBac configuration to ${envPath}`);
  } finally {
    rl.close();
  }
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
    "MANAGEBAC_EMAIL",
    "MANAGEBAC_PASSWORD",
    "MANAGEBAC_HEADLESS",
    "MANAGEBAC_TIMEOUT_MS",
    "MANAGEBAC_STORAGE_STATE",
    "MANAGEBAC_DEBUG_DIR",
  ];
  const keys = [...preferredOrder, ...Object.keys(values).filter((key) => !preferredOrder.includes(key))];
  const content = `${keys.map((key) => `${key}=${quoteEnv(values[key] ?? "")}`).join("\n")}\n`;

  await fs.writeFile(envPath, content, { mode: 0o600 });
  await fs.chmod(envPath, 0o600);
}

function quoteEnv(value: string): string {
  if (/^[A-Za-z0-9_./:@%+-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
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
