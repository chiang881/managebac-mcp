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

export function toGradeItems(rawItems: RawExtractedItem[], sourceUrl: string): GradeItem[] {
  return rawItems
    .map((raw) => {
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
        sourceUrl,
        href: raw.href,
        rawText: raw.text,
      };
    })
    .filter((item) => item.scoreText || item.gradeText || /\b(gpa|grade|score|mark|points?)\b/i.test(item.rawText));
}

export function computeGpaSummary(pageTexts: string[], grades: GradeItem[]): GpaSummary {
  const joinedText = pageTexts.join("\n");
  const explicitGpa = extractExplicitGpa(joinedText);
  const components = grades
    .map((grade) => {
      const percent = extractPercentValue(grade.scoreText);
      if (percent !== undefined) {
        return {
          title: grade.title,
          course: grade.course,
          value: percent,
          source: "percent" as const,
        };
      }

      const ibGrade = extractIbGrade(grade.gradeText);
      if (ibGrade !== undefined) {
        return {
          title: grade.title,
          course: grade.course,
          value: ibGrade,
          source: "ib-grade" as const,
        };
      }

      return undefined;
    })
    .filter((component): component is NonNullable<typeof component> => component !== undefined);

  const percentComponents = components.filter((component) => component.source === "percent");
  const averagePercent =
    percentComponents.length > 0
      ? round(percentComponents.reduce((sum, component) => sum + component.value, 0) / percentComponents.length, 2)
      : undefined;

  const gpaValues =
    percentComponents.length > 0
      ? percentComponents.map((component) => percentToGpa(component.value))
      : components
          .filter((component) => component.source === "ib-grade")
          .map((component) => ibGradeToGpa(component.value));

  const estimatedGpa =
    explicitGpa === undefined && gpaValues.length > 0
      ? round(gpaValues.reduce((sum, value) => sum + value, 0) / gpaValues.length, 2)
      : undefined;

  const notes = [
    explicitGpa !== undefined
      ? "Found an explicit GPA value on the scraped page."
      : "No explicit GPA value found on the scraped pages.",
    estimatedGpa !== undefined
      ? "Estimated GPA uses a common unweighted 4.0 conversion and may differ from your school's official policy."
      : "Not enough numeric grade data to estimate GPA.",
  ];

  return {
    explicitGpa,
    estimatedGpa,
    averagePercent,
    scale: explicitGpa !== undefined ? "ManageBac page value" : "estimated unweighted 4.0",
    notes,
    components: components.slice(0, 100),
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

function parseDate(text: string, referenceDate: Date): { text: string; date: Date } | undefined {
  const results = chrono.parse(text, referenceDate, { forwardDate: true });
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

function extractPercentValue(scoreText?: string): number | undefined {
  if (!scoreText) {
    return undefined;
  }

  const percent = scoreText.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (percent) {
    const value = Number.parseFloat(percent[1]);
    return value <= 100 ? value : undefined;
  }

  const fraction = scoreText.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (fraction) {
    const earned = Number.parseFloat(fraction[1]);
    const possible = Number.parseFloat(fraction[2]);
    return possible > 0 ? round((earned / possible) * 100, 2) : undefined;
  }

  return undefined;
}

function extractIbGrade(gradeText?: string): number | undefined {
  if (!gradeText) {
    return undefined;
  }

  const match = gradeText.match(/\b([1-7])\s*(?:\/\s*7)?\b/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function percentToGpa(percent: number): number {
  if (percent >= 93) return 4;
  if (percent >= 90) return 3.7;
  if (percent >= 87) return 3.3;
  if (percent >= 83) return 3;
  if (percent >= 80) return 2.7;
  if (percent >= 77) return 2.3;
  if (percent >= 73) return 2;
  if (percent >= 70) return 1.7;
  if (percent >= 67) return 1.3;
  if (percent >= 65) return 1;
  return 0;
}

function ibGradeToGpa(grade: number): number {
  if (grade >= 7) return 4;
  if (grade === 6) return 3.7;
  if (grade === 5) return 3;
  if (grade === 4) return 2;
  if (grade === 3) return 1;
  return 0;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
