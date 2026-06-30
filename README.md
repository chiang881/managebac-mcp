<p align="center">
  <img src="./ManageBac.png" alt="ManageBac MCP Logo" width="160" />
</p>

<p align="center">
  <a href="./README.md">简体中文</a> · <a href="./README.en.md">English</a>
</p>

# ManageBac MCP 服务器

---

![node](https://img.shields.io/badge/node-20%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![typescript](https://img.shields.io/badge/TypeScript-5%2B-3178C6?style=flat-square&logo=typescript&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Ready-7057ff?style=flat-square)
![License](https://img.shields.io/badge/License-ISC-f1c40f?style=flat-square)
![PRs](https://img.shields.io/badge/PRs-Welcome-2ecc71?style=flat-square)

> 基于 [ManageBac](https://www.managebac.com/) 学生端网页实现

## 为您的 AI Agent 接入 ManageBac

这是一个本地 stdio MCP 服务器，可以让 Claude Code、OpenCode 等 AI Agent 读取 ManageBac 中的 DDL、class、成绩条目和页面明确显示的 GPA。

默认登录方式是手动浏览器登录：先运行 `npm run login`，程序会保存 `.managebac/storage-state.json`，之后 MCP 工具复用这个 session。只有显式设置 `MANAGEBAC_LOGIN_MODE=password` 时，程序才会尝试自动提交账号密码。

## ✨ 功能特性

- 获取 class / course 列表
- 从主页 `Tasks & Deadlines` 读取 `upcoming`、`past`、`overdue` 三个栏目
- 查看全部 DDL，以及查看单科 DDL
- 查看全部成绩，以及查看某一门 class 的成绩
- 读取全局 GPA / 单科 GPA；读不到页面明确显示的 GPA 时直接返回 error
- 禁止按百分制或 IB 1-7 成绩估算非加权 4.0 GPA
- 读取某一门课近期 N 条成绩
- 读取某一门课的成绩占比 / category weight
- 默认手动登录并记录 session，降低账号被锁风险
- 支持自动密码登录，但必须主动开启

## 🛠️ 工具列表

- `managebac_check_session`: 确认当前 session 能读取学生首页
- `managebac_runtime_info`: 查看当前 MCP 进程 pid、build、登录模式和 session 文件状态，用来排查旧进程
- `managebac_get_classes`: 获取 class / course 列表
- `managebac_get_all_deadlines`: 查看主页 Tasks & Deadlines，可选 `view: upcoming | past | overdue | all`
- `managebac_get_class_deadlines`: 查看单科 DDL
- `managebac_get_grades`: 查看全部成绩 / 分数条目
- `managebac_get_class_grades`: 获取某一门 class 的成绩
- `managebac_get_gpa`: 读取页面明确显示的全局 GPA，读不到时返回 error
- `managebac_get_class_gpa`: 读取页面明确显示的单科 GPA，读不到时返回 error
- `managebac_get_recent_class_grades`: 读取这门 class 的近期 N 条成绩
- `managebac_get_class_grade_weights`: 读取这门课的成绩占比
- `managebac_list_links`: 列出登录后页面链接，用来找到某个 class 的精确路径
- `managebac_debug_snapshot`: 返回某页正文和链接，用于调试抓取规则

## 🚀 安装与使用

### 快速安装：复制以下命令给 AI agent

```text
请帮我安装并配置 ManageBac MCP：
git clone https://github.com/chiang881/managebac-mcp.git
cd managebac-mcp
npm install
npm run build
npm run deploy
npm run login

然后把这个 MCP server 配置为 stdio：
node /absolute/path/managebac-mcp/dist/index.js
```

`npm run deploy` 会询问 ManageBac 实例地址。不要把默认实例写死成某个学校，请填写自己的实例，例如：

```env
MANAGEBAC_BASE_URL=https://your-school.managebac.com
```

### 手动安装

```bash
git clone https://github.com/chiang881/managebac-mcp.git
cd managebac-mcp
npm install
npm run build
```

如果第一次运行 Playwright 找不到 Chromium：

```bash
npm run install-browser
```

复制配置文件：

```bash
cp .env.example .env
```

最小配置：

```env
MANAGEBAC_BASE_URL=https://your-school.managebac.com
MANAGEBAC_LOGIN_MODE=manual
MANAGEBAC_STORAGE_STATE=.managebac/storage-state.json
```

保存配置后，打开浏览器手动登录并记录 session：

```bash
npm run login
```

### 自动密码登录

默认不自动提交密码。如果确实需要自动登录，在 `.env` 或 MCP 客户端 `env` 中显式设置：

```env
MANAGEBAC_LOGIN_MODE=password
MANAGEBAC_EMAIL=your.email@example.com
MANAGEBAC_PASSWORD=your-password
MANAGEBAC_LOGIN_COOLDOWN_MS=900000
MANAGEBAC_LOGIN_FORCE=false
```

如果账号刚被锁定，先不要反复运行自动登录。确认网页可以手动登录后，运行 `npm run login` 重新保存 session。

### 非交互 / headless 部署

`npm run deploy` 会构建项目并进入交互式配置向导。非交互环境中可以直接调用 `configure` 的参数模式：

```bash
npm run build
npm run configure -- --base-url=https://your-school.managebac.com --mode=manual
```

可用参数：

```text
--base-url
--mode manual|password
--email
--password
--storage-state
--headless
--timeout-ms
--login-cooldown-ms
--login-force
--debug-dir
```

也可以直接编辑 `.env`，或在 MCP 客户端配置的 `env` 中传入这些变量。

`.env`、`.managebac/storage-state.json` 和调试文件已经在 `.gitignore` 中忽略。不要把账号密码或登录态提交到 GitHub。

## Claude Code 配置

Claude Code 的项目 MCP 配置应写在仓库根目录的 `.mcp.json`，不是 `~/.claude/settings.json`：

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

配置后通常还需要完成 Claude Code 的审批链：

1. 在 `.claude/settings.local.json` 中允许项目 MCP server，例如设置 `enabledMcpjsonServers`，或使用 `enableAllProjectMcpServers: true`
2. 重启 Claude Code，让 `.mcp.json` 和权限配置生效
3. 重启后运行 `/mcp`，如果 `managebac` 仍处于 pending 状态，手动批准
4. 第一次调用每个 MCP tool 时，Claude Code 可能还会要求单独 allow

## 排查旧进程

MCP 客户端会把工具绑定到启动时的 server 进程。更新代码、修改 `.env` 或重新登录后，请重启 / reconnect MCP 客户端，否则旧进程可能继续使用旧代码和旧配置。

服务启动时会向 stderr 输出一行 banner，包含 `version`、`build`、`pid`、`mode`、`baseUrl`、`storageState` 和 `storageStatePath`。也可以调用：

```text
managebac_runtime_info()
```

用返回的 `pid`、`build` 和 `storageStateExists` 确认当前工具是否真的连到了新进程。

## 调试建议

如果 DDL 或 GPA 没抓准，先调用：

```text
managebac_list_links({ "match": "task" })
managebac_list_links({ "match": "grade" })
managebac_debug_snapshot({ "path": "/student/tasks_and_deadlines?view=upcoming" })
```

单科 DDL 位于 `Classes -> 某门课 -> Tasks & Units -> View All Tasks`。可以把找到的 class path 传给 `managebac_get_class_deadlines` 或 `managebac_get_class_gpa` 的 `path` 参数。
