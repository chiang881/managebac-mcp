import { Page } from "playwright";
import * as chrono from "chrono-node";
import { DeadlineItem, GpaSummary, GradeItem, RawExtractedItem } from "./types.js";

type ItemKind = "deadline" | "grade";

export async function extractRawItems(page: Page, kind: ItemKind): Promise<RawExtractedItem[]> {
  return page.evaluate((itemKind) => {
    const deadlineKeywords =
      /\b(task|deadline|due|assignment|assessment|event|submit|submitted|missing|overdue|upcoming|today|tomorrow)\b/i;
    const gradeKeywords =
      /\b(grade|score|mark|points?|rubric|criteria|criterion|achievement|percent|percentage|gpa|term|semester)\b/i;
    const dateish =
      /\b(today|tomorrow|yesterday|mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/i;
    const scoreish =
      /(\b\d{1,3}(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\b|\b[A-F][+-]?\b|\b[1-7]\s*\/\s*7\b)/i;
    const selectors =
      itemKind === "deadline"
        ? [
            "tr",
            "li",
            "article",
            ".card",
            ".list-group-item",
            "[class*='task' i]",
            "[class*='deadline' i]",
            "[class*='assignment' i]",
            "[class*='assessment' i]",
            "[class*='event' i]",
          ]
        : [
            "tr",
            "li",
            "article",
            ".card",
            ".list-group-item",
            "[class*='grade' i]",
            "[class*='score' i]",
            "[class*='assessment' i]",
            "[class*='assignment' i]",
            "[class*='result' i]",
          ];

    const elements = new Set<Element>();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => elements.add(element));
    }

    const records: RawExtractedItem[] = [];
    const seen = new Set<string>();

    for (const element of elements) {
      if (!isVisible(element)) {
        continue;
      }

      const text = clean((element as HTMLElement).innerText || element.textContent || "");
      if (text.length < 8 || text.length > 1_200) {
        continue;
      }

      const useful =
        itemKind === "deadline"
          ? deadlineKeywords.test(text) || dateish.test(text)
          : gradeKeywords.test(text) || scoreish.test(text);
      if (!useful) {
        continue;
      }

      const key = text.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      records.push({
        title: bestTitle(element, text),
        text,
        href: (element.querySelector("a[href]") as HTMLAnchorElement | null)?.href,
        nearbyHeading: nearbyHeading(element),
      });
    }

    return records.slice(0, 200);

    function isVisible(element: Element): boolean {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function clean(value: string): string {
      return value
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    function bestTitle(element: Element, fallbackText: string): string {
      const titleSelector = "h1,h2,h3,h4,h5,a,[class*='title' i],[class*='name' i]";
      const titleElement = element.querySelector(titleSelector);
      const titleText = clean(titleElement?.textContent ?? "");
      if (titleText && titleText.length <= 160) {
        return titleText;
      }

      return (
        fallbackText
          .split(/\n/)
          .map((line) => line.trim())
          .find((line) => line.length >= 3 && line.length <= 160) ?? fallbackText.slice(0, 160)
      );
    }

    function nearbyHeading(element: Element): string | undefined {
      let current: Element | null = element;
      for (let depth = 0; depth < 4 && current; depth += 1) {
        let sibling = current.previousElementSibling;
        while (sibling) {
          const heading = sibling.matches("h1,h2,h3,h4,h5,h6")
            ? sibling
            : sibling.querySelector("h1,h2,h3,h4,h5,h6");
          const text = clean(heading?.textContent ?? "");
          if (text && text.length <= 160) {
            return text;
          }
          sibling = sibling.previousElementSibling;
        }
        current = current.parentElement;
      }
      return undefined;
    }
  }, kind);
}

export function toDeadlineItems(
  rawItems: RawExtractedItem[],
  sourceUrl: string,
  referenceDate = new Date(),
): DeadlineItem[] {
  return rawItems
    .map((raw) => {
      const parsedDate = parseDate(raw.text, referenceDate);
      const title = chooseTitle(raw);
      const status = firstMatch(raw.text, /\b(overdue|submitted|completed|missing|late|draft|not submitted|upcoming)\b/i);

      return {
        title,
        course: raw.nearbyHeading,
        dueDateText: parsedDate?.text,
        dueAt: parsedDate?.date?.toISOString(),
        status,
        sourceUrl,
        href: raw.href,
        rawText: raw.text,
      };
    })
    .filter((item) => item.dueDateText || /\b(due|deadline|today|tomorrow|overdue|upcoming)\b/i.test(item.rawText));
}

export function extractAllTasksDeadlinesFromText(
  text: string,
  sourceUrl: string,
  course: string | undefined,
  referenceDate = new Date(),
): DeadlineItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, " ").trim())
    .filter(Boolean);
  const items: DeadlineItem[] = [];

  for (let index = 0; index < lines.length - 2; index += 1) {
    const month = normalizeMonth(lines[index]);
    const day = Number.parseInt(lines[index + 1], 10);
    if (!month || !Number.isInteger(day) || day < 1 || day > 31) {
      continue;
    }

    const title = lines[index + 2];
    if (!isLikelyTaskTitle(title)) {
      continue;
    }

    const blockEnd = nextMonthDayIndex(lines, index + 2);
    const block = lines.slice(index, blockEnd);
    const timeText = block.find((line) => /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b.+\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i.test(line));
    const status = block.find((line) => /^(Submitted|Pending|Late|Missing|Overdue|Not Submitted|Not Assessed Yet|Completed)$/i.test(line));
    const dueDateText = [month, String(day), timeText].filter(Boolean).join(" ");
    const dueAt = dateFromMonthDay(month, day, timeText, referenceDate)?.toISOString();

    items.push({
      title,
      course,
      dueDateText,
      dueAt,
      status,
      sourceUrl,
      rawText: block.join("\n"),
    });

    index = blockEnd - 1;
  }

  return items;
}

