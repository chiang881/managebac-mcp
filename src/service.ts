import { ManageBacWebClient } from "./managebacWebClient.js";
import {
  computeGpaSummary,
  dedupeDeadlines,
  dedupeGrades,
  extractRawItems,
  toDeadlineItems,
  toGradeItems,
} from "./extractors.js";
import {
  ClassSummary,
  DeadlineItem,
  GpaSummary,
  GradeItem,
  GradeWeightItem,
  LinkSummary,
  PageSnapshot,
} from "./types.js";

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

interface ClassSelector {
  classId?: string;
  className?: string;
  path?: string;
}

interface ClassDeadlineOptions extends DeadlineOptions, ClassSelector {}

interface ClassGradeOptions extends GradeOptions, ClassSelector {}

interface RecentClassGradeOptions extends ClassSelector {
  limit: number;
}

interface ClassWeightOptions extends ClassSelector {
  maxItems: number;
}

const CLASS_SEEDS = ["/", "/student", "/student/dashboard", "/student/classes", "/classes"];

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

  async getClasses(): Promise<{
    items: ClassSummary[];
    pagesVisited: string[];
    errors: Array<{ path: string; message: string }>;
  }> {
    const snapshots: PageSnapshot[] = [];
    const errors: Array<{ path: string; message: string }> = [];

    for (const path of CLASS_SEEDS) {
      try {
        snapshots.push(await this.client.snapshot(path));
      } catch (error) {
        errors.push({ path, message: errorMessage(error) });
      }
    }

    return {
      items: dedupeClasses(
        snapshots.flatMap((snapshot) => extractClassesFromLinks(snapshot.links, this.client.urlFor("/"))),
      ),
      pagesVisited: snapshots.map((snapshot) => snapshot.url),
      errors,
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
    const summary = computeGpaSummary(
      discovery.snapshots.map((snapshot) => snapshot.text),
      grades,
    );
    if (summary.explicitGpa === undefined) {
      throw new Error("No explicit GPA found on ManageBac pages. GPA estimation is disabled.");
    }

    return {
      summary,
      grades,
      pagesVisited: discovery.snapshots.map((snapshot) => snapshot.url),
      errors: discovery.errors,
    };
  }

  async getClassDeadlines(options: ClassDeadlineOptions): Promise<{
    class: ClassSummary;
    items: DeadlineItem[];
    pagesVisited: string[];
    errors: Array<{ path: string; message: string }>;
  }> {
    const target = await this.resolveClass(options);
    const discovery = await this.discoverClass("deadline", target);
    const now = new Date();
    const cutoff = new Date(now.getTime() + options.daysAhead * 24 * 60 * 60 * 1000);
    const items: DeadlineItem[] = [];

    for (const snapshot of discovery.snapshots) {
      const page = await this.client.goto(snapshot.url);
      const raw = await extractRawItems(page, "deadline");
      items.push(...toDeadlineItems(raw, snapshot.url, now).map((item) => ({ ...item, course: item.course ?? target.name })));
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
      class: target,
      items: filtered,
      pagesVisited: discovery.snapshots.map((snapshot) => snapshot.url),
      errors: discovery.errors,
    };
  }

  async getClassGrades(options: ClassGradeOptions): Promise<{
    class: ClassSummary;
    items: GradeItem[];
    pagesVisited: string[];
    errors: Array<{ path: string; message: string }>;
  }> {
    const target = await this.resolveClass(options);
    const discovery = await this.discoverClass("grade", target);
    const items: GradeItem[] = [];

    for (const snapshot of discovery.snapshots) {
      const page = await this.client.goto(snapshot.url);
      const raw = await extractRawItems(page, "grade");
      items.push(...toGradeItems(raw, snapshot.url).map((item) => ({ ...item, course: item.course ?? target.name })));
    }

    return {
      class: target,
      items: dedupeGrades(items).slice(0, options.maxItems),
      pagesVisited: discovery.snapshots.map((snapshot) => snapshot.url),
      errors: discovery.errors,
    };
  }

  async getClassGpa(options: ClassGradeOptions): Promise<{
    class: ClassSummary;
    summary: GpaSummary;
    grades: GradeItem[];
    pagesVisited: string[];
    errors: Array<{ path: string; message: string }>;
  }> {
    const target = await this.resolveClass(options);
    const discovery = await this.discoverClass("grade", target);
    const items: GradeItem[] = [];

    for (const snapshot of discovery.snapshots) {
      const page = await this.client.goto(snapshot.url);
      const raw = await extractRawItems(page, "grade");
      items.push(...toGradeItems(raw, snapshot.url).map((item) => ({ ...item, course: item.course ?? target.name })));
    }

    const grades = dedupeGrades(items).slice(0, options.maxItems);
    const summary = computeGpaSummary(
      discovery.snapshots.map((snapshot) => snapshot.text),
      grades,
    );
    if (summary.explicitGpa === undefined) {
      throw new Error(`No explicit GPA found for class "${target.name}". GPA estimation is disabled.`);
    }

    return {
      class: target,
      summary,
      grades,
      pagesVisited: discovery.snapshots.map((snapshot) => snapshot.url),
      errors: discovery.errors,
    };
  }

  async getRecentClassGrades(options: RecentClassGradeOptions): Promise<{
    class: ClassSummary;
    items: GradeItem[];
    pagesVisited: string[];
    errors: Array<{ path: string; message: string }>;
  }> {
    const result = await this.getClassGrades({
      classId: options.classId,
      className: options.className,
      path: options.path,
      maxItems: Math.max(options.limit, 50),
    });

    return {
      ...result,
      items: sortGradesByRecordedAt(result.items).slice(0, options.limit),
    };
  }

  async getClassGradeWeights(options: ClassWeightOptions): Promise<{
    class: ClassSummary;
    items: GradeWeightItem[];
    pagesVisited: string[];
    errors: Array<{ path: string; message: string }>;
  }> {
    const target = await this.resolveClass(options);
    const discovery = await this.discoverClass("grade", target);
    const gradeItems: GradeItem[] = [];

    for (const snapshot of discovery.snapshots) {
      const page = await this.client.goto(snapshot.url);
      const raw = await extractRawItems(page, "grade");
      gradeItems.push(...toGradeItems(raw, snapshot.url));
    }

    return {
      class: target,
      items: dedupeWeights(extractGradeWeights(discovery.snapshots, gradeItems)).slice(0, options.maxItems),
      pagesVisited: discovery.snapshots.map((snapshot) => snapshot.url),
      errors: discovery.errors,
    };
  }

  private async discover(kind: DiscoveryKind, pathOverride?: string): Promise<DiscoveryResult> {
    const seeds = pathOverride ? [pathOverride] : kind === "deadline" ? [...DEADLINE_SEEDS] : [...GRADE_SEEDS];
    return this.crawl(kind, seeds, pathOverride ? 1 : kind === "deadline" ? 12 : 18);
  }

  private async discoverClass(kind: DiscoveryKind, target: ClassSummary): Promise<DiscoveryResult> {
    const classRoot = classRootFromPath(target.path);
    const seeds = classTargetPaths(target.path, kind);
    return this.crawl(kind, seeds, kind === "deadline" ? 8 : 12, classRoot);
  }

  private async crawl(
    kind: DiscoveryKind,
    seeds: string[],
    maxPages: number,
    restrictToClassRoot?: string,
  ): Promise<DiscoveryResult> {
    const queue = [...seeds];
    const visited = new Set<string>();
    const snapshots: PageSnapshot[] = [];
    const errors: Array<{ path: string; message: string }> = [];

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
          if (restrictToClassRoot && !url.pathname.startsWith(restrictToClassRoot)) {
            continue;
          }
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

  private async resolveClass(selector: ClassSelector): Promise<ClassSummary> {
    if (selector.path) {
      const url = new URL(this.client.urlFor(selector.path));
      return {
        id: classIdFromPath(url.pathname),
        name: selector.className || selector.classId || url.pathname,
        path: url.pathname + url.search,
        href: url.toString(),
        sourceText: selector.path,
      };
    }

    if (!selector.classId && !selector.className) {
      throw new Error("Provide classId, className, or path. Use managebac_get_classes first if you need to discover classes.");
    }

    const classes = (await this.getClasses()).items;
    const normalizedName = selector.className ? normalizeSearchText(selector.className) : undefined;
    const target = classes.find((item) => {
      if (selector.classId && item.id === selector.classId) {
        return true;
      }

      if (!normalizedName) {
        return false;
      }

      const candidate = normalizeSearchText(`${item.name} ${item.sourceText}`);
      return candidate.includes(normalizedName);
    });

    if (target) {
      return target;
    }

    if (selector.classId) {
      const path = `/student/classes/${selector.classId}`;
      return {
        id: selector.classId,
        name: selector.className || selector.classId,
        path,
        href: this.client.urlFor(path),
        sourceText: selector.classId,
      };
    }

    const available = classes
      .slice(0, 20)
      .map((item) => item.name)
      .join(", ");
    throw new Error(`Class not found for "${selector.className}". Available classes: ${available || "none discovered"}.`);
  }
}

function extractClassesFromLinks(links: LinkSummary[], baseUrl: string): ClassSummary[] {
  const base = new URL(baseUrl);
  return links
    .map((link) => {
      const url = safeUrl(link.href);
      if (!url || url.origin !== base.origin) {
        return undefined;
      }

      const id = classIdFromPath(url.pathname);
      const looksLikeClass =
        id !== undefined || /\b(class|classes|course|subject|lesson|unit)\b/i.test(`${link.text} ${url.pathname}`);
      if (!looksLikeClass) {
        return undefined;
      }

      const name = cleanClassName(link.text);
      if (!name || name.length < 2 || name.length > 160 || /^(classes?|courses?|subjects?)$/i.test(name)) {
        return undefined;
      }

      return {
        ...(id ? { id } : {}),
        name,
        path: url.pathname + url.search,
        href: url.toString(),
        sourceText: link.text,
      };
    })
    .filter((item): item is ClassSummary => item !== undefined);
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

function classTargetPaths(path: string, kind: DiscoveryKind): string[] {
  const url = safeUrl(path);
  const pathname = url ? url.pathname : path.split("?")[0];
  const search = url ? url.search : path.includes("?") ? `?${path.split("?").slice(1).join("?")}` : "";
  const root = classRootFromPath(pathname);
  const variants =
    kind === "deadline"
      ? [
          `${root}/core/tasks`,
          `${root}/tasks`,
          `${root}/tasks-and-units`,
          `${root}/calendar`,
          `${root}/assignments`,
          `${root}/assessments`,
        ]
      : [
          `${root}/grades`,
          `${root}/reports`,
          `${root}/transcript`,
          `${root}/core/tasks`,
          `${root}/tasks-and-units`,
          `${root}/assignments`,
          `${root}/assessments`,
        ];

  return dedupeStrings([pathname + search, root, ...variants]);
}

function classRootFromPath(pathname: string): string {
  const cleanPathname = pathname.split("?")[0];
  const match = cleanPathname.match(/^(.*\/classes\/\d+)(?:\/.*)?$/);
  return match ? match[1] : cleanPathname;
}

function classIdFromPath(pathname: string): string | undefined {
  return pathname.split("?")[0].match(/\/classes\/(\d+)/)?.[1];
}

function dedupeClasses(items: ClassSummary[]): ClassSummary[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = (item.id ? `id:${item.id}` : `path:${item.path}`).toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sortGradesByRecordedAt(items: GradeItem[]): GradeItem[] {
  return [...items].sort((a, b) => {
    const aTime = a.recordedAt ? new Date(a.recordedAt).getTime() : 0;
    const bTime = b.recordedAt ? new Date(b.recordedAt).getTime() : 0;
    return bTime - aTime;
  });
}

function extractGradeWeights(snapshots: PageSnapshot[], grades: GradeItem[]): GradeWeightItem[] {
  const fromGrades = grades
    .filter((grade) => grade.weightText)
    .map((grade) => ({
      category: grade.title,
      weightText: grade.weightText ?? "",
      value: percentValue(grade.weightText),
      sourceUrl: grade.sourceUrl,
      rawText: grade.rawText,
    }));

  const fromPages = snapshots.flatMap((snapshot) =>
    snapshot.text
      .split(/\r?\n/)
      .map((line) => cleanLine(line))
      .filter((line) => line.length >= 4 && line.length <= 240)
      .map((line) => weightFromLine(line, snapshot.url))
      .filter((item): item is GradeWeightItem => item !== undefined),
  );

  return [...fromGrades, ...fromPages];
}

function weightFromLine(line: string, sourceUrl: string): GradeWeightItem | undefined {
  const hasWeightKeyword = /\b(weight|weighting|category|categories)\b|占比|权重|比例|类别|分类/i.test(line);
  const percent = line.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (!hasWeightKeyword || !percent) {
    return undefined;
  }

  const category = line
    .replace(/(\d{1,3}(?:\.\d+)?)\s*%.*$/, "")
    .replace(/\b(weight|weighting|category|categories)\b|占比|权重|比例|类别|分类/gi, "")
    .replace(/[:：=\-–—|]+/g, " ")
    .trim();

  return {
    category: category || "Weight",
    weightText: percent[0],
    value: Number.parseFloat(percent[1]),
    sourceUrl,
    rawText: line,
  };
}

function dedupeWeights(items: GradeWeightItem[]): GradeWeightItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.category}|${item.weightText}|${item.sourceUrl}`.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function percentValue(value?: string): number | undefined {
  const match = value?.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  return match ? Number.parseFloat(match[1]) : undefined;
}

function cleanClassName(value: string): string {
  return cleanLine(value)
    .replace(/\b(view|open|go to|class|course)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanLine(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

function normalizeSearchText(value: string): string {
  return cleanLine(value).toLowerCase();
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
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
