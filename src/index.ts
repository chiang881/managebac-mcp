#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { loadConfig } from "./config.js";
import { ManageBacWebClient } from "./managebacWebClient.js";
import { ManageBacService } from "./service.js";

const config = loadConfigOrExit();
const client = new ManageBacWebClient(config);
const service = new ManageBacService(client);
let queue: Promise<void> = Promise.resolve();

const server = new McpServer({
  name: "managebac-mcp",
  version: "1.0.0",
});

server.registerTool(
  "managebac_check_session",
  {
    description: "Log in to ManageBac and confirm that the session can read the student homepage.",
    inputSchema: {},
  },
  async () => runTool(() => service.checkSession()),
);

server.registerTool(
  "managebac_get_classes",
  {
    description: "Get the ManageBac class/course list visible to the logged-in student.",
    inputSchema: {},
  },
  async () => runTool(() => service.getClasses()),
);

server.registerTool(
  "managebac_get_all_deadlines",
  {
    description: "Get ManageBac Tasks & Deadlines from the student homepage: upcoming, past, overdue, or all.",
    inputSchema: {
      view: z
        .enum(["upcoming", "past", "overdue", "all"])
        .optional()
        .describe("Which Tasks & Deadlines tab to read. Defaults to upcoming."),
      daysAhead: z.number().int().min(1).max(366).optional().describe("How many days ahead to include. Defaults to 30."),
      includeCompleted: z
        .boolean()
        .optional()
        .describe("Include submitted/completed tasks. Defaults to true for past/all, otherwise false."),
      maxItems: z.number().int().min(1).max(200).optional().describe("Maximum items to return. Defaults to 50."),
    },
  },
  async ({ view, daysAhead, includeCompleted, maxItems }) => {
    const selectedView = view ?? "upcoming";
    return runTool(() =>
      service.getDeadlines({
        view: selectedView,
        daysAhead: daysAhead ?? 30,
        includeCompleted: includeCompleted ?? (selectedView === "past" || selectedView === "all"),
        maxItems: maxItems ?? 50,
      }),
    );
  },
);

server.registerTool(
  "managebac_get_class_deadlines",
  {
    description: "Get upcoming DDL/deadlines for one ManageBac class/course.",
    inputSchema: {
      classId: z.string().optional().describe("ManageBac class id, usually found in /classes/{id}."),
      className: z.string().optional().describe("Class/course name substring. Use managebac_get_classes first if unsure."),
      path: z.string().optional().describe("Direct class path or URL, e.g. /student/classes/123/core/tasks."),
      daysAhead: z.number().int().min(1).max(366).optional().describe("How many days ahead to include. Defaults to 30."),
      includeCompleted: z.boolean().optional().describe("Include submitted/completed tasks. Defaults to false."),
      maxItems: z.number().int().min(1).max(200).optional().describe("Maximum items to return. Defaults to 50."),
    },
  },
  async ({ classId, className, path, daysAhead, includeCompleted, maxItems }) =>
    runTool(() =>
      service.getClassDeadlines({
        classId,
        className,
        path,
        view: "upcoming",
        daysAhead: daysAhead ?? 30,
        includeCompleted: includeCompleted ?? false,
        maxItems: maxItems ?? 50,
      }),
    ),
);

server.registerTool(
  "managebac_get_grades",
  {
    description: "Get grade/score-like items from ManageBac class, task, report, and transcript pages.",
    inputSchema: {
      maxItems: z.number().int().min(1).max(300).optional().describe("Maximum grade items to return. Defaults to 100."),
      path: z
        .string()
        .optional()
        .describe("Optional ManageBac path or URL to scrape instead of automatic discovery."),
    },
  },
  async ({ maxItems, path }) =>
    runTool(() =>
      service.getGrades({
        maxItems: maxItems ?? 100,
        path,
      }),
    ),
);

server.registerTool(
  "managebac_get_class_grades",
  {
    description: "Get grade/score-like items for one ManageBac class/course.",
    inputSchema: {
      classId: z.string().optional().describe("ManageBac class id, usually found in /classes/{id}."),
      className: z.string().optional().describe("Class/course name substring. Use managebac_get_classes first if unsure."),
      path: z.string().optional().describe("Direct class path or URL."),
      maxItems: z.number().int().min(1).max(300).optional().describe("Maximum grade items to return. Defaults to 100."),
    },
  },
  async ({ classId, className, path, maxItems }) =>
    runTool(() =>
      service.getClassGrades({
        classId,
        className,
        path,
        maxItems: maxItems ?? 100,
      }),
    ),
);