export function toGradeItems(rawItems: RawExtractedItem[], sourceUrl: string): GradeItem[] {
  return rawItems
    .map((raw) => {
      const parsedDate = parseDate(raw.text, new Date(), false);
      const scoreText = firstMatch(
        raw.text,
        /(\b\d{1,3}(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\b)/,
      );
      const gradeText = firstMatch(
        raw.text,
        /(\b[A-F][+-]?\b|\b(?:IB\s*)?(?:grade|level|mark)\s*[:=\-]?\s*[1-7]\b|\b[1-7]\s*\/\s*7\b)/i,
      );
      const weightText = firstMatch(raw.text, /(\bweight(?:ing)?\s*[:=\-]?\s*\d{1,3}(?:\.\d+)?\s*%)/i);

      return {
        title: chooseTitle(raw),
        course: raw.nearbyHeading,
        scoreText,
        gradeText,
        weightText,
        dateText: parsedDate?.text,
        recordedAt: parsedDate?.date?.toISOString(),
        sourceUrl,
        href: raw.href,
        rawText: raw.text,
      };
    })
    .filter((item) => item.scoreText || item.gradeText || /\b(gpa|grade|score|mark|points?)\b/i.test(item.rawText));
}

export function computeGpaSummary(pageTexts: string[], grades: GradeItem[]): GpaSummary {
  void grades;
  const joinedText = pageTexts.join("\n");
  const explicitGpa = extractExplicitGpa(joinedText);

  const notes = [
    explicitGpa !== undefined
      ? "Found an explicit GPA value on the scraped page."
      : "No explicit GPA value found on the scraped pages.",
    "GPA estimation is disabled. Percentages and IB 1-7 grades are never converted into GPA.",
  ];

  return {
    explicitGpa,
    scale: "ManageBac page value",
    notes,
    components: [],
  };
}

export function dedupeDeadlines(items: DeadlineItem[]): DeadlineItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [item.title, item.course ?? "", item.dueDateText ?? "", item.rawText.slice(0, 120)]
      .join("|")
      .toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function dedupeGrades(items: GradeItem[]): GradeItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [item.title, item.course ?? "", item.scoreText ?? "", item.gradeText ?? "", item.rawText.slice(0, 120)]
      .join("|")
      .toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function chooseTitle(raw: RawExtractedItem): string {
  const lines = raw.text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidate =
    [raw.title, ...lines].find(
      (line) =>
        line.length >= 3 &&
        line.length <= 140 &&
        !/^(due|deadline|score|grade|mark|points?|submitted|overdue|upcoming)\b/i.test(line),
    ) ?? raw.title;

  return candidate.replace(/\s+/g, " ").trim();
}

function parseDate(text: string, referenceDate: Date, forwardDate = true): { text: string; date: Date } | undefined {
  const results = chrono.parse(text, referenceDate, { forwardDate });
  const first = results.find((result) => result.start);
  if (!first) {
    return undefined;
  }

  return {
    text: first.text,
    date: first.start.date(),
  };
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1]?.trim();
}

function extractExplicitGpa(text: string): number | undefined {
  const match = text.match(/(?:\bGPA\b|Grade Point Average)\s*(?:[:=]|is)?\s*([0-4](?:\.\d{1,3})?)/i);
  return match ? Number.parseFloat(match[1]) : undefined;
}

function nextMonthDayIndex(lines: string[], start: number): number {
  for (let index = start; index < lines.length - 1; index += 1) {
    if (normalizeMonth(lines[index]) && /^\d{1,2}$/.test(lines[index + 1])) {
      return index;
    }
  }
  return Math.min(lines.length, start + 12);
}

function normalizeMonth(value: string): string | undefined {
  const match = value.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)$/i);
  if (!match) {
    return undefined;
  }

  const normalized = match[1].slice(0, 3).toUpperCase();
  return normalized === "SEP" ? "SEP" : normalized;
}

function isLikelyTaskTitle(value: string | undefined): value is string {
  if (!value || value.length < 3 || value.length > 180) {
    return false;
  }

  return !/^(Formative|Summative|Assessment|Submitted|Pending|Late|Missing|Overdue|Not Submitted|Not Assessed Yet|A|B|C|D|F|N\/A|\d+(?:\.\d+)?\s*\/\s*\d+)/i.test(value);
}

function dateFromMonthDay(month: string, day: number, timeText: string | undefined, referenceDate: Date): Date | undefined {
  const monthIndex = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(month);
  if (monthIndex < 0) {
    return undefined;
  }

  const date = new Date(referenceDate);
  date.setFullYear(referenceDate.getFullYear(), monthIndex, day);
  date.setHours(23, 59, 0, 0);

  const timeMatch = timeText?.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  if (timeMatch) {
    let hours = Number.parseInt(timeMatch[1], 10);
    const minutes = Number.parseInt(timeMatch[2], 10);
    const meridiem = timeMatch[3].toUpperCase();
    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
    date.setHours(hours, minutes, 0, 0);
  }

  if (date.getTime() - referenceDate.getTime() > 45 * 24 * 60 * 60 * 1000 && monthIndex >= 7) {
    date.setFullYear(date.getFullYear() - 1);
  }

  return date;
}
