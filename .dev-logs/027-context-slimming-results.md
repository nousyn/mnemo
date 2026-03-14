# 027 - Context Slimming 实施结果

日期: 2026-03-14

## 概要

实施方案C（Context Slimming），将每轮固定 token 开销从 2518 降至 1080，实际减少 57.1%（目标 46%）。

## 实施内容

### 1. 精简 BASE_MEMORY_PROMPT

- **之前**: 118 行，1515 tokens — 包含初始化兜底、触发条件列表、类型建议、Guidelines 等
- **之后**: 12 行，223 tokens — 只保留 7 条核心规则：search first、save selectively、always specify type、dedup、distill、lifecycle、compress
- **减少**: 1292 tokens（85.3%）

精简策略：

- 删除了 `memory_setup` 初始化兜底（不再是 MCP 工具）
- 删除了触发条件列表（含 `→ type: xxx` 建议），用一句 "Always specify type" 替代
- 删除了 Guidelines 段落，核心点已内化到 7 条规则中
- 保留了所有影响 agent 行为的关键规则

### 2. memory_setup 从 MCP 工具转为 CLI 命令

- `src/tools/setup.ts`: 从 `registerSetupTool(server: McpServer)` 改为 `runSetup(options: SetupOptions): Promise<SetupResult>`，纯函数，无 McpServer 依赖
- `src/index.ts`: 改为双模式入口 — 检测 `process.argv[2]` 为 `setup` 时走 CLI 路径，否则启动 MCP server
- 支持 `--agent`、`--scope`、`--project-root` 参数，以及 `--help`
- Agent 类型检测：移除了 MCP clientInfo 检测（不再经过 MCP），只保留文件检测
- `src/core/config.ts`: 错误信息从 "Run memory_setup first" 改为 "Run `npx @s_s/mnemo setup` first"
- 用法: `npx @s_s/mnemo setup [--agent <type>] [--scope global|project] [--project-root <path>]`

### 3. 更新 README

- `README.md` + `docs/README.zh-CN.md` 同步更新
- Initialize 段落: 从 MCP 工具调用改为 CLI 命令 + options 表格
- 删除了 "First-time setup" 聊天示例（不再通过 agent 初始化）
- Tools 表格: 7 → 6 个工具，移除 `memory_setup` 行
- Storage 段落: 错误提示改为 CLI 命令

### 4. 更新测试

- `tools.test.ts`:
  - 移除 `registerSetupTool` 导入和注册
  - 工具列表测试: 7 → 6 个工具
  - `memory_setup` MCP 工具测试 → `runSetup()` 纯函数测试
  - MCP 协议级 agent 检测测试 → 文件级 agent 检测测试
  - 修复测试污染问题（"no file marker" 测试使用独立干净目录）
- `templates.test.ts`: 更新断言匹配精简后的 prompt 内容
- `config.test.ts`: 更新错误信息匹配
- `hooks.test.ts`: `registerSetupTool` → `runSetup()` 调用

## Token 对比

| 组件                           |        Before |         After |              变化 |
| ------------------------------ | ------------: | ------------: | ----------------: |
| AGENTS.md (BASE_MEMORY_PROMPT) |          1515 |           223 |     -1292 (85.3%) |
| Hook perTurn reminder          |            74 |            74 |                 0 |
| Tool schemas                   | 929 (7 tools) | 783 (6 tools) |      -146 (15.7%) |
| **合计**                       |      **2518** |      **1080** | **-1438 (57.1%)** |

## 验证

- TypeScript 编译: 零错误
- 测试: 171/171 通过，6 个测试文件全部通过
- Token 计量: tiktoken cl100k_base 确认

## 变更文件清单

```
src/index.ts              # 重写为双模式入口（CLI setup + MCP server）
src/tools/setup.ts        # 从 MCP 工具改为纯函数
src/core/config.ts        # 错误信息更新
src/prompts/templates.ts  # BASE_MEMORY_PROMPT 精简（之前会话已完成）
README.md                 # Initialize、Tools、Storage 段落更新
docs/README.zh-CN.md      # 中文版同步更新
tests/tools.test.ts       # setup 测试重写
tests/templates.test.ts   # prompt 断言更新
tests/config.test.ts      # 错误信息断言更新
tests/hooks.test.ts       # setup 集成测试更新
```

## 决策记录

- **不合并低频工具**: 之前分析过，合并 compress/delete/compress_apply 只能省 ~5%，不值得增加复杂度
- **CLI 参数风格**: 使用标准 GNU 长选项（`--agent`、`--scope`），不引入参数解析库（yargs 等），手写解析足够
- **动态 import**: MCP server 路径使用 `await import()` 而非顶层静态 import，避免 CLI setup 路径加载不必要的 MCP SDK
- **删除 MCP 协议级检测**: setup 不再经过 MCP，无法获取 clientInfo.name。文件检测作为唯一方式，简单可靠