server.registerTool(
  "managebac_get_gpa",
  {
    description: "Read explicit GPA from ManageBac. Returns an error when no explicit GPA is visible.",
    inputSchema: {
      maxItems: z.number().int().min(1).max(300).optional().describe("Maximum grade items to use. Defaults to 100."),
      path: z
        .string()
        .optional()
        .describe("Optional ManageBac path or URL to scrape instead of automatic discovery."),
    },
  },
  async ({ maxItems, path }) =>
    runTool(() =>
      service.getGpa({
        maxItems: maxItems ?? 100,
        path,
      }),
    ),
);

server.registerTool(
  "managebac_get_class_gpa",
  {
    description: "Read explicit GPA for one ManageBac class. Returns an error when no explicit GPA is visible.",
    inputSchema: {
      classId: z.string().optional().describe("ManageBac class id, usually found in /classes/{id}."),
      className: z.string().optional().describe("Class/course name substring. Use managebac_get_classes first if unsure."),
      path: z.string().optional().describe("Direct class path or URL."),
      maxItems: z.number().int().min(1).max(300).optional().describe("Maximum grade items to use. Defaults to 100."),
    },
  },
  async ({ classId, className, path, maxItems }) =>
    runTool(() =>
      service.getClassGpa({
        classId,
        className,
        path,
        maxItems: maxItems ?? 100,
      }),
    ),
);

server.registerTool(
  "managebac_get_recent_class_grades",
  {
    description: "Get the latest N grade/score-like entries for one ManageBac class/course.",
    inputSchema: {
      classId: z.string().optional().describe("ManageBac class id, usually found in /classes/{id}."),
      className: z.string().optional().describe("Class/course name substring. Use managebac_get_classes first if unsure."),
      path: z.string().optional().describe("Direct class path or URL."),
      limit: z.number().int().min(1).max(100).optional().describe("Number of recent grade items to return. Defaults to 10."),
    },
  },
  async ({ classId, className, path, limit }) =>
    runTool(() =>
      service.getRecentClassGrades({
        classId,
        className,
        path,
        limit: limit ?? 10,
      }),
    ),
);

server.registerTool(
  "managebac_get_class_grade_weights",
  {
    description: "Read grade category weights/proportions for one ManageBac class/course when visible on the page.",
    inputSchema: {
      classId: z.string().optional().describe("ManageBac class id, usually found in /classes/{id}."),
      className: z.string().optional().describe("Class/course name substring. Use managebac_get_classes first if unsure."),
      path: z.string().optional().describe("Direct class path or URL."),
      maxItems: z.number().int().min(1).max(100).optional().describe("Maximum weight items to return. Defaults to 50."),
    },
  },
  async ({ classId, className, path, maxItems }) =>
    runTool(() =>
      service.getClassGradeWeights({
        classId,
        className,
        path,
        maxItems: maxItems ?? 50,
      }),
    ),
);

server.registerTool(
  "managebac_list_links",
  {
    description: "List links visible on an authenticated ManageBac page. Useful for finding exact class/task paths.",
    inputSchema: {
      path: z.string().optional().describe("ManageBac path or URL. Defaults to /."),
      match: z.string().optional().describe("Optional case-insensitive substring filter for link text or URL."),
    },
  },
  async ({ path, match }) => runTool(() => service.listLinks(path ?? "/", match)),
);

server.registerTool(
  "managebac_debug_snapshot",
  {
    description:
      "Return the text and links from an authenticated ManageBac page for debugging extractors. Text is truncated by maxChars.",
    inputSchema: {
      path: z.string().optional().describe("ManageBac path or URL. Defaults to /."),
      maxChars: z.number().int().min(500).max(50_000).optional().describe("Maximum text characters. Defaults to 8000."),
    },
  },
  async ({ path, maxChars }) => runTool(() => service.debugSnapshot(path ?? "/", maxChars ?? 8_000)),
);

async function runTool<T>(operation: () => Promise<T>) {
  return serialize(async () => {
    try {
      const data = await operation();
      const structuredContent = toStructuredContent(data);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true as const,
        content: [
          {
            type: "text" as const,
            text: message,
          },
        ],
      };
    }
  });
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function toStructuredContent(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }

  return { value };
}

function loadConfigOrExit() {
  try {
    return loadConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`managebac-mcp connected for ${config.baseUrl}`);
}

process.on("SIGINT", () => {
  client.close().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  client.close().finally(() => process.exit(0));
});

main().catch((error) => {
  console.error("managebac-mcp failed to start:", error);
  process.exit(1);
});
