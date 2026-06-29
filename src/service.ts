import { ManageBacWebClient } from "./managebacWebClient.js";
import {
  computeGpaSummary,
  dedupeDeadlines,
  dedupeGrades,
  extractRawItems,
  toDeadlineItems,
  toGradeItems,
} from "./extractors.js";
import { DeadlineItem, GpaSummary, GradeItem, LinkSummary, PageSnapshot } from "./types.js";

type DiscoveryKind = "deadline" | "grade";

interface DiscoveryResult {
  snapshots: PageSnapshot[];
  errors: Array<{ path: string; message: string }>;
}

interface DeadlineOptions {
  daysAhead: number;
  includeCompleted: boolean;
  maxItems: number;
  path?: string;
}

interface GradeOptions {
  maxItems: number;
  path?: string;
}

const DEADLINE_SEEDS = [
  "/",
  "/student",
  "/student/dashboard",
  "/student/tasks",
  "/student/tasks-and-deadlines",
  "/tasks",
  "/calendar",
  "/student/calendar",
  "/student/classes",
];

const GRADE_SEEDS = [
  "/",
  "/student",
  "/student/classes",
  "/classes",
  "/student/grades",
  "/grades",
  "/student/reports",
  "/reports",
  "/student/transcript",
];

export class ManageBacService {
  constructor(private readonly client: ManageBacWebClient) {}

  async checkSession(): Promise<{
    ok: boolean;
    title: string;
    url: string;
    linkCount: number;
  }> {
    const snapshot = await this.client.snapshot("/");
    return {
      ok: true,
      title: snapshot.title,
      url: snapshot.url,
      linkCount: snapshot.links.length,
    };
  }

  async listLinks(path = "/", match?: string): Promise<{ page: string; links: LinkSummary[] }> {
    const snapshot = await this.client.snapshot(path);
    const matcher = match ? new RegExp(escapeRegExp(match), "i") : undefined;
    const links = matcher
      ? snapshot.links.filter((link) => matcher.test(`${link.text} ${link.href}`))
      : snapshot.links;

    return {
      page: snapshot.url,
      links: links.slice(0, 150),
    };
  }

  async debugSnapshot(path = "/", maxChars = 8_000): Promise<PageSnapshot> {
    const snapshot = await this.client.snapshot(path);
    return {
      ...snapshot,
      text: snapshot.text.slice(0, maxChars),
      links: snapshot.links.slice(0, 150),
    };
  }

  async getDeadlines(options: DeadlineOptions): Promise<{
    items: DeadlineItem[];
    pagesVisited: string[];
    errors: Array<{ path: string; message: string }>;
  }> {
    const discovery = await this.discover("deadline", options.path);
    const now = new Date();
    const cutoff = new Date(now.getTime() + options.daysAhead * 24 * 60 * 60 * 1000);
    const items: DeadlineItem[] = [];

    for (const snapshot of discovery.snapshots) {
      const page = await this.client.goto(snapshot.url);
      const raw = await extractRawItems(page, "deadline");
      items.push(...toDeadlineItems(raw, snapshot.url, now));
    }

    const filtered = dedupeDeadlines(items)
      .filter((item) => {
        if (!options.includeCompleted && item.status && /submitted|completed/i.test(item.status)) {
          return false;
        }

        if (!item.dueAt) {
          return true;
        }

        const due = new Date(item.dueAt);
        return Number.isNaN(due.getTime()) || due <= cutoff;
      })
      .sort((a, b) => {
        const aTime = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      })
      .slice(0, options.maxItems);

    return {
      items: filtered,
      pagesVisited: discovery.snapshots.map((snapshot) => snapshot.url),
      errors: discovery.errors,
    };
  }

  async getGrades(options: GradeOptions): Promise<{
    items: GradeItem[];
    pagesVisited: string[];
    errors: Array<{ path: string; message: string }>;
  }> {
    const discovery = await this.discover("grade", options.path);
    const items: GradeItem[] = [];

    for (const snapshot of discovery.snapshots) {
      const page = await this.client.goto(snapshot.url);
      const raw = await extractRawItems(page, "grade");
      items.push(...toGradeItems(raw, snapshot.url));
    }

    return {
      items: dedupeGrades(items).slice(0, options.maxItems),
      pagesVisited: discovery.snapshots.map((snapshot) => snapshot.url),
      errors: discovery.errors,
    };
  }

  async getGpa(options: GradeOptions): Promise<{
    summary: GpaSummary;
    grades: GradeItem[];
    pagesVisited: string[];
    errors: Array<{ path: string; message: string }>;
  }> {
    const discovery = await this.discover("grade", options.path);
    const items: GradeItem[] = [];

    for (const snapshot of discovery.snapshots) {
      const page = await this.client.goto(snapshot.url);
      const raw = await extractRawItems(page, "grade");
      items.push(...toGradeItems(raw, snapshot.url));
    }

    const grades = dedupeGrades(items).slice(0, options.maxItems);
    return {
      summary: computeGpaSummary(
        discovery.snapshots.map((snapshot) => snapshot.text),
        grades,
      ),
      grades,
      pagesVisited: discovery.snapshots.map((snapshot) => snapshot.url),
      errors: discovery.errors,
    };
  }

  private async discover(kind: DiscoveryKind, pathOverride?: string): Promise<DiscoveryResult> {
    const queue = pathOverride ? [pathOverride] : kind === "deadline" ? [...DEADLINE_SEEDS] : [...GRADE_SEEDS];
    const visited = new Set<string>();
    const snapshots: PageSnapshot[] = [];
    const errors: Array<{ path: string; message: string }> = [];
    const maxPages = pathOverride ? 1 : kind === "deadline" ? 12 : 18;

    while (queue.length > 0 && snapshots.length < maxPages) {
      const path = queue.shift();
      if (!path) {
        continue;
      }

      const key = normalizeUrlKey(this.client.urlFor(path));
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);

      try {
        const snapshot = await this.client.snapshot(path);
        snapshots.push(snapshot);

        for (const link of relevantLinks(snapshot.links, kind, this.client.urlFor("/"))) {
          const url = new URL(link.href);
          queue.push(url.pathname + url.search);

          for (const variant of classPathVariants(url.pathname)) {
            queue.push(variant);
          }
        }
      } catch (error) {
        errors.push({ path, message: errorMessage(error) });
      }
    }

    return { snapshots, errors };
  }
}

function relevantLinks(links: LinkSummary[], kind: DiscoveryKind, baseUrl: string): LinkSummary[] {
  const base = new URL(baseUrl);
  const pattern =
    kind === "deadline"
      ? /\b(task|deadline|assignment|assessment|calendar|upcoming|todo|class|course)\b/i
      : /\b(grade|score|mark|report|transcript|class|course|task|unit|assessment|result)\b/i;

  return links.filter((link) => {
    const url = safeUrl(link.href);
    if (!url || url.origin !== base.origin) {
      return false;
    }

    return pattern.test(`${link.text} ${url.pathname}`);
  });
}

function classPathVariants(pathname: string): string[] {
  const match = pathname.match(/^(.*\/classes\/\d+)(?:\/.*)?$/);
  if (!match) {
    return [];
  }

  const classRoot = match[1];
  return [
    `${classRoot}/core/tasks`,
    `${classRoot}/tasks`,
    `${classRoot}/tasks-and-units`,
    `${classRoot}/grades`,
    `${classRoot}/reports`,
  ];
}

function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function normalizeUrlKey(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
