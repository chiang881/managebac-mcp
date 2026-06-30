import fs from "node:fs/promises";
import path from "node:path";
import { Browser, BrowserContext, Locator, Page, chromium } from "playwright";
import { ManageBacConfig, requireCredentials } from "./config.js";
import { LinkSummary, PageSnapshot } from "./types.js";

export class ManageBacWebClient {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;

  constructor(private readonly config: ManageBacConfig) {}

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = undefined;
    this.browser = undefined;
    this.page = undefined;
  }

  urlFor(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return pathOrUrl;
    }

    return new URL(pathOrUrl || "/", `${this.config.baseUrl}/`).toString();
  }

  async ensureLoggedIn(): Promise<Page> {
    const page = await this.ensurePage();
    if (await this.appearsLoggedIn(page)) {
      return page;
    }

    await this.login(page);
    return page;
  }

  async goto(pathOrUrl: string, options: { requireAuth?: boolean } = {}): Promise<Page> {
    const requireAuth = options.requireAuth ?? true;
    const page = requireAuth ? await this.ensureLoggedIn() : await this.ensurePage();
    await page.goto(this.urlFor(pathOrUrl), {
      waitUntil: "domcontentloaded",
      timeout: this.config.timeoutMs,
    });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

    if (requireAuth && (await this.hasPasswordField(page))) {
      await this.login(page);
      await page.goto(this.urlFor(pathOrUrl), {
        waitUntil: "domcontentloaded",
        timeout: this.config.timeoutMs,
      });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    }

    return page;
  }

  async snapshot(pathOrUrl = "/"): Promise<PageSnapshot> {
    const page = await this.goto(pathOrUrl);
    return this.snapshotCurrentPage(page);
  }

  async snapshotCurrentPage(page: Page): Promise<PageSnapshot> {
    const [title, url, text, links] = await Promise.all([
      page.title().catch(() => ""),
      Promise.resolve(page.url()),
      page.locator("body").innerText({ timeout: 5_000 }).catch(() => ""),
      this.readLinks(page),
    ]);

    return { title, url, text: normalizeText(text), links };
  }

  private async ensurePage(): Promise<Page> {
    if (this.page) {
      return this.page;
    }

    this.browser = await chromium.launch({
      headless: this.config.headless,
      timeout: this.config.timeoutMs,
    });

    const storageState = await fileExists(this.config.storageStatePath)
      ? this.config.storageStatePath
      : undefined;

    this.context = await this.browser.newContext({
      storageState,
      viewport: { width: 1440, height: 1000 },
    });
    this.page = await this.context.newPage();
    return this.page;
  }

  private async appearsLoggedIn(page: Page): Promise<boolean> {
    if (page.url() === "about:blank") {
      await page.goto(this.urlFor("/"), {
        waitUntil: "domcontentloaded",
        timeout: this.config.timeoutMs,
      });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    }

    if (await this.hasPasswordField(page)) {
      return false;
    }

    const url = page.url();
    return !/\/login\b|\/sessions\b/i.test(url);
  }

  private async login(page: Page): Promise<void> {
    if (this.config.loginMode !== "password") {
      throw new Error(manualSessionError(this.config.storageStatePath));
    }

    requireCredentials(this.config);
    await this.assertLoginAttemptAllowed();

    await page.goto(this.urlFor("/login"), {
      waitUntil: "domcontentloaded",
      timeout: this.config.timeoutMs,
    });
    await page.locator("#session_form").waitFor({ state: "visible", timeout: this.config.timeoutMs });

    const loginInput = page.locator("#session_login, input[name='login'], input[type='email']").first();
    const passwordInput = page.locator("#session_password, input[name='password'], input[type='password']").first();

    await loginInput.fill(this.config.email ?? "", { timeout: this.config.timeoutMs });
    await passwordInput.fill(this.config.password ?? "", { timeout: this.config.timeoutMs });
    await this.assertFilledValue(loginInput, this.config.email ?? "", "login");
    await this.assertFilledValue(passwordInput, this.config.password ?? "", "password");

    const rememberMe = page.locator('input[name="remember_me"][type="checkbox"]').first();
    if ((await rememberMe.count()) > 0) {
      await rememberMe.check().catch(() => undefined);
    }

    await page.locator('#session_form input[type="submit"], #session_form button[type="submit"]').first().click({
      timeout: this.config.timeoutMs,
    });

    await page
      .waitForURL((url) => !/\/login\b|\/sessions\b/i.test(url.pathname), {
        timeout: this.config.timeoutMs,
      })
      .catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

    if ((await this.hasPasswordField(page)) || /\/login\b|\/sessions\b/i.test(new URL(page.url()).pathname)) {
      const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      const message = firstMatchingLine(bodyText, [/invalid/i, /incorrect/i, /locked/i, /required/i]);
      const errorMessage = passwordLoginError(message);
      await this.recordLoginFailure(errorMessage, page);
      throw new Error(errorMessage);
    }

    await fs.mkdir(path.dirname(this.config.storageStatePath), { recursive: true });
    await this.context?.storageState({ path: this.config.storageStatePath });
    await this.clearLoginFailure();
  }

  private async hasPasswordField(page: Page): Promise<boolean> {
    return (await page.locator('input[name="password"], input[type="password"]').count()) > 0;
  }

  private async readLinks(page: Page): Promise<LinkSummary[]> {
    return page.$$eval("a[href]", (anchors) => {
      const seen = new Set<string>();
      const result: LinkSummary[] = [];

      for (const anchor of anchors) {
        const href = (anchor as HTMLAnchorElement).href;
        const text = (anchor.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!href || !text) {
          continue;
        }

        const key = `${text}\n${href}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        result.push({ text, href });
      }

      return result.slice(0, 300);
    });
  }

  private async assertFilledValue(locator: Locator, expected: string, label: string): Promise<void> {
    const actual = await locator.inputValue({ timeout: this.config.timeoutMs });
    if (actual !== expected) {
      throw new Error(`ManageBac ${label} field was not filled correctly before submit.`);
    }
  }

  private async assertLoginAttemptAllowed(): Promise<void> {
    if (this.config.forceLogin) {
      return;
    }

    const previousFailure = await this.readLoginFailure();
    if (!previousFailure) {
      return;
    }

    const elapsed = Date.now() - previousFailure.at;
    if (elapsed < this.config.loginCooldownMs) {
      const remainingMinutes = Math.ceil((this.config.loginCooldownMs - elapsed) / 60_000);
      throw new Error(
        `MANAGEBAC_LOGIN_COOLDOWN: Skipping automatic password login because the previous login failed recently: ${previousFailure.message}. Wait about ${remainingMinutes} minute(s), set MANAGEBAC_LOGIN_FORCE=true after confirming credentials in a browser, or switch to MANAGEBAC_LOGIN_MODE=manual and run \`npm run login\`.`,
      );
    }
  }

  private async recordLoginFailure(message: string, page: Page): Promise<void> {
    await fs.mkdir(path.dirname(this.config.loginFailurePath), { recursive: true });
    await fs.writeFile(
      this.config.loginFailurePath,
      JSON.stringify(
        {
          at: Date.now(),
          message,
          url: page.url(),
          title: await page.title().catch(() => ""),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }

  private async clearLoginFailure(): Promise<void> {
    await fs.rm(this.config.loginFailurePath, { force: true }).catch(() => undefined);
  }

  private async readLoginFailure(): Promise<{ at: number; message: string } | undefined> {
    try {
      const raw = await fs.readFile(this.config.loginFailurePath, "utf8");
      const parsed = JSON.parse(raw) as { at?: unknown; message?: unknown };
      if (typeof parsed.at === "number" && typeof parsed.message === "string") {
        return { at: parsed.at, message: parsed.message };
      }
      return undefined;
    } catch {
      return undefined;
    }
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

function firstMatchingLine(text: string, patterns: RegExp[]): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .find((line) => patterns.some((pattern) => pattern.test(line)));
}

function normalizeText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function manualSessionError(storageStatePath: string): string {
  return [
    "MANAGEBAC_SESSION_REQUIRED: ManageBac manual login is enabled, but the saved browser session is missing or expired.",
    "Run `npm run login` from this project to open a browser and save a fresh session.",
    `Storage state path: ${storageStatePath}.`,
    "After login, restart or reconnect the MCP client so it binds a fresh server process.",
    "If you intentionally want automatic password login, set MANAGEBAC_LOGIN_MODE=password with MANAGEBAC_EMAIL and MANAGEBAC_PASSWORD.",
  ].join(" ");
}

function passwordLoginError(upstreamMessage: string | undefined): string {
  const details = upstreamMessage ? ` ManageBac said: ${upstreamMessage}.` : "";
  return [
    `MANAGEBAC_AUTH_REJECTED: ManageBac rejected direct email/password login.${details}`,
    "This usually means the password is wrong or changed, the account is locked, or the account requires SSO/Google/Microsoft login.",
    "Recommended fix: set MANAGEBAC_LOGIN_MODE=manual, run `npm run login`, then restart or reconnect the MCP client.",
  ].join(" ");
}
