# 021 Hook 机制设计

## 背景

Mnemo 当前最大的短板不是存储/检索/压缩本身，而是 agent 经常不在合适的时机调用 mnemo 工具。Prompt 注入（AGENTS.md / CLAUDE.md）提供了"该做什么"的参考手册，但 LLM 注意力有限，侧任务（记忆管理）容易被忽略。

Hook 机制的定位：**每轮微提醒**——在 agent 的生命周期关键节点注入极简的自检提示，让"别忘了 mnemo"成为持续信号而非一次性指令。

参考项目：[self-improving-agent](https://github.com/peterskoett/self-improving-agent)，它已在 Claude Code / Codex / OpenClaw 上验证了 hook 触发的有效性。

## 设计原则

1. **Hook 安装与 Prompt 注入解耦**——各自独立模块，互不影响。`memory_setup` 流程中两步分别调用，任一步骤失败不影响另一步。
2. **统一 Reminder 内容**——所有 agent 的提醒文本一致，只是交付方式不同。
3. **自带模板 + setup 时生成**——hook 脚本内容以字符串模板形式存放在 `reminders.ts` 中，`memory_setup` 运行时生成到目标位置。内容随 npm 版本更新。
4. **不破坏用户已有配置**——写入 settings.json 时做合并，不覆盖。

## 四个 Agent 的策略

### Claude Code / Codex（共用一套）

参考 self-improving-agent 的 `activator.sh` 模式。Codex 和 Claude Code 共用同一套 hook 系统（self-improving-agent 已验证）。

**Hook 事件：**

| 事件               | 脚本                 | 作用                        |
| ------------------ | -------------------- | --------------------------- |
| `UserPromptSubmit` | `mnemo-activator.sh` | 每轮注入 ~50 token 自检提醒 |

**安装方式：**

- 脚本生成到 `~/.claude/hooks/mnemo/mnemo-activator.sh`（Claude Code）或 `~/.codex/hooks/mnemo/mnemo-activator.sh`（Codex）
- 配置合并写入 `~/.claude/settings.json` 或 `~/.codex/settings.json`

**settings.json 合并逻辑：**

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/mnemo/mnemo-activator.sh"
          }
        ]
      }
    ]
  }
}
```

- 读取已有 settings.json → 合并 hooks 字段 → 写回
- 如果已存在 mnemo 的 hook 条目，更新而非重复添加
- 识别方式：通过脚本路径中包含 `mnemo` 来判断

### OpenClaw

参考 self-improving-agent 的 `hooks/openclaw/handler.ts` 模式。

**Hook 事件：**

| 事件              | 文件                     | 作用                                         |
| ----------------- | ------------------------ | -------------------------------------------- |
| `agent:bootstrap` | `handler.ts` + `HOOK.md` | 会话启动时注入 mnemo 提醒到 bootstrap 上下文 |

**安装方式：**

- 文件生成到 `~/.openclaw/hooks/mnemo/`（包含 `HOOK.md` 和 `handler.ts`）
- 提示用户执行 `openclaw hooks enable mnemo`

**HOOK.md：**

```yaml
---
name: mnemo
description: 'Injects memory management reminder during agent bootstrap'
metadata: { 'openclaw': { 'emoji': '🧠', 'events': ['agent:bootstrap'] } }
---
```

**handler.ts：**

- 在 `event.context.bootstrapFiles` 中注入虚拟文件 `MNEMO_REMINDER.md`
- 内容为统一的 reminder 文本
- 跳过 sub-agent 会话（检测 `event.sessionKey` 中的 `:subagent:`）

**局限：** OpenClaw 没有 `UserPromptSubmit` 事件，只能在会话启动时注入一次，无法每轮提醒。这是 OpenClaw hook 系统的固有限制。

### OpenCode

OpenCode 有完整的插件系统，通过事件订阅实现 hook 功能。

**Plugin 事件：**

| 事件                              | 作用                              |
| --------------------------------- | --------------------------------- |
| `session.created`                 | 会话开始时提醒 memory_search      |
| `session.idle`                    | 会话结束时触发自检                |
| `experimental.session.compacting` | 上下文压缩时注入 mnemo 相关上下文 |

**安装方式：**

- 插件文件生成到 `~/.config/opencode/plugins/mnemo-reminder.ts`
- OpenCode 自动加载 plugins 目录下的文件，不需要额外配置

**插件结构（草案）：**

```typescript
import type { Plugin } from '@opencode-ai/plugin';

