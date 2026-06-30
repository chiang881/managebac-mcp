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

  try {
    const context = await browser.newContext({
      storageState: await fileExists(config.storageStatePath) ? config.storageStatePath : undefined,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();

    console.log("Opening ManageBac. Log in manually in the browser window.");
    console.log("This script saves the browser session and exits as soon as login is detected.");

    await page.goto(new URL("/login", `${config.baseUrl}/`).toString(), {
      waitUntil: "domcontentloaded",
      timeout: config.timeoutMs,
    });

    await waitForManualLogin(page);
    await saveSession(context, config.storageStatePath, config.loginFailurePath);
    console.log(`Saved ManageBac browser session to ${config.storageStatePath}`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForManualLogin(page: import("playwright").Page): Promise<void> {
  const deadline = Date.now() + 5 * 60 * 1000;

  while (Date.now() < deadline) {
    if (isAuthenticatedUrl(page.url()) && !(await hasPasswordField(page))) {
      return;
    }

    await page.waitForTimeout(250);
  }

  throw new Error("Timed out waiting for manual ManageBac login.");
}

async function saveSession(
  context: import("playwright").BrowserContext,
  storageStatePath: string,
  loginFailurePath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
  await context.storageState({ path: storageStatePath });
  await fs.rm(loginFailurePath, { force: true }).catch(() => undefined);
}

async function hasPasswordField(page: import("playwright").Page): Promise<boolean> {
  return (await page.locator('input[name="password"], input[type="password"]').count()) > 0;
}

function isAuthenticatedUrl(value: string): boolean {
  if (value === "about:blank") {
    return false;
  }

  const url = new URL(value);
  return !/\/login\b|\/sessions\b/i.test(url.pathname);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
