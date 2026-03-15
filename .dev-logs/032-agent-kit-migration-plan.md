# 032 — 迁移至 @s_s/agent-kit 计划

## 背景

mnemo 项目中约 377 行代码属于 agent 适配层（检测、prompt 注入、hook 安装、路径映射、数据目录），与 `@s_s/agent-kit` v1.1.0 功能高度重叠。agent-kit v1.1.0 采用"安装器"模型（用户提供完整 hook 内容，agent-kit 负责写入正确路径和生命周期管理），不再做代码生成，与 mnemo 的 compaction 跳过等自定义逻辑完全兼容。

## 目标

- 引入 `@s_s/agent-kit` 作为依赖，替换 mnemo 中重复的 agent 适配层代码
- 保留 mnemo 所有业务逻辑（记忆存储、embedding、驱逐、MCP 工具、REMINDERS 文案、hook 内容模板）
- 净删除约 300+ 行重复代码
- 所有测试通过，行为不变

## 改动清单

### Step 1: 安装依赖

- `npm install @s_s/agent-kit`
- 确认 TypeScript 类型兼容

### Step 2: 替换 AgentType 和 CLIENT_NAME_MAP

**文件**: `src/core/config.ts`

- 删除 `AGENT_TYPES` 常量 (L8)
- 删除 `AgentType` 类型 (L10)
- 删除 `CLIENT_NAME_MAP` (L16-21)
- 改为 re-export: `export { AGENT_TYPES, CLIENT_NAME_MAP, type AgentType } from '@s_s/agent-kit'`
- 保留全部存储层代码（StorageContext, Note, MemoryType, getDataDir 等）

**影响范围**: 所有 import AgentType 的文件（hooks/reminders.ts, hooks/installer.ts, prompts/templates.ts, tools/setup.ts, index.ts）— 由于从 config.ts re-export，下游 import 路径不变

> **注意**: mnemo 的 `getDataDir()` 保留不替换。mnemo 的数据目录路径和 agent-kit 的用途不同（mnemo 存储笔记，agent-kit 是通用工具名数据目录）。

### Step 3: 替换 Prompt 注入

**文件**: `src/prompts/templates.ts`

- 删除 `AGENT_CONFIG` 映射表 (L34-62, 约 28 行)
- 删除 `getAgentConfig()` 函数 (L113-115)
- 删除 `MARKER_START` / `MARKER_END` 常量 (L67-68)
- 删除 `hasPromptInjected()` 函数 (L89-91)
- 删除 `injectPrompt()` 函数 (L96-108)
- 删除 `escapeRegex()` 函数 (L117-119)
- 保留 `BASE_MEMORY_PROMPT` (L6-17)
- 保留 `AGENT_MEMORY_PROMPTS` (L23-29)
- 保留 `buildMemoryPrompt()` (L74-77)
- 保留 `getPromptBlock()` (L82-84) — 但改为只返回 prompt 文本（不含 marker），marker 由 agent-kit 管理

**净效果**: 119 行 → ~40 行

### Step 4: 替换 Agent 检测和项目根检测

**文件**: `src/tools/setup.ts`

- 删除 `PROJECT_ROOT_MARKERS` (L12)
- 删除 `detectAgentTypeFromFiles()` (L17-51, 约 34 行)
- 删除 `pathExists()` 私有函数 (L53-60)
- 删除 `detectGitRoot()` (L62-69)
- 删除 `findProjectRootFromMarkers()` (L71-87)
- 删除 `resolveProjectRoot()` (L89-105)
- 替换为: `import { detectAgent, detectAgentFromClient, detectProjectRoot } from '@s_s/agent-kit'`

**净效果**: 删除约 90 行检测代码

### Step 5: 替换 Hook 安装

**文件**: `src/hooks/installer.ts` — **整体删除** (158 行)

- `installHooks()` → `kit.installHooks(agent, hookSets)`
- `mergeHookSettings()` → agent-kit 内部处理
- `hasHooksInstalled()` → `kit.hasHooksInstalled(agent)`
- `HookInstallResult` 接口 → `import { HookInstallResult } from '@s_s/agent-kit'`

### Step 6: 重构 reminders.ts — 分离文案与模板

**文件**: `src/hooks/reminders.ts`

- 保留 `REMINDERS` 常量 (L8-30) — mnemo 核心文案
- 保留 hook 内容模板（ACTIVATOR_SCRIPT, OPENCLAW_HANDLER_TS, OPENCODE_PLUGIN_TS）— 作为 `defineHooks()` 的 content 参数
- 删除 `HookScriptConfig` 接口 (L161-171)
- 删除 `HOOK_CONFIGS` 映射表 (L173-201, 约 28 行) — agent-kit 的 AGENT_REGISTRY 已包含路径映射
- 新增: 用 `defineHooks()` 包装各 agent 的 hook 定义，导出 HookSet 数组

### Step 7: 重构 setup.ts — runSetup() 使用 agent-kit

**文件**: `src/tools/setup.ts`

- `runSetup()` 中 agent 检测部分 → `detectAgent()` / `detectAgentFromClient()`
- prompt 注入部分 → `kit.injectPrompt(agent, promptText)`
- hook 安装部分 → `kit.installHooks(agent, hookSets)`
- 保留存储初始化逻辑 (`writeStorageConfig`)

### Step 8: 适配 index.ts

**文件**: `src/index.ts`

- `AGENT_TYPES` import 来源改为 config.ts 的 re-export（无变化）
- `parseSetupArgs()` 中 `--agent` 校验保持不变（AGENT_TYPES 值不变）

### Step 9: 更新测试

- `tests/hooks.test.ts` — 适配新的 hook 定义方式（defineHooks）
- `tests/templates.test.ts` — 删除 AGENT_CONFIG / injectPrompt / hasPromptInjected 相关测试（功能已由 agent-kit 自身测试覆盖），保留 prompt 文案测试
- `tests/config.test.ts` — CLIENT_NAME_MAP 测试改为验证 re-export

### Step 10: 验证

- `npm test` — 全部 203+ 测试通过
- `npm run build` — 编译无错误
- 手动验证: `node build/index.js setup --agent opencode --scope global` 行为不变

## 风险

1. **agent-kit 的 AGENT_REGISTRY 路径与 mnemo 硬编码路径是否完全一致** — 需逐一核对
2. **agent-kit 的 injectPrompt marker 格式是否兼容** — agent-kit 用 `<!-- {name}:start/end -->`，mnemo 当前用 `<!-- mnemo:start/end -->`，createKit('mnemo') 后格式一致
3. **测试中的 mock/stub 可能需要适配** — installer.ts 删除后引用它的测试需要更新
4. **已部署的插件文件** `~/Desktop/plugins/mnemo-reminder.ts` — 不受影响（运行时直接加载，不经过 installHooks）

## 预期效果

| 指标                      | 改动前            | 改动后                     |
| ------------------------- | ----------------- | -------------------------- |
| agent 适配层代码          | ~440 行（自维护） | ~60 行（调用 agent-kit）   |
| 运行时依赖数              | 0                 | 1 (@s_s/agent-kit, 零依赖) |
| installer.ts              | 158 行            | 删除                       |
| templates.ts              | 119 行            | ~40 行                     |
| setup.ts 检测代码         | ~90 行            | ~5 行 (import)             |
| reminders.ts HOOK_CONFIGS | ~40 行            | 删除 (defineHooks 替代)    |
| 净删除                    | —                 | ~310 行                    |
