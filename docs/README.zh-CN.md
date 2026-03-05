# Mnemo

通过 [MCP](https://modelcontextprotocol.io/) 为 AI 编程助手提供持久化记忆管理。

Mnemo 解决的是 context window 溢出导致记忆丢失的问题——重要的决策、用户偏好和项目知识会在对话重置时消失。Mnemo 将关键信息蒸馏为持久化的记忆笔记，可通过语义搜索在不同会话间检索。

## 特性

- **语义搜索** — 按含义而非关键词查找记忆（基于本地嵌入模型）
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

将 Mnemo 添加到你的 MCP 客户端配置。以 OpenCode（`opencode.json`）为例：

```json
{
  "mcp": {
    "mnemo": {
      "command": "mnemo"
    }
  }
}
```

Claude Code（`.claude/settings.json`）：

```json
{
  "mcpServers": {
    "mnemo": {
      "command": "mnemo"
    }
  }
}
```

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

Mnemo 提供 6 个 MCP 工具：

| 工具                    | 说明                                                 |
| ----------------------- | ---------------------------------------------------- |
| `memory_setup`          | 初始化 Mnemo — 向 Agent 配置文件注入使用指令         |
| `memory_save`           | 保存记忆笔记，可附带标签和来源                       |
| `memory_search`         | 语义搜索记忆（支持 `source_filter` 和 `tag_filter`） |
| `memory_compress`       | 列出所有笔记供审阅/蒸馏                              |
| `memory_compress_apply` | 原子性地保存蒸馏笔记并删除原始笔记                   |
| `memory_delete`         | 按 ID 删除笔记                                       |

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

### 语义搜索

Mnemo 使用 [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2)（33MB，384 维）通过 `@huggingface/transformers` 在本地生成嵌入向量。模型在服务启动时预加载，确保首次搜索前就绪。

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
