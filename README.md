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

这是一个本地 stdio MCP 服务器，可以让 Claude Code、OpenCode 等 AI Agent 通过学生账号读取 ManageBac 中的 DDL、成绩条目和 GPA/估算 GPA。

默认实例已设置为：

```env
MANAGEBAC_BASE_URL=https://beijing101.managebac.cn
```

## ✨ 功能特性

- 获取 class / course 列表
- 查看全部 DDL，以及查看单科 DDL
- 查看全部成绩，以及查看某一门 class 的成绩
- 读取全局 GPA / 单科 GPA；读不到官方 GPA 时自动估算非加权 4.0 GPA
- 读取某一门课近期 N 条成绩
- 读取某一门课的成绩占比 / category weight
- 登录态复用，避免每次工具调用都重新登录
- 交互式部署配置，运行时询问实例地址、账号和密码

## 🛠️ 工具列表

- `managebac_check_session`: 登录并确认能读取学生首页
- `managebac_get_classes`: 获取 class / course 列表
- `managebac_get_all_deadlines`: 查看全部 DDL
- `managebac_get_deadlines`: 查看全部 DDL，支持传入自定义 path
- `managebac_get_class_deadlines`: 查看单科 DDL
- `managebac_get_grades`: 查看全部成绩 / 分数条目
- `managebac_get_class_grades`: 获取某一门 class 的成绩
- `managebac_get_gpa`: 读取或估算全局 GPA
- `managebac_get_class_gpa`: 读取或估算单科 GPA
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

然后把这个 MCP server 配置为 stdio：
node /绝对路径/managebac-mcp/dist/index.js
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

### 部署与配置

推荐使用交互式配置向导。它会询问 ManageBac 实例地址、账号和密码，并把结果保存到本地 `.env`：

```bash
npm run configure
```

部署/首次配置时也可以直接运行：

```bash
npm run deploy
```

`deploy` 会先构建项目，然后进入同一个交互式配置向导。密码输入不会回显，生成的 `.env` 权限会设置为 `0600`。

也可以手动复制示例配置：

```bash
cp .env.example .env
```

然后在 `.env` 里填写：

```env
MANAGEBAC_EMAIL=your.email@example.com
MANAGEBAC_PASSWORD=your-password
```

`.env`、登录态和调试文件已经在 `.gitignore` 中忽略。不要把账号密码写进代码或提交。

## MCP 客户端配置

如果已经通过 `npm run configure` 生成 `.env`，MCP 客户端可以只配置命令：

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

也可以把配置放进 MCP 客户端的 `env`：

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

## 调试建议

如果 DDL 或 GPA 没抓准，先调用：

```text
managebac_list_links({ "match": "task" })
managebac_list_links({ "match": "grade" })
managebac_debug_snapshot({ "path": "/student/classes/你的class路径/core/tasks" })
```

然后把找到的 path 传给 `managebac_get_deadlines` 或 `managebac_get_gpa` 的 `path` 参数。