export const MnemoReminder: Plugin = async ({ client }) => {
  return {
    event: async ({ event }) => {
      if (event.type === 'session.created') {
        // 注入 memory_search 提醒
      }
      if (event.type === 'session.idle') {
        // 注入结束自检提醒
      }
    },
    'experimental.session.compacting': async (input, output) => {
      // 注入 mnemo 上下文到压缩 prompt
      output.context.push(COMPACTION_REMINDER);
    },
  };
};
```

**待确认：** OpenCode 的 plugin 事件是否能在每轮用户消息时触发（类似 `UserPromptSubmit`）。文档中存在 `message.updated`、`message.part.updated` 事件，但不确定能否用来注入上下文。需要实现时验证。如果不行，退化为会话级别触发而非每轮触发。

## 统一 Reminder 内容

所有 agent 共享同一份核心提醒文本（~50 token），存放在 `src/hooks/reminders.ts`：

### 每轮提醒（UserPromptSubmit / 每次消息后）

```xml
<mnemo-reminder>
After this task, briefly self-check:
- Did a durable preference, decision, or rule emerge? → memory_save
- Is there an unresolved thread to resume later? → memory_save (continuity)
- Did context window reset? → memory_compress
If nothing qualifies, skip. Don't force saves.
</mnemo-reminder>
```

### 会话开始提醒

```xml
<mnemo-session-start>
Search memory for relevant context before starting work.
Call memory_search with a query based on the user's message.
</mnemo-session-start>
```

### 上下文压缩提醒

```xml
<mnemo-compaction>
Context is being compacted. Before losing context:
1. Save any important unresolved threads as continuity memories (memory_save)
2. Call memory_compress if many notes have accumulated
</mnemo-compaction>
```

## 代码组织

```
src/
├── hooks/
│   ├── installer.ts          # hook 安装逻辑（独立于 prompt 注入）
│   └── reminders.ts          # 统一 reminder 文本模板 + 各 agent 脚本模板
├── tools/
│   └── setup.ts              # 修改：调用 installHooks()
└── prompts/
    └── templates.ts          # 不变
```

脚本内容（shell 脚本、TypeScript handler、OpenCode plugin）全部以字符串模板形式存放在 `reminders.ts` 中，`installer.ts` 负责生成文件到目标路径。不需要在 npm 包中打包实际脚本文件。

`installer.ts` 导出：

```typescript
export async function installHooks(
  agentType: AgentType,
  scope: StorageScope,
  projectRoot?: string,
): Promise<HookInstallResult>;
```

返回安装结果（成功/失败/已存在），供 `setup.ts` 报告给用户。

## setup.ts 修改

```typescript
// 现有流程
const promptResult = injectPrompt(existingContent, agentType);

// 新增：独立的 hook 安装步骤
const hookResult = await installHooks(agentType, scope, projectRoot);

// 汇总报告
return {
  content: [
    {
      type: 'text',
      text: `...prompt: ${promptStatus}...\nhooks: ${hookStatus}...`,
    },
  ],
};
```

两步独立，互不影响。

## 实现顺序

1. **Claude Code / Codex**——最成熟的 hook 系统，参考最完整，优先实现
2. **OpenClaw**——参考 self-improving-agent 的 handler.ts 模式
3. **OpenCode**——插件系统，需要验证事件能力

## 待解决问题

1. **OpenCode 每轮触发**：plugin 事件中 `message.updated` 或 `message.part.updated` 能否用来注入提醒上下文？需实测。
2. **OpenClaw hook enable 自动化**：`openclaw hooks enable mnemo` 能否在 `memory_setup` 中自动执行，还是需要提示用户手动操作？
3. **脚本打包方式**：采用字符串模板方案——所有脚本内容作为 TypeScript 字符串常量存放在 `reminders.ts` 中，安装时动态生成文件。避免 npm 包打包实际脚本文件的复杂性。

## 缺少的适配

- **Codex**：当前采纳 self-improving-agent 的结论，视为与 Claude Code 共用 hook 系统。但缺少独立验证，后续需要在 Codex 环境中实测确认。如果 Codex 的 hook 行为有差异，可能需要单独适配。
