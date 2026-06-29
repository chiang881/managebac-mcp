#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { loadConfig } from "./config.js";
import { ManageBacWebClient } from "./managebacWebClient.js";
import { ManageBacService } from "./service.js";

const config = loadConfig();
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
  "managebac_get_deadlines",
  {
    description:
      "Get upcoming ManageBac DDL/deadlines, tasks, assignments, assessments, and calendar-like due items for the logged-in student.",
    inputSchema: {
      daysAhead: z.number().int().min(1).max(366).optional().describe("How many days ahead to include. Defaults to 30."),
      includeCompleted: z.boolean().optional().describe("Include submitted/completed tasks. Defaults to false."),
      maxItems: z.number().int().min(1).max(200).optional().describe("Maximum items to return. Defaults to 50."),
      path: z
        .string()
        .optional()
        .describe("Optional ManageBac path or URL to scrape instead of automatic discovery, e.g. /student/classes/123/core/tasks."),
    },
  },
  async ({ daysAhead, includeCompleted, maxItems, path }) =>
    runTool(() =>
      service.getDeadlines({
        daysAhead: daysAhead ?? 30,
        includeCompleted: includeCompleted ?? false,
        maxItems: maxItems ?? 50,
        path,
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
  "managebac_get_gpa",
  {
    description:
      "Read explicit GPA from ManageBac if present; otherwise estimate an unweighted 4.0 GPA from scraped percentages or IB 1-7 grades.",
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
