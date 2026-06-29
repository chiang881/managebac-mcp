# ManageBac MCP

本项目是一个本地 stdio MCP server，用学生账号登录 ManageBac，读取 DDL、成绩条目和 GPA/估算 GPA。

默认实例已设置为：

```env
MANAGEBAC_BASE_URL=https://beijing101.managebac.cn
```

## 安装

```bash
npm install
npm run build
```

如果第一次运行 Playwright 找不到 Chromium：

```bash
npm run install-browser
```

## 配置

推荐使用交互式配置向导。它会询问 ManageBac 实例地址、账号和密码，并把结果保存到本地 `.env`：

```bash
npm run configure
```

部署/首次配置时也可以直接运行：

```bash
npm run deploy
```

`deploy` 会先构建项目，然后进入同一个交互式配置向导。

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

## MCP 客户端配置示例

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

## Tools

- `managebac_check_session`: 登录并确认能读取学生首页。
- `managebac_get_deadlines`: 获取 DDL、任务、作业、评估和日历类 due items。
- `managebac_get_grades`: 获取成绩、分数、报告页中类似 grade/score 的条目。
- `managebac_get_gpa`: 优先读取页面里的明确 GPA；如果没有，则从百分制或 IB 1-7 成绩估算非加权 4.0 GPA。
- `managebac_list_links`: 列出登录后页面链接，用来找到某个 class 的精确路径。
- `managebac_debug_snapshot`: 返回某页正文和链接，用于调试抓取规则。

## 调试建议

如果 DDL 或 GPA 没抓准，先调用：

```text
managebac_list_links({ "match": "task" })
managebac_list_links({ "match": "grade" })
managebac_debug_snapshot({ "path": "/student/classes/你的class路径/core/tasks" })
```

然后把找到的 path 传给 `managebac_get_deadlines` 或 `managebac_get_gpa` 的 `path` 参数。
