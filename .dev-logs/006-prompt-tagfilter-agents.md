# 006 - Prompt 增强、tag_filter、多 Agent 适配

**日期：** 2026-03-05

---

## 变更概要

本轮包含三项改进：

### 1. Prompt 增强：context 快满时保存记忆

在 `MEMORY_PROMPT` 的 `memory_save` 场景列表中新增一条：

```
- When context window is nearly full, save key information from the current conversation to preserve continuity
```

**背景：** context window 溢出导致记忆丢失是 Mnemo 要解决的核心问题之一。虽然 MCP server 无法感知 Agent 的 context 使用量，但 LLM 在长对话中能粗略判断对话长度，这条 prompt 提示足以引导 LLM 在合适时机主动保存。

### 2. memory_search 新增 tag_filter 参数

**输入：** `tag_filter: string[]`（可选），要求返回的笔记必须包含所有指定标签（AND 语义）。

**实现策略：** post-filter。因为 vectra 的 `tags` 元数据存为逗号分隔字符串（不在 `metadata_config.indexed` 中），无法在索引层面过滤。改为：

1. 当有 `tag_filter` 时，取 `top_k * 3` 条结果（多取以补偿过滤损耗）
2. 在结果上做标签匹配过滤
3. 截取前 `top_k` 条返回

笔记量级（几十到几百条）下性能完全不是问题。

### 3. 多 Agent 适配

- **`detectAgentType`**（`setup.ts`）：补全了 `openclaw` 和 `codex` 的配置文件检测路径
  - openclaw: `~/.openclaw/openclaw.json`
  - codex: `${cwd}/.codex/config.toml`, `~/.codex/config.toml`
- **`AGENT_CONFIG`**（`templates.ts`）：修正了 `openclaw` 的 `globalPath`
  - 旧：`~/.config/openclaw/AGENTS.md`
  - 新：`~/.openclaw/workspace/AGENTS.md`（符合 Openclaw 实际目录结构）

## 测试更新

- `tests/templates.test.ts`：新增 2 个测试（openclaw/codex 路径断言 + context prompt 断言），总计 13 个
- `tests/tools.test.ts`：新增 2 个测试（tag_filter 匹配 + tag_filter 空结果），总计 17 个
- 全套 59 测试通过

## 文件变更

| 文件                       | 变更                                               |
| -------------------------- | -------------------------------------------------- |
| `src/prompts/templates.ts` | 新增 context 保存 prompt；修正 openclaw globalPath |
| `src/tools/search.ts`      | 新增 tag_filter 参数 + post-filter 逻辑            |
| `src/tools/setup.ts`       | 补全 openclaw/codex 的 detectAgentType 检测        |
| `tests/templates.test.ts`  | +2 测试                                            |
| `tests/tools.test.ts`      | +2 测试                                            |
