export interface LinkSummary {
  text: string;
  href: string;
}

export interface PageSnapshot {
  title: string;
  url: string;
  text: string;
  links: LinkSummary[];
}

export interface RawExtractedItem {
  title: string;
  text: string;
  href?: string;
  nearbyHeading?: string;
}

export interface DeadlineItem {
  title: string;
  course?: string;
  dueDateText?: string;
  dueAt?: string;
  status?: string;
  sourceUrl: string;
  href?: string;
  rawText: string;
}

export interface GradeItem {
  title: string;
  course?: string;
  scoreText?: string;
  gradeText?: string;
  weightText?: string;
  sourceUrl: string;
  href?: string;
  rawText: string;
}

export interface GpaSummary {
  explicitGpa?: number;
  estimatedGpa?: number;
  averagePercent?: number;
  scale: string;
  notes: string[];
  components: Array<{
    title: string;
    course?: string;
    value: number;
    source: "percent" | "ib-grade";
  }>;
}
