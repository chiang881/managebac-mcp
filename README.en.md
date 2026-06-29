<p align="center">
  <img src="./ManageBac.png" alt="ManageBac MCP Logo" width="160" />
</p>

<p align="center">
  <a href="./README.md">简体中文</a> · <a href="./README.en.md">English</a>
</p>

# ManageBac MCP Server

---

![node](https://img.shields.io/badge/node-20%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![typescript](https://img.shields.io/badge/TypeScript-5%2B-3178C6?style=flat-square&logo=typescript&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Ready-7057ff?style=flat-square)
![License](https://img.shields.io/badge/License-ISC-f1c40f?style=flat-square)
![PRs](https://img.shields.io/badge/PRs-Welcome-2ecc71?style=flat-square)

> Built on top of the [ManageBac](https://www.managebac.com/) student web experience

## Connect ManageBac To Your AI Agent

This is a local stdio MCP server that lets Claude Code, OpenCode, and other AI agents read ManageBac DDLs, classes, grade-like entries, and explicitly displayed GPA.

The default login flow is manual browser login: run `npm run login`, the program saves `.managebac/storage-state.json`, and later MCP tools reuse that session. The server only submits account credentials automatically when `MANAGEBAC_LOGIN_MODE=password` is explicitly enabled.

## ✨ Features

- Get the class / course list
- Read the homepage `Tasks & Deadlines` tabs: `upcoming`, `past`, and `overdue`
- Read all DDLs, and read DDLs for one class
- Read all grade-like entries, and read grades for one class
- Read global GPA / class GPA; return an error when no explicit GPA is visible
- Never estimate unweighted 4.0 GPA from percentages or IB 1-7 grades
- Read the latest N grades for one class
- Read grade category weights / proportions for one class
- Default to manual login with recorded session state to reduce account lock risk
- Support automatic password login only when explicitly enabled

## 🛠️ Tool List

- `managebac_check_session`: confirm the current session can read the student homepage
- `managebac_get_classes`: get the class / course list
- `managebac_get_all_deadlines`: read homepage Tasks & Deadlines with `view: upcoming | past | overdue | all`
- `managebac_get_class_deadlines`: get DDLs for one class
- `managebac_get_grades`: get all grade / score-like entries
- `managebac_get_class_grades`: get grades for one class
- `managebac_get_gpa`: read explicitly displayed global GPA, or return an error when unavailable
- `managebac_get_class_gpa`: read explicitly displayed GPA for one class, or return an error when unavailable
- `managebac_get_recent_class_grades`: read the latest N grades for one class
- `managebac_get_class_grade_weights`: read grade category weights for one class
- `managebac_list_links`: list links on an authenticated page to find exact class paths
- `managebac_debug_snapshot`: return page text and links for extractor debugging

## 🚀 Installation And Usage

### Quick Install: Copy This To Your AI Agent

```text
Please install and configure ManageBac MCP:
git clone https://github.com/chiang881/managebac-mcp.git
cd managebac-mcp
npm install
npm run build
npm run deploy
npm run login

Then configure this MCP server as stdio:
node /absolute/path/managebac-mcp/dist/index.js
```

`npm run deploy` asks for your ManageBac instance URL. Do not hard-code any school's instance as the default; use your own instance, for example:

```env
MANAGEBAC_BASE_URL=https://your-school.managebac.com
```

### Manual Installation

```bash
git clone https://github.com/chiang881/managebac-mcp.git
cd managebac-mcp
npm install
npm run build
```

If Playwright cannot find Chromium on first run:

```bash
npm run install-browser
```

Copy the example config:

```bash
cp .env.example .env
```

Minimal config:

```env
MANAGEBAC_BASE_URL=https://your-school.managebac.com
MANAGEBAC_LOGIN_MODE=manual
MANAGEBAC_STORAGE_STATE=.managebac/storage-state.json
```

After saving config, open a browser for manual login and record the session:

```bash
npm run login
```

### Automatic Password Login

The server does not submit passwords by default. If you really need automatic login, explicitly set this in `.env` or in the MCP client `env` block:

```env
MANAGEBAC_LOGIN_MODE=password
MANAGEBAC_EMAIL=your.email@example.com
MANAGEBAC_PASSWORD=your-password
MANAGEBAC_LOGIN_COOLDOWN_MS=900000
MANAGEBAC_LOGIN_FORCE=false
```

If the account was just locked, do not keep retrying automatic login. Confirm that browser login works, then run `npm run login` to save a fresh session.

### Non-Interactive / Headless Deployment

`npm run deploy` runs an interactive configuration wizard. In a non-interactive environment it exits with:

```text
Interactive terminal required. Set MANAGEBAC_BASE_URL and MANAGEBAC_LOGIN_MODE manually in non-interactive deployments.
```

Use either approach:

1. Edit `.env` directly and set at least `MANAGEBAC_BASE_URL` and `MANAGEBAC_LOGIN_MODE=manual`
2. Pass those variables through the MCP client's `env` block

`.env`, `.managebac/storage-state.json`, and debug files are ignored by `.gitignore`. Do not commit account credentials or browser session state.

## Claude Code Configuration

Claude Code project MCP configuration belongs in `.mcp.json` at the repository root, not in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "managebac": {
      "command": "node",
      "args": ["/absolute/path/managebac-mcp/dist/index.js"],
      "env": {
        "MANAGEBAC_BASE_URL": "https://your-school.managebac.com",
        "MANAGEBAC_LOGIN_MODE": "manual",
        "MANAGEBAC_STORAGE_STATE": "/absolute/path/managebac-mcp/.managebac/storage-state.json"
      }
    }
  }
}
```

After adding `.mcp.json`, Claude Code usually needs the approval chain:

1. Allow the project MCP server in `.claude/settings.local.json`, for example with `enabledMcpjsonServers`, or set `enableAllProjectMcpServers: true`
2. Restart Claude Code so `.mcp.json` and permission changes take effect
3. After restart, run `/mcp`; if `managebac` is still pending, approve it manually
4. The first call to each MCP tool may still require a separate allow prompt

## Debugging Tips

If deadlines or GPA are not extracted correctly, start with:

```text
managebac_list_links({ "match": "task" })
managebac_list_links({ "match": "grade" })
managebac_debug_snapshot({ "path": "/student/tasks_and_deadlines?view=upcoming" })
```

Class DDLs live under `Classes -> one class -> Tasks & Units -> View All Tasks`. Pass the discovered class path to `managebac_get_class_deadlines` or `managebac_get_class_gpa`.
