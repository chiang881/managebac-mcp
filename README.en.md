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

This is a local stdio MCP server that lets Claude Code, OpenCode, and other AI agents read ManageBac deadlines, grade-like entries, and GPA or estimated GPA through a student account.

The default instance is:

```env
MANAGEBAC_BASE_URL=https://beijing101.managebac.cn
```

## ✨ Features

- Get the class / course list
- Read all DDLs, and read DDLs for one class
- Read all grade-like entries, and read grades for one class
- Read global GPA / class GPA; estimate an unweighted 4.0 GPA when no official GPA is visible
- Read the latest N grades for one class
- Read grade category weights / proportions for one class
- Reuse browser login state to avoid signing in for every tool call
- Interactive deployment configuration that asks for instance URL, account, and password at runtime

## 🛠️ Tool List

- `managebac_check_session`: sign in and confirm the student homepage can be read
- `managebac_get_classes`: get the class / course list
- `managebac_get_all_deadlines`: get all DDLs
- `managebac_get_deadlines`: get all DDLs with optional custom path support
- `managebac_get_class_deadlines`: get DDLs for one class
- `managebac_get_grades`: get all grade / score-like entries
- `managebac_get_class_grades`: get grades for one class
- `managebac_get_gpa`: read or estimate global GPA
- `managebac_get_class_gpa`: read or estimate GPA for one class
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

Then configure this MCP server as stdio:
node /absolute/path/managebac-mcp/dist/index.js
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

### Deployment And Configuration

The recommended path is the interactive configuration wizard. It asks for the ManageBac instance URL, account, and password, then saves them to a local `.env` file:

```bash
npm run configure
```

For first-time deployment, you can also run:

```bash
npm run deploy
```

`deploy` builds the project first, then starts the same interactive configuration wizard. Password input is hidden, and the generated `.env` file is written with `0600` permissions.

You can also copy the example config manually:

```bash
cp .env.example .env
```

Then fill in:

```env
MANAGEBAC_EMAIL=your.email@example.com
MANAGEBAC_PASSWORD=your-password
```

`.env`, browser login state, and debug files are ignored by `.gitignore`. Do not commit account credentials.

## MCP Client Configuration

If you generated `.env` with `npm run configure`, the MCP client only needs the command:

```json
{
  "mcpServers": {
    "managebac": {
      "command": "node",
      "args": ["/Users/jiangzongji/Desktop/main/managebac mcp/dist/index.js"]
    }
  }
}
```

You can also put configuration directly in the MCP client's `env` block:

```json
{
  "mcpServers": {
    "managebac": {
      "command": "node",
      "args": ["/Users/jiangzongji/Desktop/main/managebac mcp/dist/index.js"],
      "env": {
        "MANAGEBAC_BASE_URL": "https://beijing101.managebac.cn",
        "MANAGEBAC_EMAIL": "your.email@example.com",
        "MANAGEBAC_PASSWORD": "your-password"
      }
    }
  }
}
```

## Debugging Tips

If deadlines or GPA are not extracted correctly, start with:

```text
managebac_list_links({ "match": "task" })
managebac_list_links({ "match": "grade" })
managebac_debug_snapshot({ "path": "/student/classes/your-class-path/core/tasks" })
```

Then pass the discovered path to `managebac_get_deadlines` or `managebac_get_gpa`.
