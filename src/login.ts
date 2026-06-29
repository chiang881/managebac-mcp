#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const browser = await chromium.launch({
    headless: false,
    timeout: config.timeoutMs,
  });

  const context = await browser.newContext({
    storageState: await fileExists(config.storageStatePath) ? config.storageStatePath : undefined,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  console.log("Opening ManageBac. Log in manually in the browser window.");
  console.log("This script will save the browser session after the page leaves /login or /sessions.");

  await page.goto(new URL("/login", `${config.baseUrl}/`).toString(), {
    waitUntil: "domcontentloaded",
    timeout: config.timeoutMs,
  });

  await page.waitForURL((url) => !/\/login\b|\/sessions\b/i.test(url.pathname), {
    timeout: 5 * 60 * 1000,
  });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

  await fs.mkdir(path.dirname(config.storageStatePath), { recursive: true });
  await context.storageState({ path: config.storageStatePath });
  await fs.rm(config.loginFailurePath, { force: true }).catch(() => undefined);

  console.log(`Saved ManageBac browser session to ${config.storageStatePath}`);
  await browser.close();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
