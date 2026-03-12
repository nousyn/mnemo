# Mnemo

> _记忆是一切创造之母，遗忘之河的对立面。Mnemo 只留下仍然重要的。_

通过 [MCP](https://modelcontextprotocol.io/) 为 AI 编程助手提供持久化的高价值长期上下文。

Mnemo 不是对话记录归档。它只捕获那些在未来会话中仍然重要的上下文——决策、偏好、规则、未完成的线索——并通过语义搜索提供检索。可以把它理解为 AI Agent 的持久化长期记忆。

## 特性

- **记忆类型** — 8 种语义分类（preference、profile、goal、continuity、fact、decision、rule、experience），保存时必须指定类型
- **生命周期 Hook** — 通过 Agent 原生 hook 机制注入每轮提醒（Claude Code、Codex、OpenClaw、OpenCode），让 Agent 真正记得使用记忆工具
- **混合搜索** — 同时通过语义和关键词查找记忆（向量 + 关键词，自动降级）
- **渐进式展示** — 搜索返回摘要；按需获取完整内容
- **多 Agent 支持** — 适配 OpenCode、Claude Code、OpenClaw 和 Codex；通过 MCP 协议自动检测 Agent 类型
- **完全本地化** — 无 API 调用，无云存储，所有数据留在你的机器上
- **自动提示注入** — 向 Agent 配置文件注入使用指令，让 Agent 知道何时保存和检索记忆
- **压缩工作流** — 原子性地将旧笔记蒸馏为更少、更精炼的笔记

## 快速开始

### 安装

```bash
npm install -g @s_s/mnemo
```

### 配置 MCP 客户端

将 Mnemo 添加到你的 MCP 客户端配置。

<details>
<summary><strong>OpenCode</strong></summary>

添加到 `opencode.json`：

```json
{
  "mcp": {
    "mnemo": {
      "type": "local",
      "command": ["mnemo"]
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Code</strong></summary>

通过 CLI（user scope，所有项目可用）：

```bash
claude mcp add --transport stdio --scope user mnemo -- mnemo
```

配置存储在 `~/.claude.json` 中。

</details>

<details>
<summary><strong>Codex</strong></summary>

通过 CLI：

```bash
codex mcp add mnemo -- mnemo
```

或添加到 `~/.codex/config.toml`：

```toml
[mcp_servers.mnemo]
command = "mnemo"
```

</details>

<details>
<summary><strong>OpenClaw</strong>（通过 mcporter skill）</summary>

OpenClaw 使用 [mcporter](https://github.com/steipete/mcporter) 管理 MCP 服务器。添加到 `config/mcporter.json`（或 `~/.mcporter/mcporter.json` 全局配置）：

```json
{
  "mcpServers": {
    "mnemo": {
      "command": "mnemo"
    }
  }
}
```

或通过 mcporter CLI：

```bash
mcporter config add mnemo --command mnemo --scope home
```

</details>

### 初始化

连接后，调用 `memory_setup` 工具初始化 Mnemo：

```
> 使用 memory_setup 工具初始化 Mnemo
```

这会执行两个步骤：

1. **提示注入** — 将记忆管理指令写入 Agent 配置文件（如 OpenCode 的 `AGENTS.md`、Claude Code 的 `CLAUDE.md`）
2. **Hook 安装** — 安装生命周期 hook，在关键时刻提醒 Agent 使用记忆工具（Claude Code/Codex 每轮提醒，OpenClaw 会话启动时提醒，OpenCode 会话生命周期事件提醒）

两个步骤相互独立——其中一个失败不影响另一个。Agent 类型通过 MCP 协议自动检测，文件检测作为降级方案。

默认情况下，`memory_setup()` 会初始化为**全局记忆**，在多个项目之间共享。如果你需要项目隔离的记忆，请在调用 `memory_setup` 时传入 `scope: "project"`。

### 存储作用域

- `global`（默认）— 跨项目共享记忆；提示词写入用户级 Agent 配置
- `project` — 当前项目独立记忆；提示词写入项目级配置，并在项目内创建 `.mnemo/` 目录

当使用 `scope: "project"` 时，也可以额外传入 `project_root`，显式指定项目根目录。

## 使用示例

> **重要：** 你不需要直接调用 Mnemo 的工具。你只需用自然语言和 AI Agent 对话，Agent 会在幕后自动判断何时调用 Mnemo 工具。运行 `memory_setup` 后，Agent 就已经知道何时以及如何使用它们了。

### 首次初始化

```
你:     帮我设置一下 Mnemo 记忆管理
Agent:  好的，我来初始化 Mnemo。
        → [调用 memory_setup 工具]
        Mnemo 已初始化完成，我已将记忆管理指令写入 AGENTS.md 文件。
```

### 自动保存记忆

Agent 在识别到重要信息时会自动保存：

```
你:     这个项目统一用 4 空格缩进，单引号
Agent:  好的，我会遵循这个风格。
        → [调用 memory_save: "项目代码风格：4空格缩进，单引号",
           tags: ["preference", "code-style"]]
        我已将这个偏好保存为记忆，下次会话也能记住。
```

### 自动检索上下文

开始新对话时，Agent 会自动搜索相关记忆：

```
你:     继续做认证模块的开发
Agent:  → [调用 memory_search: "认证模块"]
        根据我的记忆，上次我们决定使用 JWT + refresh token，
        存储在 httpOnly cookie 中。我从上次的进度继续。
```

### 主动搜索记忆

```
你:     你还记得我们选了什么数据库吗？
Agent:  → [调用 memory_search: "数据库选择"]
        找到一条相关记忆。
        → [调用 memory_get: "<笔记ID>"]
        记得——我们选择了 PostgreSQL + Prisma ORM，主要看中
        它的类型安全和迁移工具。
```

### 压缩记忆

当记忆积累较多时，可以让 Agent 清理整合：

```
你:     记忆太多了，帮我整理一下
Agent:  → [调用 memory_compress]
        找到 23 条记忆，我来蒸馏精简...
        → [调用 memory_compress_apply: 保存 8 条蒸馏笔记，
           删除 23 条原始笔记]
        完成。已将 23 条记忆压缩为 8 条精简笔记。
```

## 工具

Mnemo 提供 7 个 MCP 工具：

| 工具                    | 说明                                         |
| ----------------------- | -------------------------------------------- |
| `memory_setup`          | 初始化 Mnemo — 注入使用指令并建立存储作用域  |
| `memory_save`           | 保存记忆笔记，需指定类型，可附带标签和来源   |
| `memory_search`         | 混合搜索记忆，返回摘要（支持来源和标签过滤） |
| `memory_get`            | 按 ID 获取笔记完整内容                       |
| `memory_compress`       | 列出所有笔记供审阅/蒸馏                      |
| `memory_compress_apply` | 原子性地保存蒸馏笔记并删除原始笔记           |
| `memory_delete`         | 按 ID 删除笔记                               |

## 记忆模型

每条记忆笔记在保存前必须归入 8 种类型之一：

| 类型         | 用途                           | 示例                                       |
| ------------ | ------------------------------ | ------------------------------------------ |
| `preference` | 用户偏好和协作习惯             | "偏好 4 空格缩进，单引号"                  |
| `profile`    | 用户/项目/主题的稳定背景       | "项目使用 Next.js 14 App Router"           |
| `goal`       | 长期方向和目标                 | "Q3 前从 REST 迁移到 GraphQL"              |
| `continuity` | 需要后续恢复的未完成线索       | "认证模块：停在 refresh token 逻辑"        |
| `fact`       | 稳定的客观信息                 | "生产数据库是 PostgreSQL 16"               |
| `decision`   | 讨论中确认的选择               | "选了 Prisma 而非 Drizzle，看中类型安全"   |
| `rule`       | 可复用的约定和协议             | "所有 API 错误返回 { code, message } 格式" |
| `experience` | 经过验证的可复用经验（高门槛） | "批量写入 DB 让迁移时间缩短了 10 倍"       |

记忆保存需满足 3 条标准中的至少 2 条：(1) 跨会话有用，(2) 影响未来工作，(3) 遗忘后需要重新对齐。

## 工作原理

### 存储

记忆笔记以 Markdown 文件存储，包含 YAML frontmatter 元数据。

全局模式：

```
~/Library/Application Support/mnemo/    # macOS
~/.local/share/mnemo/                   # Linux
%APPDATA%/mnemo/                        # Windows
├── config.json                         # 全局存储标记
├── notes/                              # Markdown 文件
│   ├── 20260305-172200-a3f1.md
│   └── 20260305-183015-b7c2.md
└── index/                              # 向量索引（vectra）
```

项目模式：

```
<projectRoot>/.mnemo/
├── config.json                          # 项目存储标记
├── notes/                               # Markdown 文件
└── index/                               # 向量索引（vectra）
```

可通过 `MNEMO_DATA_DIR` 环境变量覆盖全局数据目录。

注意：使用其他记忆工具前，必须先运行 `memory_setup` 完成初始化。存储解析顺序是：先找项目级 marker，再找全局 marker；两者都不存在时，Mnemo 会提示当前环境尚未初始化。

### 混合搜索

Mnemo 采用混合搜索策略，结合**向量搜索**（基于 [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) 的语义相似度，33MB，384 维）和**关键词搜索**（大小写不敏感的词项匹配）。两种结果按加权分数合并（向量：0.7，关键词：0.3）。如果嵌入模型尚未就绪，关键词搜索可作为优雅降级。

搜索结果默认返回摘要。使用 `memory_get` 传入笔记 ID 获取完整内容——这样在浏览结果时可以最小化 context 消耗。

### 记忆生命周期

1. **保存** — Agent 在对话中保存关键信息（决策、偏好、架构选择，或 context 即将耗尽时）
2. **搜索** — Agent 在新对话开始时或需要时检索相关上下文
3. **压缩** — 当笔记积累过多时，Agent 通过 `memory_compress` → 审阅蒸馏 → `memory_compress_apply` 将笔记精炼合并

## 开发

```bash
git clone git@github.com:See-Cat/mnemo.git
cd mnemo
npm install
npm run build
npm test
```

### 命令

| 命令                   | 说明               |
| ---------------------- | ------------------ |
| `npm run build`        | 编译 TypeScript    |
| `npm run dev`          | 监听模式编译       |
| `npm test`             | 运行测试（Vitest） |
| `npm run test:watch`   | 监听模式测试       |
| `npm run prettier:fix` | 格式化所有文件     |
| `npm run release`      | 交互式发布流程     |

### 发布

```bash
npm run release
```

交互式脚本，依次执行：Git 检查 → 分支确认 → 版本选择 → 格式化 → 测试 → 构建 → 发布 → 推送。

## 许可证

MIT
