# Mnemo

通过 [MCP](https://modelcontextprotocol.io/) 为 AI 编程助手提供持久化记忆管理。

Mnemo 解决的是 context window 溢出导致记忆丢失的问题——重要的决策、用户偏好和项目知识会在对话重置时消失。Mnemo 将关键信息蒸馏为持久化的记忆笔记，可通过语义搜索在不同会话间检索。

## 特性

- **混合搜索** — 同时通过语义和关键词查找记忆（向量 + 关键词，自动降级）
- **渐进式展示** — 搜索返回摘要；按需获取完整内容
- **多 Agent 支持** — 适配 OpenCode、Claude Code、Openclaw 和 Codex
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

连接后，调用 `memory_setup` 工具将记忆管理指令注入 Agent 配置文件：

```
> 使用 memory_setup 工具初始化 Mnemo
```

这会在 Agent 配置文件中写入一段提示（如 OpenCode 的 `AGENTS.md`、Claude Code 的 `CLAUDE.md`），告诉 Agent 何时以及如何使用 Mnemo 的工具。

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
| `memory_setup`          | 初始化 Mnemo — 向 Agent 配置文件注入使用指令 |
| `memory_save`           | 保存记忆笔记，可附带标签和来源               |
| `memory_search`         | 混合搜索记忆，返回摘要（支持来源和标签过滤） |
| `memory_get`            | 按 ID 获取笔记完整内容                       |
| `memory_compress`       | 列出所有笔记供审阅/蒸馏                      |
| `memory_compress_apply` | 原子性地保存蒸馏笔记并删除原始笔记           |
| `memory_delete`         | 按 ID 删除笔记                               |

## 工作原理

### 存储

记忆笔记以 Markdown 文件存储，包含 YAML frontmatter 元数据：

```
~/Library/Application Support/mnemo/    # macOS
~/.local/share/mnemo/                   # Linux
%APPDATA%/mnemo/                        # Windows
├── notes/                              # Markdown 文件
│   ├── 20260305-172200-a3f1.md
│   └── 20260305-183015-b7c2.md
└── index/                              # 向量索引（vectra）
```

可通过 `MNEMO_DATA_DIR` 环境变量覆盖数据目录。

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
