# Mnemo

[中文文档](./docs/README.zh-CN.md)

Persistent memory management for AI coding assistants via [MCP](https://modelcontextprotocol.io/).

Mnemo solves the problem of context window overflow — important decisions, user preferences, and project knowledge get lost when conversations reset. Mnemo distills key information into persistent memory notes that can be recalled across sessions using semantic search.

## Features

- **Hybrid search** — find memories by meaning and keywords (vector + keyword, with automatic fallback)
- **Progressive disclosure** — search returns summaries; retrieve full content on demand
- **Multi-agent support** — works with OpenCode, Claude Code, Openclaw, and Codex
- **Fully local** — no API calls, no cloud storage; all data stays on your machine
- **Auto-prompted** — injects instructions into your agent's config so it knows when to save and recall memories
- **Compression workflow** — atomic distillation of old notes into fewer, concise ones

## Quick Start

### Install

```bash
npm install -g @s_s/mnemo
```

### Configure your MCP client

Add Mnemo to your MCP client configuration.

<details>
<summary><strong>OpenCode</strong></summary>

Add to `opencode.json`:

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

Via CLI (user scope, available across all projects):

```bash
claude mcp add --transport stdio --scope user mnemo -- mnemo
```

This stores the config in `~/.claude.json`.

</details>

<details>
<summary><strong>Codex</strong></summary>

Via CLI:

```bash
codex mcp add mnemo -- mnemo
```

Or add to `~/.codex/config.toml`:

```toml
[mcp_servers.mnemo]
command = "mnemo"
```

</details>

<details>
<summary><strong>OpenClaw</strong> (via mcporter skill)</summary>

OpenClaw uses [mcporter](https://github.com/steipete/mcporter) to manage MCP servers. Add Mnemo to `config/mcporter.json` (or `~/.mcporter/mcporter.json` for global config):

```json
{
  "mcpServers": {
    "mnemo": {
      "command": "mnemo"
    }
  }
}
```

Or via mcporter CLI:

```bash
mcporter config add mnemo --command mnemo --scope home
```

</details>

### Initialize

Once connected, call the `memory_setup` tool to inject memory management instructions into your agent's config file:

```
> Use the memory_setup tool to initialize Mnemo
```

This writes a prompt block into your agent's config (e.g., `AGENTS.md` for OpenCode, `CLAUDE.md` for Claude Code) that teaches the agent when and how to use Mnemo's tools.

## Usage Examples

> **Important:** You don't call Mnemo tools directly. You chat with your AI agent in natural language, and the agent decides when to call Mnemo tools behind the scenes. After running `memory_setup`, the agent already knows when and how to use them.

### First-time setup

```
You:   Help me set up Mnemo for memory management
Agent: I'll initialize Mnemo for you.
       → [calls memory_setup tool]
       Mnemo has been initialized. I've added memory management
       instructions to your AGENTS.md file.
```

### Saving memories (automatic)

The agent saves memories on its own when it recognizes important information:

```
You:   Let's use 4-space indentation and single quotes for this project.
Agent: Got it. I'll follow that style.
       → [calls memory_save: "Project code style: 4-space indentation,
          single quotes", tags: ["preference", "code-style"]]
       I've saved this as a memory so I'll remember it next time.
```

### Recalling context (automatic)

When you start a new conversation, the agent searches for relevant memories:

```
You:   Let's continue working on the auth module.
Agent: → [calls memory_search: "auth module"]
       Based on my memories, last time we decided to use JWT with
       refresh tokens and store them in httpOnly cookies. Let me
       pick up from there.
```

### Searching memories (on request)

```
You:   Do you remember what database we chose?
Agent: → [calls memory_search: "database choice"]
       Found a relevant memory about database selection.
       → [calls memory_get: "<note-id>"]
       Yes — we decided on PostgreSQL with Prisma ORM, mainly for
       its type safety and migration tooling.
```

### Compressing memories

When memories accumulate, you can ask the agent to clean up:

```
You:   We have a lot of memories now. Can you clean them up?
Agent: → [calls memory_compress]
       I found 23 memories. Let me distill them into fewer notes...
       → [calls memory_compress_apply: saves 8 distilled notes,
          deletes 23 originals]
       Done. Compressed 23 memories into 8 concise notes.
```

## Tools

Mnemo provides 7 MCP tools:

| Tool                    | Description                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| `memory_setup`          | Initialize Mnemo — inject usage instructions into agent config      |
| `memory_save`           | Save a memory note with optional tags and source                    |
| `memory_search`         | Hybrid search across memories; returns summaries (supports filters) |
| `memory_get`            | Retrieve full content of specific notes by ID                       |
| `memory_compress`       | List all notes for review/distillation                              |
| `memory_compress_apply` | Atomically save distilled notes and delete originals                |
| `memory_delete`         | Delete notes by ID                                                  |

## How It Works

### Storage

Memory notes are stored as Markdown files with YAML frontmatter:

```
~/Library/Application Support/mnemo/    # macOS
~/.local/share/mnemo/                   # Linux
%APPDATA%/mnemo/                        # Windows
├── notes/                              # Markdown files
│   ├── 20260305-172200-a3f1.md
│   └── 20260305-183015-b7c2.md
└── index/                              # Vector index (vectra)
```

Override the data directory with `MNEMO_DATA_DIR` environment variable.

### Hybrid Search

Mnemo uses a hybrid search strategy combining **vector search** (semantic similarity via [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), 33MB, 384 dimensions) and **keyword search** (case-insensitive term matching). Results from both are merged with weighted scoring (vector: 0.7, keyword: 0.3). If the embedding model isn't ready yet, keyword search works as a graceful fallback.

Search results return summaries by default. Use `memory_get` with note IDs to retrieve full content — this keeps context usage minimal when browsing results.

### Memory Lifecycle

1. **Save** — Agent saves key info during conversations (decisions, preferences, architecture choices, or when context is running low)
2. **Search** — Agent retrieves relevant context at the start of new conversations or when needed
3. **Compress** — When notes accumulate, the agent distills them into fewer, concise notes via `memory_compress` → review → `memory_compress_apply`

## Development

```bash
git clone git@github.com:See-Cat/mnemo.git
cd mnemo
npm install
npm run build
npm test
```

### Scripts

| Command                | Description                  |
| ---------------------- | ---------------------------- |
| `npm run build`        | Compile TypeScript           |
| `npm run dev`          | Watch mode compilation       |
| `npm test`             | Run tests (Vitest)           |
| `npm run test:watch`   | Watch mode tests             |
| `npm run prettier:fix` | Format all files             |
| `npm run release`      | Interactive release workflow |

### Release

```bash
npm run release
```

Interactive script that walks through: git check → branch check → version selection → format → test → build → publish → push.

## License

MIT
